import Foundation

/// A page of a list and the cursor of the next one (nil on the last page).
public struct Page<Item: Sendable & Equatable>: Sendable, Equatable {
    public let items: [Item]
    public let nextCursor: String?

    public init(items: [Item], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }
}

/// The signed-in user.
public struct Me: Sendable, Equatable {
    public let id: String
    public let email: String
    public let displayName: String
    public let timezone: String
    public let systemRole: String
    public let personalWorkspaceID: String

    public init(id: String, email: String, displayName: String, timezone: String, systemRole: String, personalWorkspaceID: String) {
        self.id = id
        self.email = email
        self.displayName = displayName
        self.timezone = timezone
        self.systemRole = systemRole
        self.personalWorkspaceID = personalWorkspaceID
    }

    init(_ m: Components.Schemas.Me) {
        id = m.id
        email = m.email
        displayName = m.display_name
        timezone = m.timezone
        systemRole = m.system_role
        personalWorkspaceID = m.personal_workspace_id
    }
}

public struct WorkspaceSummary: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    /// `personal` or `team` (open: a newer server may add kinds).
    public let kind: String
    /// The user's role in it: `owner`, `admin`, `member`, `viewer`.
    public let role: String

    public init(id: String, name: String, kind: String, role: String) {
        self.id = id
        self.name = name
        self.kind = kind
        self.role = role
    }

    init(_ w: Components.Schemas.MyWorkspace) {
        id = w.workspace.id
        name = w.workspace.name
        kind = w.workspace.kind
        role = w.role
    }
}

public struct Folder: Sendable, Equatable, Identifiable {
    public let id: String
    public let workspaceID: String
    public let parentID: String?
    public let name: String
    public let sortKey: String

    public init(id: String, workspaceID: String, parentID: String?, name: String, sortKey: String) {
        self.id = id
        self.workspaceID = workspaceID
        self.parentID = parentID
        self.name = name
        self.sortKey = sortKey
    }

    init(_ f: Components.Schemas.Folder) {
        id = f.id
        workspaceID = f.workspace_id
        parentID = f.parent_id
        name = f.name
        sortKey = f.sort_key
    }
}

/// A recording's processing state. Unknown values (a newer server) stay readable.
public enum RecordingStatus: Sendable, Equatable {
    case uploading, queued, processing, ready, partial, failed, canceled
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "uploading": self = .uploading
        case "queued": self = .queued
        case "processing": self = .processing
        case "ready": self = .ready
        case "partial": self = .partial
        case "failed": self = .failed
        case "canceled": self = .canceled
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .uploading: "uploading"
        case .queued: "queued"
        case .processing: "processing"
        case .ready: "ready"
        case .partial: "partial"
        case .failed: "failed"
        case .canceled: "canceled"
        case let .unknown(value): value
        }
    }
}

/// A recording as lists show it.
public struct RecordingSummary: Sendable, Equatable, Identifiable {
    public let id: String
    public let workspaceID: String
    public let folderID: String?
    public let title: String
    public let status: RecordingStatus
    /// Length of the audio in ms; nil until known.
    public let durationMs: Int?
    public let recordedAt: Date
    public let createdAt: Date
    public let updatedAt: Date
    /// A few words of the current document (lists only).
    public let excerpt: String?
    /// 0–1 while a job runs (lists only).
    public let progress: Double?

    public init(
        id: String, workspaceID: String, folderID: String?, title: String, status: RecordingStatus, durationMs: Int?,
        recordedAt: Date, createdAt: Date, updatedAt: Date, excerpt: String?, progress: Double?
    ) {
        self.id = id
        self.workspaceID = workspaceID
        self.folderID = folderID
        self.title = title
        self.status = status
        self.durationMs = durationMs
        self.recordedAt = recordedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.excerpt = excerpt
        self.progress = progress
    }

