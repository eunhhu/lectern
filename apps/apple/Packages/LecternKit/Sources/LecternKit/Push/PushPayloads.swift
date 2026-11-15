import Foundation

/// The processing Live Activity's content state, as the server sends it in `aps.content-state`
/// (D-P6-12; `apps/server/src/apns/payload.ts`). `stage` stays a plain string so a stage this
/// app does not know yet still decodes. `progress` is a percentage (0–100).
public struct ProcessingContentState: Codable, Hashable, Sendable {
    public var stage: String
    public var stageLabel: String
    public var progress: Double?
    public var recordingID: String
    public var documentReady: Bool

    public init(stage: String, stageLabel: String, progress: Double?, recordingID: String, documentReady: Bool) {
        self.stage = stage
        self.stageLabel = stageLabel
        self.progress = progress
        self.recordingID = recordingID
        self.documentReady = documentReady
    }

    enum CodingKeys: String, CodingKey {
        case stage
        case stageLabel = "stage_label"
        case progress
        case recordingID = "recording_id"
        case documentReady = "document_ready"
    }

    /// 0–1 for a progress bar; nil when the server gave none (an indeterminate bar).
    public var fraction: Double? {
        progress.map { min(max($0 / 100, 0), 1) }
    }

    /// The state the app shows when it starts the activity itself, before the server's first update.
    public static func uploaded(recordingID: String) -> ProcessingContentState {
        ProcessingContentState(stage: "queued", stageLabel: "처리 대기 중", progress: nil, recordingID: recordingID, documentReady: false)
    }
}

/// A "document ready" / "could not process" alert: the payload's own keys next to `aps`.
public struct DocumentAlert: Decodable, Sendable, Equatable {
    public let recordingID: String
    public let url: URL
    public let title: String
    public let body: String
}

/// The alert in a notification's `userInfo`, or nil when it is not one of the server's.
public func decodeAlert(userInfo: [AnyHashable: Any]) -> DocumentAlert? {
    guard let recordingID = userInfo["recording_id"] as? String,
          let urlText = userInfo["url"] as? String, let url = URL(string: urlText) else { return nil }
    let aps = userInfo["aps"] as? [String: Any]
    let alert = aps?["alert"] as? [String: Any]
    return DocumentAlert(
        recordingID: recordingID,
        url: url,
        title: alert?["title"] as? String ?? "",
        body: alert?["body"] as? String ?? ""
    )
}
