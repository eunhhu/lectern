#if os(iOS)
import AppIntents

/// The Live Activity's stop button, Siri and Shortcuts. `LiveActivityIntent`: runs in the app's
/// process. Nothing recording: succeeds doing nothing.
public struct StopRecordingIntent: LiveActivityIntent {
    public static let title: LocalizedStringResource = "녹음 정지"
    public static let description = IntentDescription("진행 중인 녹음을 멈추고 업로드 대기열에 넣습니다.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        try await RecordingActions.stop(session: RecordingSession.shared)
        return .result()
    }
}
#endif
