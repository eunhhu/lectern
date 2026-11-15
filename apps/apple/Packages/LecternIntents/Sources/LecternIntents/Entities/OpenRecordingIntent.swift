import Foundation
import LecternKit
#if os(iOS)
import AppIntents
#endif

/// Where the app's screens learn which screen to open: a link (`lectern://`, a universal link,
/// Handoff, Spotlight, a notification) or an intent run in the app. The screen takes `pending`
/// once it can show it (after sign-in).
@MainActor
public final class LinkRouter: ObservableObject {
    public static let shared = LinkRouter()
    @Published public var pending: DeepLink?

    public init() {}

    public func open(_ link: DeepLink) {
        pending = link
    }

    /// The link, once: nil after the first call.
    public func take() -> DeepLink? {
        defer { pending = nil }
        return pending
    }
}

#if os(iOS)
/// "Lectern에서 … 열기": opens a recording in the app.
public struct OpenRecordingIntent: AppIntent {
    public static let title: LocalizedStringResource = "녹음 열기"
    public static let description = IntentDescription("Lectern에서 녹음의 문서를 엽니다.")
    public static let supportedModes: IntentModes = .foreground

    @Parameter(title: "녹음")
    public var recording: RecordingEntity

    public init() {}

    public init(recording: RecordingEntity) {
        self.recording = recording
    }

    @MainActor
    public func perform() async throws -> some IntentResult {
        LinkRouter.shared.open(.recording(id: recording.id))
        return .result()
    }
}

/// "Lectern 최근 문서 열기": the newest document.
public struct OpenRecentDocumentIntent: AppIntent {
    public static let title: LocalizedStringResource = "최근 문서 열기"
    public static let description = IntentDescription("Lectern에서 가장 최근 문서를 엽니다.")
    public static let supportedModes: IntentModes = .foreground

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult {
        if let newest = try await RecordingEntityQuery().suggestedEntities().first {
            LinkRouter.shared.open(.recording(id: newest.id))
        } else {
            LinkRouter.shared.open(.library)
        }
        return .result()
    }
}
#endif
