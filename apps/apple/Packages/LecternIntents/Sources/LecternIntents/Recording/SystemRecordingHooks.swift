#if os(iOS)
import AVFAudio
import Foundation
import os
import RecorderKit
import WidgetKit

extension RecordingHooks {
    /// The real thing on iOS: the microphone permission, the audio session (SessionCoordinator
    /// passes calls and route changes to the recorder) and the control's state in the App Group.
    public static func system() -> RecordingHooks {
        let box = CoordinatorBox()
        return RecordingHooks(
            requestPermission: { await AVAudioApplication.requestRecordPermission() },
            activate: { recorder in try box.activate(for: recorder) },
            deactivate: { box.deactivate() },
            activeChanged: { active in
                SharedDefaults.group?.set(active, forKey: SharedDefaults.recordingActiveKey)
                ControlCenter.shared.reloadControls(ofKind: SharedDefaults.recordingControlKind)
            }
        )
    }
}

/// One SessionCoordinator per recorder, kept while it records.
private final class CoordinatorBox: @unchecked Sendable {
    private let lock = NSLock()
    private var coordinator: SessionCoordinator?
    private var owner: ObjectIdentifier?
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "recording")

    func activate(for recorder: Recorder) throws {
        let current = lock.withLock { () -> SessionCoordinator in
            if let coordinator, owner == ObjectIdentifier(recorder) { return coordinator }
            let made = SessionCoordinator(recorder: recorder)
            coordinator = made
            owner = ObjectIdentifier(recorder)
            return made
        }
        try current.activate()
    }

    func deactivate() {
        let current = lock.withLock { () -> SessionCoordinator? in
            defer {
                coordinator = nil
                owner = nil
            }
            return coordinator
        }
        current?.deactivate()
        // Back to playback: left at .playAndRecord, later playback over AirPods would stay in
        // call quality (and LecternUI's player does not touch a recording session).
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        } catch {
            Self.log.error("recording: playback category not restored: \(error.localizedDescription, privacy: .public)")
        }
    }
}
#endif
