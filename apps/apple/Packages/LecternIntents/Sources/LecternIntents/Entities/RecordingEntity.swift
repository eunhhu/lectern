#if os(iOS)
import AppIntents
import CoreSpotlight
import Foundation
import LecternKit

/// A recording as Siri, Shortcuts and Spotlight see it.
public struct RecordingEntity: AppEntity, IndexedEntity {
    public static let typeDisplayRepresentation: TypeDisplayRepresentation = "녹음"
    public static let defaultQuery = RecordingEntityQuery()

    public var id: String
    public var title: String
    public var date: Date
    public var folderName: String?
    /// A few words of the document (Spotlight's description).
    public var excerpt: String?

    public init(id: String, title: String, date: Date, folderName: String? = nil, excerpt: String? = nil) {
        self.id = id
        self.title = title
        self.date = date
        self.folderName = folderName
        self.excerpt = excerpt
    }

    public init(_ recording: RecordingSummary, folderName: String?) {
        self.init(id: recording.id, title: recording.title, date: recording.recordedAt, folderName: folderName, excerpt: recording.excerpt)
    }

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(subtitle)")
    }

    private var subtitle: String {
        let day = date.formatted(.dateTime.year().month().day())
        guard let folderName, !folderName.isEmpty else { return day }
        return "\(folderName) · \(day)"
    }

    public var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: .text)
        attributes.title = title
        attributes.contentDescription = excerpt.map { String($0.prefix(SpotlightIndexer.excerptLength)) }
        attributes.contentCreationDate = date
        attributes.keywords = folderName.map { [$0] }
        return attributes
    }
}

/// Finds recordings for Siri and Shortcuts: the app's recent list (what the widgets show) and
/// the server (`RecordingDirectory`, installed by the app).
public struct RecordingEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [RecordingEntity] {
        let known = await RecordingDirectory.shared.recent()
        var found = known.filter { identifiers.contains($0.id) }
        for id in identifiers where !found.contains(where: { $0.id == id }) {
            if let entity = await RecordingDirectory.shared.recording(id: id) { found.append(entity) }
        }
        return found
    }

    public func entities(matching string: String) async throws -> [RecordingEntity] {
        await RecordingDirectory.shared.search(string)
    }

    public func suggestedEntities() async throws -> [RecordingEntity] {
        await RecordingDirectory.shared.recent()
    }
}

/// Where intents look up recordings. The app installs the server lookup; without it (the app
/// has not run since it launched) only the widget snapshot's recent documents are known.
public final class RecordingDirectory: @unchecked Sendable {
    public static let shared = RecordingDirectory()

    public typealias Search = @Sendable (String?) async -> [RecordingEntity]
    public typealias Lookup = @Sendable (String) async -> RecordingEntity?

    private let lock = NSLock()
    private var searchHandler: Search?
    private var lookupHandler: Lookup?

    public func install(search: @escaping Search, lookup: @escaping Lookup) {
        lock.withLock {
            searchHandler = search
            lookupHandler = lookup
        }
    }

    public func uninstall() {
        lock.withLock {
            searchHandler = nil
            lookupHandler = nil
        }
    }

    func recent() async -> [RecordingEntity] {
        if let search = lock.withLock({ searchHandler }) {
            let found = await search(nil)
            if !found.isEmpty { return found }
        }
        let snapshot = WidgetSnapshotStore(containerURL: AppEnvironment.sharedContainerURL()).read()
        return snapshot.recent.map { RecordingEntity(id: $0.id, title: $0.title, date: $0.date) }
    }

    func search(_ text: String) async -> [RecordingEntity] {
        if let search = lock.withLock({ searchHandler }) { return await search(text) }
        return await recent().filter { $0.title.localizedCaseInsensitiveContains(text) }
    }

    func recording(id: String) async -> RecordingEntity? {
        guard let lookup = lock.withLock({ lookupHandler }) else { return nil }
        return await lookup(id)
    }
}
#endif
