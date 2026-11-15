#if os(iOS)
import AppIntents

/// "중요" from the Live Activity, Siri or Shortcuts: a marker at the current recording time.
public struct AddMarkerIntent: LiveActivityIntent {
    public static let title: LocalizedStringResource = "중요 표시"
    public static let description = IntentDescription("진행 중인 녹음의 지금 위치를 중요로 표시합니다.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        await RecordingActions.addMarker(session: RecordingSession.shared)
        return .result()
    }
}
#endif
