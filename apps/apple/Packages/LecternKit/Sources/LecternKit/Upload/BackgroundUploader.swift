import Foundation

/// Sends parts through a background URLSession, so uploads go on while the app is suspended or
/// was quit (D-P6-6). Only the plumbing lives here; what to send and when is UploadQueue's.
///
/// - Each part is cut into a temporary file (background sessions upload only from files) and the
///   task's `taskDescription` is `"<jobID>:<part>"`. When a task finishes, the part is marked done
///   in the queue, the temporary file goes, and the next part is started in the background
///   session; after the last one the queue runs (complete).
/// - After a relaunch `reconcile()` lists the tasks still in flight; the app does not `run()` a
///   job that has one (it would send the same part twice).
/// - Not unit-tested (background sessions do not run in a test process): MANUAL_CHECKS.md.
public final class BackgroundUploader: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    public static let identifier = "com.qucord.lectern.upload"
    public static let appGroup = "group.com.qucord.lectern"

    private let queue: UploadQueue
    private let api: LecternAPI
    private let scratch: URL
    private let lock = NSLock()
    private var finishEvents: (() -> Void)?
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

    #if os(iOS)
    /// From `application(_:handleEventsForBackgroundURLSession:completionHandler:)`.
    public func handleEvents(completion: @escaping () -> Void) {
        lock.withLock { finishEvents = completion }
        _ = session  // reconnects the session so its events are delivered
    }
    #endif

    // MARK: - URLSessionDelegate

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        guard let (jobID, part) = Self.parse(task.taskDescription) else { return }
        try? FileManager.default.removeItem(at: scratch.appendingPathComponent("\(jobID)-\(part).part"))
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        Task {
            if error == nil, (200..<300).contains(status) {
                await queue.markPartDone(jobID, part: part)
                // The next part goes to the background session too; the last one is completed by
                // the queue (a small JSON call).
                if let (uploadID, next) = await queue.nextPart(jobID) {
                    try? await send(jobID: jobID, uploadID: uploadID, part: next)
                    return
                }
            }
            await queue.run()  // complete, or the server's answer about a failed part
        }
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let done = lock.withLock { () -> (() -> Void)? in
            defer { finishEvents = nil }
            return finishEvents
        }
        DispatchQueue.main.async { done?() }
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
