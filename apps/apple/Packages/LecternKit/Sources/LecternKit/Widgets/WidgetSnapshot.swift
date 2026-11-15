import Foundation

/// What the widgets show, written by the app to `<App Group>/widgets.json`. The widgets read
/// only this file (no network): the latest documents and the recordings being processed.
public struct WidgetSnapshot: Codable, Equatable, Sendable {
    public static let maxRecent = 5

    public struct Document: Codable, Equatable, Sendable, Identifiable {
        public let id: String
        public let title: String
        public let date: Date

        public init(id: String, title: String, date: Date) {
            self.id = id
            self.title = title
            self.date = date
        }
    }

    public struct Processing: Codable, Equatable, Sendable, Identifiable {
        public let id: String
        public let title: String
        public let stageLabel: String

        public init(id: String, title: String, stageLabel: String) {
            self.id = id
            self.title = title
            self.stageLabel = stageLabel
        }
    }

    public var recent: [Document]
    public var processing: [Processing]

    public init(recent: [Document] = [], processing: [Processing] = []) {
        self.recent = Array(recent.prefix(Self.maxRecent))
        self.processing = processing
    }

    public static let empty = WidgetSnapshot()

    /// From a workspace's list (all folders, newest first): ready documents and recordings in
    /// progress.
    public init(recordings: [RecordingSummary]) {
        let ready = recordings.filter { [.ready, .partial].contains($0.status) }
            .map { Document(id: $0.id, title: $0.title, date: $0.recordedAt) }
        let busy = recordings.filter { [.uploading, .queued, .processing].contains($0.status) }
            .map { Processing(id: $0.id, title: $0.title, stageLabel: Self.stageLabel($0.status)) }
        self.init(recent: ready, processing: busy)
    }

    private static func stageLabel(_ status: RecordingStatus) -> String {
        switch status {
        case .uploading: "업로드 중"
        case .queued: "처리 대기 중"
        default: "처리 중"
        }
    }
}

/// Reads and writes the snapshot file. A missing or broken file is the empty snapshot.
public struct WidgetSnapshotStore: Sendable {
    public static let fileName = "widgets.json"
    public let fileURL: URL

    public init(containerURL: URL) {
        fileURL = containerURL.appendingPathComponent(Self.fileName)
    }

    public func read() -> WidgetSnapshot {
        guard let data = try? Data(contentsOf: fileURL),
              let snapshot = try? Self.decoder.decode(WidgetSnapshot.self, from: data) else { return .empty }
        return WidgetSnapshot(recent: snapshot.recent, processing: snapshot.processing)
    }

    public func write(_ snapshot: WidgetSnapshot) throws {
        let trimmed = WidgetSnapshot(recent: snapshot.recent, processing: snapshot.processing)
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Self.encoder.encode(trimmed).write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Signed out: no titles left for the Lock Screen.
    public func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return decoder
    }()
}
