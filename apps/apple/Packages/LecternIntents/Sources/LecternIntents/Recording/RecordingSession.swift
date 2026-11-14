import Foundation
import os
import RecorderKit

/// Where a new recording goes. `folderName` only titles the Live Activity (not sent).
public struct RecordingDraft: Sendable, Equatable {
    public var workspaceID: String
    public var folderID: String?
    public var title: String?
    public var folderName: String?

    public init(workspaceID: String, folderID: String? = nil, title: String? = nil, folderName: String? = nil) {
        self.workspaceID = workspaceID
        self.folderID = folderID
        self.title = title
        self.folderName = folderName
    }

    public var activityTitle: String { title ?? folderName ?? "새 녹음" }
}

public enum RecordingError: Error, Equatable, LocalizedError, Sendable {
    case microphoneDenied
    case notSignedIn
    /// The session is not in this process (an intent ran outside the app).
    case unavailable
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .microphoneDenied: "마이크 권한이 필요합니다. 설정에서 Lectern의 마이크를 켜 주세요."
        case .notSignedIn: "로그인이 필요합니다. Lectern 앱을 열어 로그인해 주세요."
        case .unavailable: "Lectern 앱을 열어 녹음해 주세요."
        case let .failed(message): message
        }
    }
}

/// What a recording needs from the system around it; tests leave them empty.
public struct RecordingHooks: Sendable {
    public var requestPermission: @Sendable () async -> Bool
    /// Before the recorder starts, and before a resume (the audio session may have been taken).
    public var activate: @Sendable (Recorder) async throws -> Void
    /// After the recording stopped or failed.
    public var deactivate: @Sendable () async -> Void
    /// The recording started (true) or ended (false): the control's `recording_active`.
    public var activeChanged: @Sendable (Bool) -> Void

    public init(
        requestPermission: @escaping @Sendable () async -> Bool = { true },
        activate: @escaping @Sendable (Recorder) async throws -> Void = { _ in },
        deactivate: @escaping @Sendable () async -> Void = {},
        activeChanged: @escaping @Sendable (Bool) -> Void = { _ in }
    ) {
        self.requestPermission = requestPermission
        self.activate = activate
        self.deactivate = deactivate
        self.activeChanged = activeChanged
    }
}

