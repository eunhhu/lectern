import AVFAudio
import Foundation
import os

public struct RecordedMarker: Sendable, Equatable, Codable {
    /// Milliseconds on the file's time axis (pauses are not in the file).
    public let atMs: Int
    public let label: String?

    public init(atMs: Int, label: String?) {
        self.atMs = atMs
        self.label = label
    }
}

public struct RecordingResult: Sendable, Equatable {
    public let fileURL: URL
    public let durationMs: Int
    public let markers: [RecordedMarker]
    public let startedAt: Date

    public init(fileURL: URL, durationMs: Int, markers: [RecordedMarker], startedAt: Date) {
        self.fileURL = fileURL
        self.durationMs = durationMs
        self.markers = markers
        self.startedAt = startedAt
    }
}

/// One recording: microphone → AAC file, with level, silence warning, pause and markers.
///
/// Buffers are written only while `recording`, so the file has no paused stretches and a marker
/// at `framesWritten × 1000 ÷ sampleRate` lands where the server's transcript puts that audio.
/// A recorder is used once: after `finished` or `failed`, make a new one.
public actor Recorder {
    private let input: AudioInput
    private let sink: AudioSink
    private let directory: URL
    private let now: @Sendable () -> Date
    private let core: RecorderCore
    private var startedAt: Date?
    /// The system stopped the input (an interruption or a route loss), whatever the pause reason
    /// says now: the next move to `recording` starts the input again first.
    private var inputNeedsRestart = false
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "recorder")

    /// The file of this recording once started. Kept after a failure, for recovery.
    public private(set) var fileURL: URL?

    public var state: RecorderState { core.state }

    public init(input: AudioInput, sink: AudioSink, directory: URL, now: @escaping @Sendable () -> Date = { Date() }) {
        self.input = input
        self.sink = sink
        self.directory = directory
        self.now = now
        core = RecorderCore(sink: sink)
    }

    /// Normalized input level (0...1), at most 10 a second, while recording; 0 when paused. Each
    /// access is a new stream, so the screen and the Live Activity can both read it.
    public nonisolated var levels: AsyncStream<Float> { core.levels.stream() }

    /// True while the input has been silent for 20 s of recording. A new stream starts with the
    /// current value.
    public nonisolated var silenceWarning: AsyncStream<Bool> { core.silence.stream() }

    /// Every state the recorder goes through, starting with the current one. Nothing is dropped
    /// (a quick pause and resume arrives as both), and the stream ends after `finished` or a
    /// failure.
    public nonisolated var stateChanges: AsyncStream<RecorderState> { core.states.stream() }

    /// Recorded time so far on the file's axis (written frames; pauses are not in it).
    public nonisolated var recordedMs: Int { core.durationMs }

    // MARK: - Commands

    /// Opens a new file in `directory` ("rec-yyyyMMdd-HHmmss.m4a", never over an existing one)
    /// and starts writing. On failure the state stays `idle` and no file is left behind.
    public func start() throws -> URL {
        guard core.state == .idle else { throw RecorderError.notIdle }
        let startDate = now()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = Self.newFileURL(in: directory, at: startDate)
        let format = input.format
        do {
            try sink.open(url: url, sampleRate: format.sampleRate, channels: Int(format.channelCount))
        } catch {
            try? FileManager.default.removeItem(at: url)
            throw error
        }
        core.onSinkFailure = { [weak self] in
            Task { await self?.cleanUpAfterSinkFailure() }
        }
        core.begin(sampleRate: format.sampleRate)
        do {
            try input.start(onBuffer: { [core] buffer in core.receive(buffer) })
        } catch {
            core.abandon()
            try? sink.close()
            try? FileManager.default.removeItem(at: url)
            throw error
        }
        fileURL = url
        startedAt = startDate
        return url
    }

    public func pause() {
        transition(.pause)
    }

    public func resume() {
        transition(.resume)
    }

    /// Interruptions and route changes from `SessionCoordinator` (and pause/resume). Start, stop
    /// and sink events only come from `start()`, `stop()` and the sink.
    public func handle(_ event: RecorderEvent) {
        switch event {
        case .pause, .resume, .interruptionBegan, .interruptionEnded, .routeLost, .routeRestored:
            transition(event)
        case .start, .stop, .sinkFailed, .finishedWriting:
            return
        }
    }

    /// The marker's time on the file's axis. While paused, that is the time of the pause.
    @discardableResult
    public func addMarker(label: String? = nil) -> Int {
        core.addMarker(label: label)
    }

    /// Closes the file. `finished` once it is closed; if closing fails, `failed` and the file is
    /// kept.
    public func stop() async throws -> RecordingResult {
        switch core.state {
        case .recording, .paused:
            break
        case let .failed(message):
            throw RecorderError.failed(message)
        default:
            throw RecorderError.notRecording
        }
        core.apply(.stop)  // writes stop here: they happen only while `recording`
        guard core.state == .stopping else {
            if case let .failed(message) = core.state { throw RecorderError.failed(message) }
            throw RecorderError.notRecording
        }
        input.stop()
        do {
            try core.closeSink()
        } catch {
            let message = Self.writeFailureMessage
            Self.log.error("recorder: closing the file failed: \(error.localizedDescription, privacy: .public)")
            core.apply(.sinkFailed(message))
            core.finishStreams()
            throw RecorderError.failed(message)
        }
        core.apply(.finishedWriting)
        core.finishStreams()
        return RecordingResult(fileURL: fileURL!, durationMs: core.durationMs, markers: core.markers, startedAt: startedAt!)
    }

    // MARK: - Internals

    static let writeFailureMessage = "녹음 파일을 쓰지 못했습니다. 지금까지 녹음한 부분은 남아 있습니다."

    private func transition(_ event: RecorderEvent) {
        if event == .interruptionBegan || event == .routeLost {
            inputNeedsRestart = true  // even when already paused: the engine is stopped either way
        }
        let current = core.state
        let next = reduce(current, event)
        guard next != current else { return }
        if next == .recording && inputNeedsRestart {
            // Start the input before saying `recording`: if it cannot start (the session is not
            // back yet), stay paused rather than "record" nothing.
            input.stop()
            do {
                try input.start(onBuffer: { [core] buffer in core.receive(buffer) })
                inputNeedsRestart = false
            } catch {
                Self.log.error("recorder: input did not restart: \(error.localizedDescription, privacy: .public)")
                return
            }
        }
        core.apply(event)
    }

    private func cleanUpAfterSinkFailure() {
        input.stop()
        try? core.closeSink()  // best effort: an unclosed .m4a cannot be played
        core.finishStreams()
    }

    static func newFileURL(in directory: URL, at date: Date) -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let base = "rec-\(formatter.string(from: date))"
        var url = directory.appendingPathComponent("\(base).m4a")
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = directory.appendingPathComponent("\(base)-\(n).m4a")
            n += 1
        }
        return url
    }
}

