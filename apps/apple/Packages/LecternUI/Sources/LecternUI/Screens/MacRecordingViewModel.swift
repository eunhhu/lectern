import Foundation
import LecternIntents

/// The menu bar recorder's state.
public enum MacRecordingState: Equatable, Sendable {
    case idle
    case recording(elapsedMs: Int)
    case paused(elapsedMs: Int)
    case saving
    case failed(String)

    public var isLive: Bool {
        switch self {
        case .recording, .paused: true
        default: false
        }
    }
}

/// The menu bar HUD and the global shortcut: start/stop, pause/resume, "중요", the level and the
/// elapsed time. The rules (one recording at a time, under 2 s is discarded, a file that could not
/// be queued is kept, a recorder that fails ends the recording) are `RecordingSession`'s, the
/// same as on iOS; this only shows them.
@MainActor
public final class MacRecordingViewModel: ObservableObject {
    public static let microphoneDeniedText = "마이크 권한이 필요합니다. 시스템 설정 > 개인정보 보호 및 보안 > 마이크에서 Lectern을 켜 주세요."
    public static let silenceText = "소리가 들리지 않습니다. 마이크를 확인해 주세요."
    public static let signInNeededText = "로그인이 필요합니다"

    @Published public private(set) var state: MacRecordingState = .idle
    @Published public private(set) var level: Float = 0
    @Published public private(set) var markerCount = 0
    @Published public private(set) var silenceWarning = false
    /// Where the next recording goes (the signed-in workspace; the HUD picks the folder). nil:
    /// nobody is signed in.
    @Published public var draft: RecordingDraft?
    /// After a recording went to the upload queue.
    public var onQueued: (() -> Void)?

    private let session: RecordingSession
    private let now: () -> Date
    private var content: RecordingActivityAttributes.ContentState?
    private var observer: Task<Void, Never>?
    private var levels: Task<Void, Never>?
    private var ticker: Task<Void, Never>?

    public init(session: RecordingSession, now: @escaping () -> Date = { Date() }) {
        self.session = session
        self.now = now
        let states = session.states
        observer = Task { [weak self] in
            for await state in states {
                await self?.apply(state)
            }
        }
    }

    deinit {
        observer?.cancel()
        levels?.cancel()
        ticker?.cancel()
    }

    // MARK: - Commands

    /// Starts when nothing is recording, stops when something is.
    public func toggle() async {
        switch state {
        case .idle, .failed: await start()
        case .recording, .paused: await stop()
        case .saving: break
        }
    }

    public func pauseResume() async {
        guard state.isLive else { return }
        await session.togglePause()
    }

    public func addMarker() async {
        guard state.isLive else { return }
        await session.addMarker()
    }

    /// The running elapsed time again (every second while recording; tests call it directly).
    public func tick() {
        guard case .recording = state, let content, content.phase == .recording else { return }
        state = .recording(elapsedMs: Self.elapsedMs(content, at: now()))
    }

    // MARK: - Text

    /// "0:07", "12:05", "1:02:05".
    public nonisolated static func elapsedText(_ ms: Int) -> String {
        RecordingActivityAttributes.clockText(ms)
    }

    /// What the menu bar shows next to the icon: the elapsed time while recording.
    public nonisolated static func menuBarTitle(_ state: MacRecordingState) -> String? {
        switch state {
        case let .recording(ms), let .paused(ms): elapsedText(ms)
        default: nil
        }
    }

    /// "Lectern, 녹음 중 12분 5초" / "Lectern".
    public nonisolated static func menuBarAccessibilityLabel(_ state: MacRecordingState) -> String {
        switch state {
        case let .recording(ms): "Lectern, 녹음 중 \(TimeText.spoken(ms))"
        case let .paused(ms): "Lectern, 일시정지됨 \(TimeText.spoken(ms))"
        default: "Lectern"
        }
    }

    // MARK: - Internals

    private func start() async {
        guard let draft else {
            state = .failed(Self.signInNeededText)
            return
        }
        do {
            try await session.start(draft: draft)
        } catch RecordingError.microphoneDenied {
            state = .failed(Self.microphoneDeniedText)
            return
        } catch {
            state = .failed(error.localizedDescription)
            return
        }
        let stream = await session.levels()
        levels?.cancel()
        levels = Task { [weak self] in
            for await value in stream {
                self?.level = value
            }
            self?.level = 0
        }
    }

    private func stop() async {
        state = .saving
        do {
            let result = try await session.stop()
            state = .idle
            if result != nil { onQueued?() }
        } catch {
            state = .failed(error.localizedDescription)
        }
        reset()
    }

    private func apply(_ next: RecordingActivityAttributes.ContentState) async {
        content = next
        markerCount = next.markerCount
        silenceWarning = next.silenceWarning
        switch next.phase {
        case .recording:
            guard state != .saving else { return }
            state = .recording(elapsedMs: Self.elapsedMs(next, at: now()))
            startTicker()
        case .paused:
            guard state != .saving else { return }
            state = .paused(elapsedMs: next.pausedElapsedMs ?? 0)
        case .uploading, .finished:
            // Our own stop sets the state when it returns; this is a recording that ended
            // without it (the recorder failed while writing).
            guard state.isLive else { return }
            if next.phase == .finished, let failure = await session.lastFailure {
                state = .failed(failure)
            } else {
                state = .idle
            }
            reset()
        }
    }

    private func reset() {
        ticker?.cancel()
        ticker = nil
        level = 0
        markerCount = 0
        silenceWarning = false
        content = nil
    }

    private func startTicker() {
        guard ticker == nil else { return }
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                self?.tick()
            }
        }
    }

    private nonisolated static func elapsedMs(_ content: RecordingActivityAttributes.ContentState, at date: Date) -> Int {
        max(0, Int((date.timeIntervalSince(content.startedAt) * 1000).rounded()))
    }
}
