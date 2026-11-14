import Foundation

/// A point the user marked as important while recording (sent after the upload completes).
public struct Marker: Codable, Equatable, Sendable {
    public var atMs: Int
    public var label: String?

    public init(atMs: Int, label: String? = nil) {
        self.atMs = atMs
        self.label = label
    }
}

/// Where one file's parts sit in the upload session (`UploadSession.files`).
public struct UploadFilePlan: Codable, Equatable, Sendable {
    /// Relative to the App Group container.
    public var relativePath: String
    public var byteCount: Int64
    /// Number of this file's first part (1-based, like the server).
    public var firstPart: Int
    public var partCount: Int
}

/// One recording waiting to go to the server: the file, what to tell the server about it, and
/// how far the upload got. Stored as `<id>.json` in the queue folder (App Group), so the share
/// extension and widgets read the same queue.
public struct UploadJob: Codable, Identifiable, Equatable, Sendable {
    public enum State: Codable, Equatable, Sendable {
        case queued
        case uploading
        case completing
        case done(recordingID: String)
        case failed(message: String)
        case waitingForNetwork

        public var isRunnable: Bool {
            switch self {
            case .queued, .uploading, .completing, .waitingForNetwork: true
            case .done, .failed: false
            }
        }

        public var isDone: Bool {
            if case .done = self { true } else { false }
        }
    }

    /// A UUID made once, never changed. The Idempotency-Key of create and complete is this id
    /// (or `<id>.<n>` after the server's session expired, see `sessionGeneration`).
    public var id: String
    /// Relative to the App Group container.
    public var fileRelativePath: String
    public var fileName: String
    public var mimeType: String
    public var byteCount: Int64
    public var workspaceID: String
    public var folderID: String?
    public var title: String?
    /// Sent as `recorded_at`.
    public var recordedAt: Date?
    /// PDFs uploaded with the recording (share extension).
    public var pdfRelativePaths: [String]
    public var markers: [Marker]
    /// The server's upload session.
    public var uploadID: String?
    public var partSize: Int?
    /// Each file's parts in the session (the audio first, then the PDFs).
    public var files: [UploadFilePlan]
    /// Part numbers the server has (1-based).
    public var partsDone: [Int]
    /// Bumped when the server's session died (expired after 24 hours, aborted): the same key
    /// would return that dead session, so the next one is made with a new key.
    public var sessionGeneration: Int
    public var state: State
    public var attempts: Int
    public var createdAt: Date
    public var updatedAt: Date

    /// The Idempotency-Key of this job's current server session.
    public var idempotencyKey: String {
        sessionGeneration == 0 ? id : "\(id).\(sessionGeneration)"
    }

    public init(
        id: String = UUID().uuidString.lowercased(),
        fileRelativePath: String,
        fileName: String,
        mimeType: String,
        byteCount: Int64,
        workspaceID: String,
        folderID: String? = nil,
        title: String? = nil,
        recordedAt: Date? = nil,
        pdfRelativePaths: [String] = [],
        markers: [Marker] = [],
        now: Date = Date()
    ) {
        self.id = id
        self.fileRelativePath = fileRelativePath
        self.fileName = fileName
        self.mimeType = mimeType
        self.byteCount = byteCount
        self.workspaceID = workspaceID
        self.folderID = folderID
        self.title = title
        self.recordedAt = recordedAt
        self.pdfRelativePaths = pdfRelativePaths
        self.markers = markers
        uploadID = nil
        partSize = nil
        files = []
        partsDone = []
        sessionGeneration = 0
        state = .queued
        attempts = 0
        createdAt = now
        updatedAt = now
    }
}
