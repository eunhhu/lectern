import Foundation
import OpenAPIRuntime

/// What the server said when an upload session was made or looked up.
public struct UploadSessionInfo: Equatable, Sendable {
    public struct File: Equatable, Sendable {
        /// Position in the create request's `files` (0 = the recording, then the PDFs).
        public var index: Int
        public var firstPart: Int
        public var partCount: Int

        public init(index: Int, firstPart: Int, partCount: Int) {
            self.index = index
            self.firstPart = firstPart
            self.partCount = partCount
        }
    }

    public var uploadID: String
    public var partSize: Int
    public var files: [File]
    /// Part numbers the server already has (1-based).
    public var partsDone: [Int]

    public init(uploadID: String, partSize: Int, files: [File], partsDone: [Int]) {
        self.uploadID = uploadID
        self.partSize = partSize
        self.files = files
        self.partsDone = partsDone
    }
}

/// A session as the server sees it now.
public struct UploadStatus: Equatable, Sendable {
    /// `open`, `completed`, `aborted`, `expired` (open set).
    public var state: String
    /// Part numbers the server has (1-based).
    public var partsDone: [Int]

    public init(state: String, partsDone: [Int]) {
        self.state = state
        self.partsDone = partsDone
    }

    /// Expired or aborted: nothing more can be sent to it.
    public var isDead: Bool { state == "expired" || state == "aborted" }
}

/// One local file of a job, as the create request lists it.
public struct UploadFileSpec: Equatable, Sendable {
    public enum Kind: String, Sendable { case audio, pdf }
    public var kind: Kind
    public var fileName: String
    public var mimeType: String
    public var byteCount: Int64
}

/// The server calls of an upload (v2 part upload, D-P6-6). Errors are `APIError`s.
public protocol UploadTransport: Sendable {
    /// `createUpload` with `Idempotency-Key: job.idempotencyKey`: the same session comes back on
    /// a retry, as long as the body is the same (the server answers 409 otherwise).
    func create(_ job: UploadJob, files: [UploadFileSpec]) async throws -> UploadSessionInfo
    /// The session's state and the parts the server already has.
    func status(uploadID: String) async throws -> UploadStatus
    /// One part: `range` of the file, read from disk (never the whole file in memory).
    func putPart(uploadID: String, part: Int, fileURL: URL, range: Range<Int64>) async throws
    /// `completeUpload`; returns the recording id.
    func complete(uploadID: String, idempotencyKey: String) async throws -> String
    /// The job's markers, once the recording exists (best effort).
    func sendMarkers(recordingID: String, markers: [Marker]) async throws
}

/// The real transport: LecternAPI's generated client. A part is streamed from its byte range of
/// the file in 256 KB reads, so a long recording never sits in memory.
public struct LecternUploadTransport: UploadTransport {
    static let readSize = 256 * 1024
    private let api: LecternAPI

    public init(api: LecternAPI) {
        self.api = api
    }

    public func create(_ job: UploadJob, files: [UploadFileSpec]) async throws -> UploadSessionInfo {
        let request = Components.Schemas.CreateUploadRequest(
            workspace_id: job.workspaceID,
            recording: .init(title: job.title, folder_id: job.folderID),
            recorded_at: job.recordedAt.map(Self.wholeSecond),
            files: files.map { .init(kind: $0.kind.rawValue, filename: $0.fileName, mime: $0.mimeType, bytes: Int($0.byteCount)) }
        )
        return try await api.run {
            let session = try await api.client.createUpload(.init(headers: .init(Idempotency_hyphen_Key: job.idempotencyKey), body: .json(request))).created.body.json
            return UploadSessionInfo(
                uploadID: session.id,
                partSize: session.part_size,
                files: session.files.map { .init(index: $0.index, firstPart: $0.first_part, partCount: $0.part_count) },
                partsDone: session.received_parts
            )
        }
    }

    public func status(uploadID: String) async throws -> UploadStatus {
        try await api.run {
            let session = try await api.client.getUpload(.init(path: .init(upload_id: uploadID))).ok.body.json
            return UploadStatus(state: session.status, partsDone: session.received_parts)
        }
    }

    /// The create body must be the same on every retry (the server compares it under the key),
    /// so `recorded_at` goes at whole seconds: no sub-second value to lose in the queue file.
    static func wholeSecond(_ date: Date) -> Date {
        Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded(.down))
    }

    public func putPart(uploadID: String, part: Int, fileURL: URL, range: Range<Int64>) async throws {
        do {
            try await send(uploadID: uploadID, part: part, fileURL: fileURL, range: range)
        } catch APIError.unauthorized {
            // A streamed body is not resent by AuthMiddleware: refresh, then send this part once more.
            guard try await api.auth.refreshAfterUnauthorized() else { throw APIError.unauthorized }
            try await send(uploadID: uploadID, part: part, fileURL: fileURL, range: range)
        }
    }

    public func complete(uploadID: String, idempotencyKey: String) async throws -> String {
        try await api.run {
            try await api.client.completeUpload(.init(path: .init(upload_id: uploadID), headers: .init(Idempotency_hyphen_Key: idempotencyKey))).ok.body.json.recording.id
        }
    }

    public func sendMarkers(recordingID: String, markers: [Marker]) async throws {
        try await api.run {
            for marker in markers {
                _ = try await api.client.createMarker(.init(path: .init(recording_id: recordingID), body: .json(.init(at_ms: marker.atMs, label: marker.label))))
            }
        }
    }

    private func send(uploadID: String, part: Int, fileURL: URL, range: Range<Int64>) async throws {
        let body = try Self.body(fileURL: fileURL, range: range)
        try await api.run {
            _ = try await api.client.putUploadPart(.init(path: .init(upload_id: uploadID, part: part), body: .binary(body))).ok
        }
    }

    /// The bytes of `range`, read from disk only as they are sent.
    static func body(fileURL: URL, range: Range<Int64>) throws -> HTTPBody {
        let reader = try RangeReader(fileURL: fileURL, range: range, readSize: readSize)
        let stream = AsyncThrowingStream<ArraySlice<UInt8>, any Error>(unfolding: { try reader.next() })
        return HTTPBody(stream, length: .known(Int64(range.count)), iterationBehavior: .single)
    }
}

/// Reads one byte range of a file in chunks, on demand.
final class RangeReader: @unchecked Sendable {
    private let handle: FileHandle
    private let readSize: Int
    private var left: Int64

    init(fileURL: URL, range: Range<Int64>, readSize: Int) throws {
        handle = try FileHandle(forReadingFrom: fileURL)
        try handle.seek(toOffset: UInt64(range.lowerBound))
        left = Int64(range.count)
        self.readSize = readSize
    }

    func next() throws -> ArraySlice<UInt8>? {
        guard left > 0 else {
            try? handle.close()
            return nil
        }
        guard let data = try handle.read(upToCount: min(readSize, Int(left))), !data.isEmpty else {
            try? handle.close()
            throw CocoaError(.fileReadCorruptFile, userInfo: [NSFilePathErrorKey: "the file ended before the part did"])
        }
        left -= Int64(data.count)
        return ArraySlice(data)
    }

    deinit { try? handle.close() }
}
