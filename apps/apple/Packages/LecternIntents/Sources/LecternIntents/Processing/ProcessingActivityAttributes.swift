import Foundation
import LecternKit
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

/// The processing Live Activity: one per uploaded recording, updated by the server's pushes
/// (stage, progress, "문서 준비됨"). The type's name is part of the contract: a push-to-start
/// carries `"attributes-type": "ProcessingActivityAttributes"` (`apps/server/src/apns/payload.ts`),
/// and the keys are the server's snake case.
public struct ProcessingActivityAttributes: Codable, Hashable, Sendable {
    public typealias ContentState = ProcessingContentState

    /// What the server writes in `attributes-type`.
    public static let typeName = "ProcessingActivityAttributes"

    public var recordingID: String
    public var title: String

    public init(recordingID: String, title: String) {
        self.recordingID = recordingID
        self.title = title
    }

    enum CodingKeys: String, CodingKey {
        case recordingID = "recording_id"
        case title
    }

    /// `lectern://recordings/<id>`: what tapping the activity opens.
    public var openURL: URL {
        URL(string: "lectern://recordings/\(recordingID)")!
    }
}

#if canImport(ActivityKit) && os(iOS)
extension ProcessingActivityAttributes: ActivityAttributes {}
#endif
