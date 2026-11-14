import Foundation

/// Uploads queued recordings one at a time, resuming where they stopped (D-P6-6).
///
/// For one job: make the server session (once; `Idempotency-Key` is the job id), ask the server
/// which parts it has (the server is the truth, not the local record), send the missing parts
/// in order (saved after each), complete with the same key.
///
/// - Network gone: `waitingForNetwork`; the next `run()` starts again from the server's parts.
/// - 401: the transport refreshed already; the job waits for the next `run()`.
/// - The session is gone on the server (404, or expired after 24 hours / aborted, or a part is
///   refused as "already finished"): start over with a new session under a new key.
/// - Quota, too large, unsupported type: `failed` with the server's sentence, never retried.
/// - 5xx, 429 and the like: counted; past 8 attempts the job fails.
/// - A failed job keeps its file. A done one too, until `remove`.
public actor UploadQueue {
    public static let maxAttempts = 8
    public static let missingFileMessage = "녹음 파일을 찾을 수 없습니다."
    public static let gaveUpMessage = "서버에 올리지 못했습니다. 잠시 뒤 다시 시도해 주세요."
    public static let rejectedMessage = "서버가 이 파일을 받지 않았습니다."

    private let store: UploadQueueStore
    private let transport: UploadTransport
    private let containerURL: URL
    private let now: @Sendable () -> Date
    private var cache: [String: UploadJob]
    private var running = false
    /// The job `run()` is on now.
    private var processing: String?
    /// Jobs handed to the background session (BackgroundUploader): `run()` leaves them alone until
    /// the session's chain of parts ends and releases them.
    private var backgroundOwned: Set<String> = []
    private let continuation: AsyncStream<[UploadJob]>.Continuation

    /// Every change of the queue (the whole list, oldest first).
    public nonisolated let updates: AsyncStream<[UploadJob]>

    public init(store: UploadQueueStore, transport: UploadTransport, containerURL: URL, now: @escaping @Sendable () -> Date = { Date() }) {
        self.store = store
        self.transport = transport
        self.containerURL = containerURL
        self.now = now
        cache = Dictionary(store.load().map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        (updates, continuation) = AsyncStream.makeStream(of: [UploadJob].self, bufferingPolicy: .bufferingNewest(1))
    }

    public func enqueue(_ job: UploadJob) throws {
        try store.save(job)
        cache[job.id] = job
        publish()
    }

    /// Oldest first.
    public func jobs() -> [UploadJob] {
        cache.values.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
    }

    /// Runs every runnable job once, one at a time. A second call while one runs returns at once.
    /// `skipping`: jobs with a part in flight in the background session (after a relaunch the
    /// queue no longer knows them); jobs handed over in this process are skipped anyway.
    public func run(skipping: Set<String> = []) async {
        guard !running else { return }
        running = true
        defer {
            running = false
            processing = nil
        }
        var tried = skipping
        while let next = jobs().first(where: { ($0.state.isRunnable || ($0.state.isDone && !$0.markers.isEmpty)) && !tried.contains($0.id) && !backgroundOwned.contains($0.id) }) {
            tried.insert(next.id)
            processing = next.id
            await process(next)
        }
    }

    // MARK: - Background session

    /// Hands a job to the background session: makes (or checks) its server session and returns
    /// the first part to send. nil when there is nothing to hand over: not runnable, `run()` is on
    /// it, already handed over, every part is on the server (`run()` completes it), or the server
    /// refused (the job is marked as `run()` would mark it).
    public func claimForBackground(_ id: String) async -> (uploadID: String, part: Int)? {
        guard var job = cache[id], job.state.isRunnable, processing != id, !backgroundOwned.contains(id) else { return nil }
        backgroundOwned.insert(id)  // before the first await: `run()` must not start it meanwhile
        guard filesPresent(job) else {
            backgroundOwned.remove(id)
            fail(&job, Self.missingFileMessage)
            return nil
        }
        do {
            let completedOnServer = try await syncSession(&job)
            if !completedOnServer, let next = nextPart(id) { return next }
        } catch {
            handle(error, &job)
        }
        backgroundOwned.remove(id)
        return nil
    }

    /// The background chain of a job ended (its last part, a failure, or a part that could not
    /// be started): `run()` may take it again.
    public func releaseFromBackground(_ id: String) {
        backgroundOwned.remove(id)
    }

    /// A background part of this job finished (after a relaunch the queue may not know the job is
    /// the background session's): `run()` leaves it alone until it is released.
    public func holdForBackground(_ id: String) {
        backgroundOwned.insert(id)
    }

    /// A failed job back to the queue.
    public func retry(_ id: String) throws {
        guard var job = cache[id], case .failed = job.state else { return }
        job.state = .queued
        job.attempts = 0
        try write(job)
    }

    /// Drops a job. A done job's local file goes too; a failed or unfinished one keeps it.
    public func remove(_ id: String) throws {
        guard let job = cache[id] else { return }
        try store.delete(id)
        cache[id] = nil
        if case .done = job.state {
            for path in [job.fileRelativePath] + job.pdfRelativePaths {
                try? FileManager.default.removeItem(at: containerURL.appendingPathComponent(path))
            }
        }
        publish()
    }

    /// A part the background session finished (BackgroundUploader). The next `run()` asks the
    /// server anyway; this only keeps the progress shown in between.
    public func markPartDone(_ id: String, part: Int) {
        guard var job = cache[id], job.state.isRunnable, !job.partsDone.contains(part) else { return }
        job.partsDone = (job.partsDone + [part]).sorted()
        try? write(job)
    }

    /// The next part to send of a job with a session (for BackgroundUploader).
    public func nextPart(_ id: String) -> (uploadID: String, part: Int)? {
        guard let job = cache[id], job.state.isRunnable, let uploadID = job.uploadID else { return nil }
        let total = job.files.reduce(0) { $0 + $1.partCount }
        return remainingParts(total: total, done: job.partsDone).first.map { (uploadID, $0) }
    }

    /// The file and byte range of a session part (for BackgroundUploader).
    public func partLocation(_ id: String, part: Int) -> (fileURL: URL, range: Range<Int64>)? {
        guard let job = cache[id], let (file, range) = locate(part, in: job) else { return nil }
        return (containerURL.appendingPathComponent(file.relativePath), range)
    }

    // MARK: - One job

    private func process(_ start: UploadJob) async {
        var job = start
        if case let .done(recordingID) = job.state {
            return await sendMarkers(&job, recordingID: recordingID)
        }
        guard filesPresent(job) else {
            return fail(&job, Self.missingFileMessage)
        }
        do {
            let completedOnServer = try await syncSession(&job)
            let total = job.files.reduce(0) { $0 + $1.partCount }
            for part in completedOnServer ? [] : remainingParts(total: total, done: job.partsDone) {
                guard let (file, range) = locate(part, in: job) else { throw APIError.decoding("part \(part) is outside the session's files") }
                try await transport.putPart(uploadID: job.uploadID!, part: part, fileURL: containerURL.appendingPathComponent(file.relativePath), range: range)
                job.partsDone = (job.partsDone + [part]).sorted()
                try write(job)
            }
            job.state = .completing
            try write(job)
            let recordingID = try await transport.complete(uploadID: job.uploadID!, idempotencyKey: job.idempotencyKey)
            job.state = .done(recordingID: recordingID)
            job.attempts = 0
            try write(job)
            await sendMarkers(&job, recordingID: recordingID)
        } catch {
            handle(error, &job)
        }
    }

    private func filesPresent(_ job: UploadJob) -> Bool {
        ([job.fileRelativePath] + job.pdfRelativePaths).allSatisfy { FileManager.default.fileExists(atPath: containerURL.appendingPathComponent($0).path) }
    }

    /// Makes the server session, or asks the server which parts it has (the server is the truth,
    /// not the local record). True when the server already completed it.
    private func syncSession(_ job: inout UploadJob) async throws -> Bool {
        var completedOnServer = false
        if job.uploadID == nil {
            try await createSession(&job)
        } else {
            let status: UploadStatus?
            do {
                status = try await transport.status(uploadID: job.uploadID!)
            } catch APIError.notFound {
                status = nil
            }
            if let status, status.isCompleted {
                // The complete response was lost. The server dropped the parts and answers the
                // same complete again with its stored result; sending parts would get 409 and
                // start a second recording under a new key.
                completedOnServer = true
            } else if let status, !status.isDead {
                job.partsDone = status.partsDone.sorted()
            } else {
                abandonSession(&job)
                try await createSession(&job)
            }
        }
        job.state = .uploading
        try write(job)
        return completedOnServer
    }

    /// Markers go once the recording exists; a failed send is tried again on the next run (the
    /// server treats the same user's marker within ±500 ms as the same one).
    private func sendMarkers(_ job: inout UploadJob, recordingID: String) async {
        guard !job.markers.isEmpty else { return }
        do {
            try await transport.sendMarkers(recordingID: recordingID, markers: job.markers)
            job.markers = []
            try? write(job)
        } catch {
            // kept for the next run
        }
    }

    /// The server's session is dead: forget it, and use a new key for the next one.
    private func abandonSession(_ job: inout UploadJob) {
        job.uploadID = nil
        job.partSize = nil
        job.files = []
        job.partsDone = []
        job.sessionGeneration += 1
    }

    private func createSession(_ job: inout UploadJob) async throws {
        var specs = [UploadFileSpec(kind: .audio, fileName: job.fileName, mimeType: job.mimeType, byteCount: job.byteCount)]
        for path in job.pdfRelativePaths {
            let url = containerURL.appendingPathComponent(path)
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
            specs.append(UploadFileSpec(kind: .pdf, fileName: url.lastPathComponent, mimeType: "application/pdf", byteCount: size))
        }
        let session = try await transport.create(job, files: specs)
        let paths = [job.fileRelativePath] + job.pdfRelativePaths
        job.uploadID = session.uploadID
        job.partSize = session.partSize
        job.files = session.files.compactMap { file in
            guard paths.indices.contains(file.index) else { return nil }
            return UploadFilePlan(relativePath: paths[file.index], byteCount: specs[file.index].byteCount, firstPart: file.firstPart, partCount: file.partCount)
        }
        job.partsDone = session.partsDone.sorted()
        try write(job)
    }

    /// The file and byte range of a session part.
    private func locate(_ part: Int, in job: UploadJob) -> (UploadFilePlan, Range<Int64>)? {
        guard let partSize = job.partSize,
              let file = job.files.first(where: { part >= $0.firstPart && part < $0.firstPart + $0.partCount }) else { return nil }
        let ranges = partRanges(byteCount: file.byteCount, partSize: partSize)
        let index = part - file.firstPart
        return ranges.indices.contains(index) ? (file, ranges[index]) : nil
    }

    private func handle(_ error: any Error, _ job: inout UploadJob) {
        // Only a real network error waits for the network; anything else that is not an APIError
        // (a disk error, a bug) counts as an attempt, so it cannot park a job forever.
        let api = error as? APIError ?? .decoding(String(describing: type(of: error)))
        switch api {
        case .transport:
            job.state = .waitingForNetwork
        case .unauthorized:
            break  // the provider refreshed (or the user must sign in): the next run tries again
        case let .quotaExceeded(message):
            return fail(&job, message)
        case .server(409, "conflict", _), .server(409, "idempotency_conflict", _):
            // "Already finished or canceled" for a part, or a create body that no longer matches
            // its key: start a new session next time.
            abandonSession(&job)
            job.attempts += 1
            if job.attempts > Self.maxAttempts { return fail(&job, Self.gaveUpMessage) }
        case let .server(status, _, message) where [413, 415].contains(status):
            return fail(&job, message ?? Self.rejectedMessage)
        case let .server(status, _, message) where (400..<500).contains(status) && status != 408 && status != 429:
            return fail(&job, message ?? Self.rejectedMessage)
        case .forbidden:
            return fail(&job, Self.rejectedMessage)
        case .notFound, .server, .decoding:
            job.attempts += 1
            if job.attempts > Self.maxAttempts { return fail(&job, Self.gaveUpMessage) }
        }
        try? write(job)
    }

    private func fail(_ job: inout UploadJob, _ message: String) {
        job.state = .failed(message: message)
        try? write(job)
    }

    private func write(_ job: UploadJob) throws {
        guard cache[job.id] != nil else { return }  // removed while it ran: stays removed
        var job = job
        job.updatedAt = now()
        cache[job.id] = job
        defer { publish() }
        try store.save(job)
    }

    private func publish() {
        continuation.yield(jobs())
    }
}
