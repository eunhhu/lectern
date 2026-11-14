#if os(iOS)
import AVFAudio
import Foundation
import os

/// Sets the audio session up for recording and passes the system's interruptions (a call) and
/// route changes (AirPods taken out) to `Recorder.handle`, in the order they came. It does
/// nothing else.
public final class SessionCoordinator: @unchecked Sendable {
    private let session: AVAudioSession
    private let events: AsyncStream<RecorderEvent>.Continuation
    private let pump: Task<Void, Never>
    private let lock = NSLock()
    private var observers: [NSObjectProtocol] = []
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "recorder")

    public init(recorder: Recorder, session: AVAudioSession = .sharedInstance()) {
        self.session = session
        let (stream, continuation) = AsyncStream<RecorderEvent>.makeStream()
        events = continuation
        pump = Task {
            for await event in stream {
                await recorder.handle(event)
            }
        }
    }

    deinit {
        events.finish()
        pump.cancel()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    /// Before `Recorder.start()`.
    public func activate() throws {
        try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothHFP, .defaultToSpeaker])
        try session.setActive(true)
        lock.withLock {
            guard observers.isEmpty else { return }
            let center = NotificationCenter.default
            observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { [weak self] note in
                self?.interruption(note)
            })
            observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: nil) { [weak self] note in
                self?.routeChange(note)
            })
        }
    }

    /// After the recording has stopped.
    public func deactivate() {
        let removed = lock.withLock { () -> [NSObjectProtocol] in
            defer { observers = [] }
            return observers
        }
        for observer in removed { NotificationCenter.default.removeObserver(observer) }
        do {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            Self.log.error("recorder: session deactivation failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func interruption(_ note: Notification) {
        let info = note.userInfo ?? [:]
        let type = (info[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue ?? UInt.max
        let options = (info[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0
        guard var event = SessionEvents.interruption(type: type, options: options) else { return }
        if case .interruptionEnded(shouldResume: true) = event {
            // The session must be active again before the input can restart; if it cannot be,
            // the user resumes by hand.
            do {
                try session.setActive(true)
            } catch {
                Self.log.error("recorder: session reactivation failed: \(error.localizedDescription, privacy: .public)")
                event = .interruptionEnded(shouldResume: false)
            }
        }
        events.yield(event)
    }

    private func routeChange(_ note: Notification) {
        let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue ?? 0
        guard let event = SessionEvents.routeChange(reason: reason) else { return }
        events.yield(event)
    }
}
#endif
