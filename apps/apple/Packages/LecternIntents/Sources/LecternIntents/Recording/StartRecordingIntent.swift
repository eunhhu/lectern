#if os(iOS)
import AppIntents

/// The control, the Action button, Siri and Shortcuts start a recording with this. As an
/// `AudioRecordingIntent` it runs in the app's process (woken in the background), where
/// `RecordingSession.shared` is; the session starts the Live Activity the system requires.
public struct StartRecordingIntent: AudioRecordingIntent {
    public static let title: LocalizedStringResource = "녹음 시작"
    public static let description = IntentDescription("Lectern으로 새 녹음을 시작합니다.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        try await RecordingActions.start(session: RecordingSession.shared, defaults: SharedDefaults.group)
        return .result()
    }
}

/// The Control Center toggle (`ControlWidgetToggle` takes one `SetValueIntent`): on starts, off
/// stops. Also an `AudioRecordingIntent`, so it runs in the app's process.
public struct RecordingToggleIntent: SetValueIntent, AudioRecordingIntent {
    public static let title: LocalizedStringResource = "녹음 켜기/끄기"
    public static let isDiscoverable = false

    @Parameter(title: "녹음")
    public var value: Bool

    public init() {}

    public func perform() async throws -> some IntentResult {
        try await RecordingActions.setRecording(value, session: RecordingSession.shared, defaults: SharedDefaults.group)
        return .result()
    }
}

/// Lets the app and the widget extension include this package's intents.
public struct LecternIntentsPackage: AppIntentsPackage {}
#endif
