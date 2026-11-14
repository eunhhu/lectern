import Foundation
@testable import LecternKit

/// An in-memory upload server for UploadQueue tests: sessions, received parts, errors on chosen
/// calls, and a log of every call.
final class FakeUploadServer: UploadTransport, @unchecked Sendable {
    enum Call: Equatable {
        case create(key: String)
        case status(uploadID: String)
        case put(uploadID: String, part: Int)
        case complete(uploadID: String, key: String)
        case markers(recordingID: String, count: Int)
    }

    private struct Session {
        var partCount: Int
        var received: Set<Int>
        var state = "open"
    }

    private let lock = NSLock()
    private var sessions: [String: Session] = [:]
    private var keys: [String: String] = [:]  // Idempotency-Key → upload id
    private var faults: [(when: (Call) -> Bool, error: APIError, left: Int)] = []
    private(set) var log: [Call] = []
    private(set) var createdJobs: [UploadJob] = []
    var partSize = 4
    var putDelay: TimeInterval = 0

    /// Throws `error` on the next `times` calls that match.
    func fail(_ error: APIError, times: Int = 1, when: @escaping (Call) -> Bool) {
        lock.withLock { faults.append((when, error, times)) }
    }

    /// A session that already exists on the server (a resumed job).
    func seedSession(uploadID: String, partCount: Int, received: [Int]) {
        lock.withLock { sessions[uploadID] = Session(partCount: partCount, received: Set(received)) }
    }

    /// The server's 24-hour expiry: parts dropped, the key still points at the dead session.
    func expire(_ uploadID: String) {
        lock.withLock {
            sessions[uploadID]?.state = "expired"
            sessions[uploadID]?.received = []
        }
    }

    func received(_ uploadID: String) -> [Int] {
        lock.withLock { sessions[uploadID]?.received.sorted() ?? [] }
    }

    var calls: [Call] { lock.withLock { log } }

    private func enter(_ call: Call) throws {
        try lock.withLock {
            log.append(call)
            if let i = faults.firstIndex(where: { $0.left > 0 && $0.when(call) }) {
                faults[i].left -= 1
                throw faults[i].error
            }
        }
    }

    func create(_ job: UploadJob, files: [LecternKit.UploadFileSpec]) async throws -> UploadSessionInfo {
        try enter(.create(key: job.idempotencyKey))
        return lock.withLock {
            createdJobs.append(job)
            var first = 1
            let plans = files.enumerated().map { index, file -> UploadSessionInfo.File in
                let count = max(1, partRanges(byteCount: file.byteCount, partSize: partSize).count)
                defer { first += count }
                return .init(index: index, firstPart: first, partCount: count)
            }
            let uploadID = keys[job.idempotencyKey] ?? "upl_\(keys.count + 1)"
            keys[job.idempotencyKey] = uploadID
            if sessions[uploadID] == nil { sessions[uploadID] = Session(partCount: first - 1, received: []) }
            return UploadSessionInfo(uploadID: uploadID, partSize: partSize, files: plans, partsDone: sessions[uploadID]!.received.sorted())
        }
    }

    func status(uploadID: String) async throws -> UploadStatus {
        try enter(.status(uploadID: uploadID))
        return try lock.withLock {
            guard let session = sessions[uploadID] else { throw APIError.notFound }
            return UploadStatus(state: session.state, partsDone: session.received.sorted())
        }
    }

    func putPart(uploadID: String, part: Int, fileURL: URL, range: Range<Int64>) async throws {
        try enter(.put(uploadID: uploadID, part: part))
        if putDelay > 0 { try await Task.sleep(nanoseconds: UInt64(putDelay * 1_000_000_000)) }
        let data = try Data(contentsOf: fileURL)
        precondition(range.upperBound <= Int64(data.count), "range outside the file")
        try lock.withLock {
            guard let session = sessions[uploadID] else { throw APIError.notFound }
            guard session.state == "open" else {
                throw APIError.server(status: 409, code: "conflict", message: "이미 끝났거나 취소된 업로드입니다.")
            }
            sessions[uploadID]!.received.insert(part)
        }
    }

    func complete(uploadID: String, idempotencyKey: String) async throws -> String {
        try enter(.complete(uploadID: uploadID, key: idempotencyKey))
        return try lock.withLock {
            guard let session = sessions[uploadID] else { throw APIError.notFound }
            guard session.received.count == session.partCount else {
                throw APIError.server(status: 409, code: "upload_incomplete", message: "파트가 모자랍니다.")
            }
            return "rec_\(uploadID)"
        }
    }

    func sendMarkers(recordingID: String, markers: [Marker]) async throws {
        try enter(.markers(recordingID: recordingID, count: markers.count))
    }
}
