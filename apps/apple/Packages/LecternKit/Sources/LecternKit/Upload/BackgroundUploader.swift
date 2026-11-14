import Foundation

/// Sends parts through a background URLSession, so uploads go on while the app is suspended or
/// was quit (D-P6-6). Only the plumbing lives here; what to send and when is UploadQueue's.
///
/// - A job is handed over with `UploadQueue.claimForBackground` (it makes the server session and
///   gives the first part), then `send`. Each part is cut into a temporary file (background
///   sessions upload only from files) and the task's `taskDescription` is `"<jobID>:<part>"`.
///   When a task finishes, the part is marked done in the queue, the temporary file goes, and the
///   next part is started in the background session; after the last one the job is released and
///   the queue runs (complete). A 401 (the access token expired during a long upload) hands the
///   job over again, which refreshes the token; any other failure releases the job for the next
///   `run()`, which asks the server and applies the queue's error rules.
/// - The system's completion handler for background events is called only once those events are
///   delivered and every chain they started has its next part in the session (or ended): calling
///   it earlier lets the app be suspended before the next part is started.
/// - After a relaunch the queue no longer knows which jobs are in flight: `run(skipping:
///   inFlightJobIDs())` leaves them alone (sending the same part twice works but costs data).
/// - Not unit-tested (background sessions do not run in a test process): MANUAL_CHECKS.md.
public final class BackgroundUploader: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    public static let identifier = "com.qucord.lectern.upload"
    public static let appGroup = "group.com.qucord.lectern"

    private let queue: UploadQueue
    private let api: LecternAPI
    private let scratch: URL
    private let lock = NSLock()
    private var finishEvents: (() -> Void)?
    private var eventsDelivered = false
    /// Chains (one per finished task) still deciding their next step.
    private var pendingChains = 0
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        configuration.sharedContainerIdentifier = Self.appGroup
        configuration.isDiscretionary = false
        #if os(iOS)
        configuration.sessionSendsLaunchEvents = true
        #endif
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    /// `containerURL`: the App Group container (temporary part files go to `UploadParts/` in it).
    public init(queue: UploadQueue, api: LecternAPI, containerURL: URL) {
        self.queue = queue
        self.api = api
        scratch = containerURL.appendingPathComponent("UploadParts", isDirectory: true)
        super.init()
    }

    /// Starts one part of a job in the background session.
    public func send(jobID: String, uploadID: String, part: Int) async throws {
        guard let (fileURL, range) = await queue.partLocation(jobID, part: part) else { return }
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        let slice = scratch.appendingPathComponent("\(jobID)-\(part).part")
        try Self.cut(fileURL, range: range, to: slice)
        let url = LecternAPI.apiBase(api.serverURL)
            .appendingPathComponent("uploads").appendingPathComponent(uploadID)
            .appendingPathComponent("parts").appendingPathComponent(String(part))
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        try await api.auth.authorize(&request)
        let task = session.uploadTask(with: request, fromFile: slice)
        task.taskDescription = "\(jobID):\(part)"
        task.resume()
    }

    /// After a relaunch: the parts still in flight, as (job id, part).
    public func reconcile() async -> [(jobID: String, part: Int)] {
        await session.allTasks.compactMap { Self.parse($0.taskDescription) }
    }

    /// The jobs with a part in flight, for `UploadQueue.run(skipping:)`.
    public func inFlightJobIDs() async -> Set<String> {
        Set(await reconcile().map(\.jobID))
    }

    /// Claims a job in the queue and starts its first part. False when the queue had nothing to
    /// hand over (then `run()` is the way) or the part could not be started.
    @discardableResult
    public func start(jobID: String) async -> Bool {
        guard let (uploadID, part) = await queue.claimForBackground(jobID) else { return false }
        do {
            try await send(jobID: jobID, uploadID: uploadID, part: part)
            return true
        } catch {
            await queue.releaseFromBackground(jobID)
            return false
        }
    }

    #if os(iOS)
    /// From `application(_:handleEventsForBackgroundURLSession:completionHandler:)`.
    public func handleEvents(completion: @escaping () -> Void) {
        lock.withLock {
            finishEvents = completion
            eventsDelivered = false
        }
        _ = session  // reconnects the session so its events are delivered
    }
    #endif

    /// Another server: this session goes (its tasks are canceled) before a new uploader makes one
    /// with the same identifier.
    public func invalidate() {
        session.invalidateAndCancel()
    }

    // MARK: - URLSessionDelegate

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        guard let (jobID, part) = Self.parse(task.taskDescription) else { return }
        try? FileManager.default.removeItem(at: scratch.appendingPathComponent("\(jobID)-\(part).part"))
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        lock.withLock { pendingChains += 1 }
        Task {
            defer { chainSettled() }
            await queue.holdForBackground(jobID)
            if error == nil, (200..<300).contains(status) {
                await queue.markPartDone(jobID, part: part)
                // The next part goes to the background session too; the last one is completed by
                // the queue (a small JSON call).
                if let (uploadID, next) = await queue.nextPart(jobID) {
                    if (try? await send(jobID: jobID, uploadID: uploadID, part: next)) != nil { return }
                    await queue.releaseFromBackground(jobID)
                    return
                }
                await queue.releaseFromBackground(jobID)
                await queue.run(skipping: await inFlightJobIDs())  // other background jobs left alone
                return
            }
            await queue.releaseFromBackground(jobID)
            if status == 401 {
                await start(jobID: jobID)  // asks the server (refreshing the token), then the part again
            }
        }
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.withLock { eventsDelivered = true }
        finishEventsIfSettled()
    }

    private func chainSettled() {
        lock.withLock { pendingChains -= 1 }
        finishEventsIfSettled()
    }

    private func finishEventsIfSettled() {
        let done = lock.withLock { () -> (() -> Void)? in
            guard eventsDelivered, pendingChains == 0, let finishEvents else { return nil }
            self.finishEvents = nil
            eventsDelivered = false
            return finishEvents
        }
        if let done { DispatchQueue.main.async { done() } }
    }

    // MARK: - Helpers

    static func parse(_ description: String?) -> (jobID: String, part: Int)? {
        guard let description, let colon = description.lastIndex(of: ":"), let part = Int(description[description.index(after: colon)...]) else { return nil }
        return (String(description[..<colon]), part)
    }

    /// Copies `range` of a file to `destination` in 1 MB reads.
    static func cut(_ source: URL, range: Range<Int64>, to destination: URL) throws {
        let reader = try RangeReader(fileURL: source, range: range, readSize: 1 << 20)
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let writer = try FileHandle(forWritingTo: destination)
        defer { try? writer.close() }
        while let chunk = try reader.next() {
            try writer.write(contentsOf: chunk)
        }
    }
}