/// The part of the recorder the audio thread touches: state, the sink, markers, meters. One lock
/// guards it; nothing calls into the input while holding it (a tap waiting on this lock during
/// teardown would deadlock), and streams are yielded and finished outside it.
final class RecorderCore: @unchecked Sendable {
    let levels = Broadcast<Float>()
    let silence = Broadcast<Bool>(initial: false)
    let states = Broadcast<RecorderState>(initial: .idle, keepsAll: true)

    private let lock = NSLock()
    private let sink: AudioSink
    private var current: RecorderState = .idle
    private var sampleRate: Double = 44_100
    private var silenceDetector = SilenceDetector()
    private var warning = false
    private var throttle = LevelThrottle(sampleRate: 44_100)
    private var recordedMarkers: [RecordedMarker] = []
    private var failureHandler: (@Sendable () -> Void)?

    init(sink: AudioSink) {
        self.sink = sink
    }

    var state: RecorderState { lock.withLock { current } }
    var markers: [RecordedMarker] { lock.withLock { recordedMarkers } }
    var durationMs: Int { lock.withLock { ms(sink.framesWritten) } }

    var onSinkFailure: (@Sendable () -> Void)? {
        get { lock.withLock { failureHandler } }
        set { lock.withLock { failureHandler = newValue } }
    }

