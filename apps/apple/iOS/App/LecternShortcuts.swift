import AppIntents
import LecternIntents

/// The recording intents are in the LecternIntents package; the app includes its metadata.
struct LecternAppIntents: AppIntentsPackage {
    static var includedPackages: [any AppIntentsPackage.Type] { [LecternIntentsPackage.self] }
}

/// Siri and Shortcuts phrases. In the app target: the system reads App Shortcuts from the app.
struct LecternShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartRecordingIntent(),
            phrases: ["\(.applicationName)으로 녹음 시작"],
            shortTitle: "녹음 시작",
            systemImageName: "record.circle"
        )
        AppShortcut(
            intent: StopRecordingIntent(),
            phrases: ["\(.applicationName) 녹음 정지"],
            shortTitle: "녹음 정지",
            systemImageName: "stop.circle"
        )
        AppShortcut(
            intent: AddMarkerIntent(),
            phrases: ["\(.applicationName) 중요 표시"],
            shortTitle: "중요 표시",
            systemImageName: "star"
        )
        AppShortcut(
            intent: OpenRecordingIntent(),
            phrases: ["\(.applicationName)에서 \(\.$recording) 열기"],
            shortTitle: "녹음 열기",
            systemImageName: "doc.text"
        )
        AppShortcut(
            intent: OpenRecentDocumentIntent(),
            phrases: ["\(.applicationName) 최근 문서 열기"],
            shortTitle: "최근 문서",
            systemImageName: "clock"
        )
    }
}
