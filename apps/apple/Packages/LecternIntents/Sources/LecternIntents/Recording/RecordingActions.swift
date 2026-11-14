import Foundation
import LecternKit
import os

/// Values the app, its intents and the widget extension share through the App Group.
public enum SharedDefaults {
    /// The workspace an intent records into; the app writes it at sign-in.
    public static let defaultWorkspaceIDKey = AppEnvironment.defaultWorkspaceIDKey
    /// True while a recording is in progress; the control reads it.
    public static let recordingActiveKey = "recording_active"
    public static let recordingControlKind = "com.qucord.lectern.recording"

    public static var group: UserDefaults? { UserDefaults(suiteName: AppEnvironment.appGroup) }

    public static func defaultWorkspaceID(in defaults: UserDefaults?) -> String? {
        guard let id = defaults?.string(forKey: defaultWorkspaceIDKey), !id.isEmpty else { return nil }
        return id
    }

    public static func isRecording(in defaults: UserDefaults?) -> Bool {
        defaults?.bool(forKey: recordingActiveKey) ?? false
    }
}

/// What the intents do, without the AppIntents types (tested on macOS). `session` is
/// `RecordingSession.shared`: nil means the intent ran outside the app process.
public enum RecordingActions {
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "recording")

    public static func start(session: RecordingSession?, defaults: UserDefaults?) async throws {
        guard let workspaceID = SharedDefaults.defaultWorkspaceID(in: defaults) else { throw RecordingError.notSignedIn }
        guard let session else {
            log.error("recording: start intent ran without a session (not the app process)")
            throw RecordingError.unavailable
        }
        try await session.start(draft: RecordingDraft(workspaceID: workspaceID))
    }

    /// Nothing recording: nothing happens, and it is not an error.
    public static func stop(session: RecordingSession?) async throws {
        guard let session else { return missing("stop") }
        try await session.stop()
    }

    public static func togglePause(session: RecordingSession?) async {
        guard let session else { return missing("pause") }
        await session.togglePause()
    }

    public static func addMarker(session: RecordingSession?) async {
        guard let session else { return missing("marker") }
        await session.addMarker()
    }

    /// The control's toggle.
    public static func setRecording(_ on: Bool, session: RecordingSession?, defaults: UserDefaults?) async throws {
        if on {
            try await start(session: session, defaults: defaults)
        } else {
            try await stop(session: session)
        }
    }

    private static func missing(_ name: String) {
        log.error("recording: \(name, privacy: .public) intent ran without a session (not the app process)")
    }
}