    init(_ r: Components.Schemas.RecordingListItem) {
        id = r.id
        workspaceID = r.workspace_id
        folderID = r.folder_id
        title = r.title
        status = RecordingStatus(rawValue: r.status)
        durationMs = r.duration_ms
        recordedAt = r.recorded_at
        createdAt = r.created_at
        updatedAt = r.updated_at
        excerpt = r.excerpt
        progress = r.progress?.progress
    }

    init(_ r: Components.Schemas.Recording, progress: Double?) {
        id = r.id
        workspaceID = r.workspace_id
        folderID = r.folder_id
        title = r.title
        status = RecordingStatus(rawValue: r.status)
        durationMs = r.duration_ms
        recordedAt = r.recorded_at
        createdAt = r.created_at
        updatedAt = r.updated_at
        excerpt = nil
        self.progress = progress
    }
}

/// A file of a recording; its bytes come from `LecternAPI.assetContentRequest`.
public struct AssetSummary: Sendable, Equatable, Identifiable {
    public let id: String
    /// `audio`, `audio_normalized`, `audio_compact`, `pdf`, `image` (open).
    public let kind: String
    public let partIndex: Int
    public let mime: String
    public let bytes: Int
    public let durationMs: Int?
    public let pageCount: Int?

    public init(id: String, kind: String, partIndex: Int, mime: String, bytes: Int, durationMs: Int?, pageCount: Int?) {
        self.id = id
        self.kind = kind
        self.partIndex = partIndex
        self.mime = mime
        self.bytes = bytes
        self.durationMs = durationMs
        self.pageCount = pageCount
    }

    init(_ a: Components.Schemas.Asset) {
        id = a.id
        kind = a.kind
        partIndex = a.part_index
        mime = a.mime
        bytes = a.bytes
        durationMs = a.duration_ms
        pageCount = a.page_count
    }
}

public struct DocumentSummary: Sendable, Equatable, Identifiable {
    public let id: String
    public let templateID: String
    public let currentVersion: Int
    public let updatedAt: Date

    public init(id: String, templateID: String, currentVersion: Int, updatedAt: Date) {
        self.id = id
        self.templateID = templateID
        self.currentVersion = currentVersion
        self.updatedAt = updatedAt
    }

    init(_ d: Components.Schemas.Document) {
        id = d.id
        templateID = d.template_id
        currentVersion = d.current_version
        updatedAt = d.updated_at
    }
}

public struct Speaker: Sendable, Equatable, Identifiable {
    public let id: String
    /// `S1`, `S2` …
    public let label: String
    /// The name a user gave; shown instead of the label.
    public let displayName: String?

    public var name: String { displayName ?? label }

    public init(id: String, label: String, displayName: String?) {
        self.id = id
        self.label = label
        self.displayName = displayName
    }

    init(_ s: Components.Schemas.Speaker) {
        id = s.id
        label = s.label
        displayName = s.display_name
    }
}

/// A recording with its files, documents and speakers.
public struct RecordingDetail: Sendable, Equatable {
    public let recording: RecordingSummary
    public let assets: [AssetSummary]
    public let documents: [DocumentSummary]
    public let speakers: [Speaker]
    /// Why it failed (or is partial), in the server's words.
    public let failureMessage: String?

    /// The document to open: the first one.
    public var documentID: String? { documents.first?.id }

    /// The first part of the original audio.
    public var audioAssetID: String? {
        assets.filter { $0.kind == "audio" }.min { $0.partIndex < $1.partIndex }?.id
    }

    public init(recording: RecordingSummary, assets: [AssetSummary], documents: [DocumentSummary], speakers: [Speaker], failureMessage: String?) {
        self.recording = recording
        self.assets = assets
        self.documents = documents
        self.speakers = speakers
        self.failureMessage = failureMessage
    }

    init(_ d: Components.Schemas.RecordingDetail) {
        recording = RecordingSummary(d.recording, progress: d.progress?.progress)
        assets = d.assets.map(AssetSummary.init)
        documents = d.documents.map(DocumentSummary.init)
        speakers = d.speakers.map(Speaker.init)
        failureMessage = d.failure?.message
    }
}
