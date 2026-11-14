#if os(iOS)
import AppIntents

/// The Live Activity's pause/resume button.
public struct PauseResumeIntent: LiveActivityIntent {
    public static let title: LocalizedStringResource = "일시정지/재개"
    public static let isDiscoverable = false

    public init() {}

    public func perform() async throws -> some IntentResult {
        await RecordingActions.togglePause(session: RecordingSession.shared)
        return .result()
    }
}
#endif