/// One recording at a time for the whole app: the recorder, its Live Activity and putting the
/// file in the upload queue. Intents, the control, the Live Activity's buttons and the app's
/// record screen all go through `RecordingSession.shared`.
///
/// The activity follows the recorder's own state stream, so a pause the system made (a call)
/// shows too. It is updated only when the state changes (phase, markers, silence warning).
public actor RecordingSession {
    /// Shorter recordings were a mistaken tap: not uploaded, the file is deleted.
    public static let shortestMs = 2000
    /// The activity stays this long showing "올리는 중" after a stop.
    public static let endDelay: TimeInterval = 4

    private static let holder = SharedHolder()
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "recording")

    /// The app installs its session at launch (`App.init`). nil in an extension process.
    public static var shared: RecordingSession? { holder.value }
    public static func install(_ session: RecordingSession?) { holder.value = session }

    private let makeRecorder: @Sendable () -> Recorder
    private let activity: RecordingActivityController
    private let enqueue: @Sendable (RecordingResult, RecordingDraft) async throws -> Void
    private let now: @Sendable () -> Date
    private let hooks: RecordingHooks
    private let broadcast = StateBroadcast()

    private var starting = false
    private var stopping = false
    private var recorder: Recorder?
    private var draft: RecordingDraft?
    private var state: RecordingActivityAttributes.ContentState?
    private var activityRunning = false
    private var observers: [Task<Void, Never>] = []

    /// The message of the last recording that failed while writing (its file is kept).
    public private(set) var lastFailure: String?

    public init(
        makeRecorder: @escaping @Sendable () -> Recorder,
        activity: RecordingActivityController,
        enqueue: @escaping @Sendable (RecordingResult, RecordingDraft) async throws -> Void,
        now: @escaping @Sendable () -> Date = { Date() },
        hooks: RecordingHooks = RecordingHooks()
    ) {
        self.makeRecorder = makeRecorder
        self.activity = activity
        self.enqueue = enqueue
        self.now = now
        self.hooks = hooks
    }

    public var isActive: Bool { recorder != nil || starting }
    public var currentState: RecordingActivityAttributes.ContentState? { state }

    /// Each state change; a new stream starts with the current state while recording.
    public nonisolated var states: AsyncStream<RecordingActivityAttributes.ContentState> { broadcast.stream() }

    /// The input level (0...1) of the recording in progress; ends with it.
    public func levels() -> AsyncStream<Float> {
        guard let recorder else { return AsyncStream { $0.finish() } }
        return recorder.levels
    }

    // MARK: - Commands

    /// Does nothing while a recording is in progress (or starting): never a second recording.
    public func start(draft: RecordingDraft) async throws {
        guard recorder == nil, !starting else { return }
        starting = true
        defer { starting = false }
        guard await hooks.requestPermission() else { throw RecordingError.microphoneDenied }
        let recorder = makeRecorder()
        var activated = false
        do {
            try await hooks.activate(recorder)
            activated = true
            _ = try await recorder.start()
        } catch {
            if activated { await hooks.deactivate() }
            throw error
        }
        self.recorder = recorder
        self.draft = draft
        lastFailure = nil
        let initial = RecordingActivityAttributes.ContentState(phase: .recording, startedAt: timerStart(now: now(), recordedMs: recorder.recordedMs))
        state = initial
        broadcast.yield(initial)
        hooks.activeChanged(true)
        observe(recorder)
        let started = await activity.start(attributes: RecordingActivityAttributes(title: draft.activityTitle), state: initial)
        if self.recorder === recorder {
            activityRunning = started
            if started, let state, state != initial { await activity.update(state: state) }
        } else if started {
            // Stopped (or failed) while the activity was being requested.
            await activity.end(state: initial, dismissAfter: 0)
        }
    }

    public func pause() async {
        await recorder?.pause()
    }

    public func resume() async {
        guard let recorder else { return }
        do {
            try await hooks.activate(recorder)
        } catch {
            Self.log.error("recording: audio session not back: \(error.localizedDescription, privacy: .public)")
        }
        await recorder.resume()
    }

    public func togglePause() async {
        guard let recorder else { return }
        switch await recorder.state {
        case .recording: await pause()
        case .paused: await resume()
        default: break
        }
    }

    /// The marker's time on the file's axis, or nil when nothing is being recorded.
    @discardableResult
    public func addMarker() async -> Int? {
        guard let recorder else { return nil }
        let at = await recorder.addMarker()
        guard self.recorder === recorder, var next = state, next.isLive else { return at }
        next.markerCount += 1
        await publish(next)
        return at
    }

    /// Stops and queues the upload. nil when nothing was recording or the recording was shorter
    /// than 2 s (then its file is deleted). If queueing fails, the file stays and the error is
    /// thrown.
    @discardableResult
    public func stop() async throws -> RecordingResult? {
        guard !stopping else { return nil }
        guard let recorder, let draft else {
            if !starting { hooks.activeChanged(false) }  // a stale "on" (the control after a crash)
            return nil
        }
        stopping = true
        defer { stopping = false }
        let result: RecordingResult
        do {
            result = try await recorder.stop()
        } catch {
            await finishAfterFailure(recorder, message: (error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
            throw error
        }
        var final = state ?? RecordingActivityAttributes.ContentState(phase: .finished, startedAt: now())
        final.pausedElapsedMs = result.durationMs
        final.silenceWarning = false
        let hadActivity = activityRunning
        reset()
        hooks.activeChanged(false)
        await hooks.deactivate()

        if result.durationMs < Self.shortestMs {
            try? FileManager.default.removeItem(at: result.fileURL)
            final.phase = .finished
            await finish(final, hadActivity: hadActivity, dismissAfter: 0)
            return nil
        }
        do {
            try await enqueue(result, draft)
        } catch {
            Self.log.error("recording: queueing failed, file kept: \(error.localizedDescription, privacy: .public)")
            final.phase = .finished
            await finish(final, hadActivity: hadActivity, dismissAfter: 0)
            throw error
        }
        final.phase = .uploading
        await finish(final, hadActivity: hadActivity, dismissAfter: Self.endDelay)
        return result
    }

    /// At launch: no recording can be in progress yet, so a leftover "on" or activity is stale.
    public func cleanUpAfterLaunch() async {
        guard recorder == nil, !starting else { return }
        hooks.activeChanged(false)
        await activity.endLeftovers()
    }

    // MARK: - Internals

    private func observe(_ recorder: Recorder) {
        let states = recorder.stateChanges
        let silence = recorder.silenceWarning
        observers = [
            Task { [weak self] in
                for await value in states { await self?.recorderChanged(value, from: recorder) }
            },
            Task { [weak self] in
                for await value in silence { await self?.silenceChanged(value, from: recorder) }
            },
        ]
    }

    private func recorderChanged(_ value: RecorderState, from source: Recorder) async {
        guard source === recorder, var next = state else { return }
        switch value {
        case .recording:
            guard next.phase == .paused else { return }
            next.phase = .recording
            next.startedAt = timerStart(now: now(), recordedMs: source.recordedMs)
            next.pausedElapsedMs = nil
        case .paused:
            guard next.phase == .recording else { return }
            next.phase = .paused
            next.pausedElapsedMs = source.recordedMs
        case let .failed(message):
            return await finishAfterFailure(source, message: message)
        case .idle, .stopping, .finished:
            return
        }
        await publish(next)
    }

    private func silenceChanged(_ warning: Bool, from source: Recorder) async {
        guard source === recorder, var next = state, next.isLive, next.silenceWarning != warning else { return }
        next.silenceWarning = warning
        await publish(next)
    }

    /// The new state first, then the activity (another call may run during that await).
    private func publish(_ next: RecordingActivityAttributes.ContentState) async {
        state = next
        broadcast.yield(next)
        if activityRunning { await activity.update(state: next) }
    }

    /// The recorder failed while writing: the session ends, the file stays where it is.
    private func finishAfterFailure(_ source: Recorder, message: String) async {
        guard source === recorder else { return }
        var final = state ?? RecordingActivityAttributes.ContentState(phase: .finished, startedAt: now())
        final.phase = .finished
        final.pausedElapsedMs = source.recordedMs
        let hadActivity = activityRunning
        let file = await source.fileURL
        reset()
        lastFailure = message
        Self.log.error("recording: failed, file kept at \(file?.lastPathComponent ?? "-", privacy: .public)")
        hooks.activeChanged(false)
        await hooks.deactivate()
        await finish(final, hadActivity: hadActivity, dismissAfter: 0)
    }

    private func finish(_ final: RecordingActivityAttributes.ContentState, hadActivity: Bool, dismissAfter: TimeInterval) async {
        broadcast.yield(final)
        broadcast.forget()  // a screen opened later starts empty, not on the last recording
        if hadActivity { await activity.end(state: final, dismissAfter: dismissAfter) }
    }

    private func reset() {
        for task in observers { task.cancel() }
        observers = []
        recorder = nil
        draft = nil
        state = nil
        activityRunning = false
    }
}

/// The installed session, readable from any thread.
private final class SharedHolder: @unchecked Sendable {
    private let lock = NSLock()
    private var session: RecordingSession?

    var value: RecordingSession? {
        get { lock.withLock { session } }
        set { lock.withLock { session = newValue } }
    }
}

/// States fanned out to every listener (each keeps the newest); a new listener starts with the
/// latest state unless it was forgotten.
final class StateBroadcast: @unchecked Sendable {
    typealias State = RecordingActivityAttributes.ContentState
    private let lock = NSLock()
    private var continuations: [UUID: AsyncStream<State>.Continuation] = [:]
    private var last: State?

    func stream() -> AsyncStream<State> {
        let (stream, continuation) = AsyncStream<State>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        let replay = lock.withLock { () -> State? in
            continuations[id] = continuation
            return last
        }
        continuation.onTermination = { [weak self] _ in
            self?.lock.withLock { _ = self?.continuations.removeValue(forKey: id) }
        }
        if let replay { continuation.yield(replay) }
        return stream
    }

    func yield(_ value: State) {
        let targets = lock.withLock { () -> [AsyncStream<State>.Continuation] in
            last = value
            return Array(continuations.values)
        }
        for continuation in targets { continuation.yield(value) }
    }

    func forget() {
        lock.withLock { last = nil }
    }
}