    func begin(sampleRate: Double) {
        let after = lock.withLock { () -> RecorderState in
            self.sampleRate = sampleRate
            throttle = LevelThrottle(sampleRate: sampleRate)
            current = reduce(current, .start)
            return current
        }
        states.yield(after)
    }

    /// `start()` failed after `begin`: back to the beginning.
    func abandon() {
        lock.withLock { current = .idle }
        states.yield(.idle)
    }

    func apply(_ event: RecorderEvent) {
        let (before, after) = lock.withLock { () -> (RecorderState, RecorderState) in
            let before = current
            current = reduce(current, event)
            return (before, current)
        }
        if before == .recording, case .paused = after {
            levels.yield(0)
        }
        if before != after { states.yield(after) }
    }

    func receive(_ buffer: AVAudioPCMBuffer) {
        var level: Float?
        var warningChanged: Bool?
        var failed: (@Sendable () -> Void)?
        var failedState: RecorderState?
        lock.withLock {
            guard current == .recording else { return }
            do {
                try sink.write(buffer)
            } catch {
                current = reduce(current, .sinkFailed(Recorder.writeFailureMessage))
                failedState = current
                failed = failureHandler
                return
            }
            let frames = Int(buffer.frameLength)
            let db: Float = buffer.floatChannelData.map { dbfs(samples: UnsafeBufferPointer(start: $0[0], count: frames)) } ?? -120
            let silent = silenceDetector.feed(dbfs: db, duration: Double(frames) / sampleRate)
            if silent != warning {
                warning = silent
                warningChanged = silent
            }
            level = throttle.feed(dbfs: db, frames: frames)
        }
        if let level { levels.yield(level) }
        if let warningChanged { silence.yield(warningChanged) }
        if let failedState { states.yield(failedState) }
        if let failed {
            failed()
        }
    }

    @discardableResult
    func addMarker(label: String?) -> Int {
        lock.withLock {
            let atMs = ms(sink.framesWritten)
            switch current {
            case .recording, .paused:
                recordedMarkers.append(RecordedMarker(atMs: atMs, label: label))
            default:
                break
            }
            return atMs
        }
    }

    /// Under the lock, so no write is in the middle when the file closes.
    func closeSink() throws {
        try lock.withLock { try sink.close() }
    }

    func finishStreams() {
        levels.finish()
        silence.finish()
        states.finish()
    }

    /// Call with the lock held.
    private func ms(_ frames: Int64) -> Int {
        Int((Double(frames) * 1000 / sampleRate).rounded())
    }
}

/// A value fanned out to every current listener; each keeps only the newest value, unless
/// `keepsAll` (then every value, in order).
final class Broadcast<Element: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuations: [UUID: AsyncStream<Element>.Continuation] = [:]
    private let replays: Bool
    private let keepsAll: Bool
    private var last: Element?
    private var finished = false

    /// With `initial`, a new stream starts with the latest value (`initial` until something is
    /// yielded). Without it, a new stream waits for the next value.
    init(initial: Element? = nil, keepsAll: Bool = false) {
        replays = initial != nil
        self.keepsAll = keepsAll
        last = initial
    }

    func stream() -> AsyncStream<Element> {
        let (stream, continuation) = AsyncStream<Element>.makeStream(bufferingPolicy: keepsAll ? .unbounded : .bufferingNewest(1))
        let id = UUID()
        let (added, replay) = lock.withLock { () -> (Bool, Element?) in
            guard !finished else { return (false, nil) }
            continuations[id] = continuation
            return (true, last)
        }
        guard added else {
            continuation.finish()
            return stream
        }
        continuation.onTermination = { [weak self] _ in
            self?.lock.withLock { _ = self?.continuations.removeValue(forKey: id) }
        }
        if let replay { continuation.yield(replay) }
        return stream
    }

    func yield(_ value: Element) {
        let targets = lock.withLock { () -> [AsyncStream<Element>.Continuation] in
            if replays { last = value }
            return Array(continuations.values)
        }
        for continuation in targets { continuation.yield(value) }
    }

    func finish() {
        let targets = lock.withLock { () -> [AsyncStream<Element>.Continuation] in
            finished = true
            defer { continuations = [:] }
            return Array(continuations.values)
        }
        for continuation in targets { continuation.finish() }
    }
}
