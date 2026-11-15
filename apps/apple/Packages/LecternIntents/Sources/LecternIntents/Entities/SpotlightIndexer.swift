#if os(iOS)
import CoreSpotlight
import Foundation
import LecternKit
import os

/// Puts recordings in Spotlight (title, date, the start of the document) each time the app
/// reads its list, and takes them all out at sign-out. Tapping one opens the app with
/// `CSSearchableItemActionType` and the recording's id.
public enum SpotlightIndexer {
    public static let domain = "com.qucord.lectern.recordings"
    public static let maxItems = 500
    public static let excerptLength = 300
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "spotlight")

    public static func index(_ recordings: [RecordingSummary], folderNames: [String: String]) async {
        let items = recordings.prefix(maxItems).map { recording -> CSSearchableItem in
            let entity = RecordingEntity(recording, folderName: recording.folderID.flatMap { folderNames[$0] })
            let attributes = entity.attributeSet
            attributes.associateAppEntity(entity)
            let item = CSSearchableItem(uniqueIdentifier: recording.id, domainIdentifier: domain, attributeSet: attributes)
            item.expirationDate = .distantFuture
            return item
        }
        guard !items.isEmpty else { return }
        do {
            try await CSSearchableIndex.default().indexSearchableItems(Array(items))
        } catch {
            log.error("spotlight: indexing failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    public static func removeAll() async {
        do {
            try await CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [domain])
        } catch {
            log.error("spotlight: clearing failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
#endif
