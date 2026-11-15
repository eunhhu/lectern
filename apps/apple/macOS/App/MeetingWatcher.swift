import AppKit
import RecorderKit
import UserNotifications

/// Settings keys read outside the main actor (the recorder is made on the session's actor).
enum MacDefaults {
    /// "회의 소리도 함께 녹음(시스템 오디오)": off by default.
    static let systemAudio = "record_system_audio"
    /// "회의 앱이 실행되면 녹음할지 묻기": off by default.
    static let meetingPrompt = "meeting_prompt_enabled"
}

/// When a known meeting app launches (Zoom, Teams, Webex, FaceTime), a notification asks
/// whether to record: `녹음 시작` starts a recording, `이번에는 안 함` and dismissing do nothing.
/// It never starts a recording by itself, and the calendar is not read.
@MainActor
final class MeetingWatcher {
    static let category = "meeting"
    static let startAction = "start"
    static let skipAction = "skip"

    var isRecording: () -> Bool = { false }
    var isSignedIn: () -> Bool = { false }
    var onStart: (() -> Void)?
    private var prompter = MeetingPrompter()
    private var observer: NSObjectProtocol?

    init() {
        let start = UNNotificationAction(identifier: Self.startAction, title: "녹음 시작", options: [])
        let skip = UNNotificationAction(identifier: Self.skipAction, title: "이번에는 안 함", options: [])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: Self.category, actions: [start, skip], intentIdentifiers: [], options: []),
        ])
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            let bundleID = (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.bundleIdentifier
            MainActor.assumeIsolated { self?.launched(bundleID) }
        }
    }

    static var isEnabled: Bool { UserDefaults.standard.bool(forKey: MacDefaults.meetingPrompt) }

    /// A response to one of this watcher's notifications.
    func handle(category: String, action: String) {
        guard category == Self.category, action == Self.startAction else { return }
        onStart?()
    }

    private func launched(_ bundleID: String?) {
        guard let bundleID,
              let app = prompter.shouldPrompt(launchedBundleID: bundleID, isRecording: isRecording(), enabled: Self.isEnabled && isSignedIn(), now: Date())
        else { return }
        let content = UNMutableNotificationContent()
        content.title = "\(app.name) 회의를 녹음할까요?"
        // The spec's sentence promises the meeting's sound: only true with the system audio on.
        content.body = UserDefaults.standard.bool(forKey: MacDefaults.systemAudio)
            ? "Lectern이 마이크와 회의 소리를 녹음합니다."
            : "Lectern이 마이크로 회의를 녹음합니다."
        content.categoryIdentifier = Self.category
        content.sound = .default
        let request = UNNotificationRequest(identifier: "meeting-\(app.bundleID)", content: content, trigger: nil)
        Task { try? await UNUserNotificationCenter.current().add(request) }
    }
}
