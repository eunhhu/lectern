import AVFAudio
import Foundation
@testable import LecternIntents
import RecorderKit

struct FakeError: Error, LocalizedError {
    var errorDescription: String? { "fake" }
}

/// Buffers pushed by the test, synchronously, to whoever started it (0.1 s each by default).
final class FakeAudioInput: AudioInput, @unchecked Sendable {
    let format: AVAudioFormat
    private let lock = NSLock()
    private var callback: (@Sendable (AVAudioPCMBuffer) -> Void)?

    init() {
        format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44_100, channels: 1, interleaved: false)!
    }

    func start(onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws {
        lock.withLock { callback = onBuffer }
    }

    func stop() {
        lock.withLock { callback = nil }
    }

    func send(_ count: Int = 1, value: Float = 0.1) {
        for _ in 0..<count {
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4410)!
            buffer.frameLength = 4410
            for i in 0..<4410 { buffer.floatChannelData![0][i] = value }
            let deliver = lock.withLock { callback }
            deliver?(buffer)
        }
    }
}

/// Counts frames; creates an empty file on open so "the file is kept" can be checked.
final class FakeAudioSink: AudioSink, @unchecked Sendable {
    private let lock = NSLock()
    private var frames: Int64 = 0
    private var failing = false

    var failWrites: Bool {
        get { lock.withLock { failing } }
        set { lock.withLock { failing = newValue } }
    }

    func open(url: URL, sampleRate: Double, channels: Int) throws {
        FileManager.default.createFile(atPath: url.path, contents: Data("m4a".utf8))
    }

    func write(_ buffer: AVAudioPCMBuffer) throws {
        try lock.withLock {
            if failing { throw FakeError() }
            frames += Int64(buffer.frameLength)
        }
    }

    func close() throws {}

    var framesWritten: Int64 { lock.withLock { frames } }
}

final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date) {
        current = start
    }

    var now: Date { lock.withLock { current } }

    func advance(_ seconds: TimeInterval) {
        lock.withLock { current = current.addingTimeInterval(seconds) }
    }
}

/// Records every call; `enabled == false` acts like Live Activities turned off in Settings.
actor FakeActivity: RecordingActivityController {
    enum Call: Equatable {
        case start(title: String, state: RecordingActivityAttributes.ContentState)
        case update(RecordingActivityAttributes.ContentState)
        case end(RecordingActivityAttributes.ContentState, dismissAfter: TimeInterval)
        case endLeftovers
    }

    private let enabled: Bool
    private(set) var calls: [Call] = []

    init(enabled: Bool = true) {
        self.enabled = enabled
    }

    var starts: Int { calls.filter { if case .start = $0 { true } else { false } }.count }
    var updates: [RecordingActivityAttributes.ContentState] {
        calls.compactMap { if case let .update(state) = $0 { state } else { nil } }
    }
    var ends: [(RecordingActivityAttributes.ContentState, TimeInterval)] {
        calls.compactMap { if case let .end(state, after) = $0 { (state, after) } else { nil } }
    }

    func start(attributes: RecordingActivityAttributes, state: RecordingActivityAttributes.ContentState) async -> Bool {
        calls.append(.start(title: attributes.title, state: state))
        return enabled
    }

    func update(state: RecordingActivityAttributes.ContentState) async {
        calls.append(.update(state))
    }

    func end(state: RecordingActivityAttributes.ContentState, dismissAfter: TimeInterval) async {
        calls.append(.end(state, dismissAfter: dismissAfter))
    }

    func endLeftovers() async {
        calls.append(.endLeftovers)
    }
}

/// What the session handed to the upload queue; throws when told to.
actor FakeEnqueue {
    private(set) var received: [(RecordingResult, RecordingDraft)] = []
    private var error: Error?

    func failNext(_ error: Error) {
        self.error = error
    }

    func callAsFunction(_ result: RecordingResult, _ draft: RecordingDraft) throws {
        if let error {
            self.error = nil
            throw error
        }
        received.append((result, draft))
    }
}

/// The hooks' calls.
final class HookLog: @unchecked Sendable {
    private let lock = NSLock()
    private var activeValues: [Bool] = []
    private var activations = 0
    private var deactivations = 0
    var permission = true

    var active: [Bool] { lock.withLock { activeValues } }
    var activated: Int { lock.withLock { activations } }
    var deactivated: Int { lock.withLock { deactivations } }

    var hooks: RecordingHooks {
        RecordingHooks(
            requestPermission: { [self] in permission },
            activate: { [self] _ in lock.withLock { activations += 1 } },
            deactivate: { [self] in lock.withLock { deactivations += 1 } },
            activeChanged: { [self] value in lock.withLock { activeValues.append(value) } }
        )
    }
}
