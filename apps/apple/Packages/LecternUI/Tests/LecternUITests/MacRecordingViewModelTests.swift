import AVFAudio
import Combine
import Foundation
import LecternIntents
@testable import LecternUI
import RecorderKit
import XCTest

/// Buffers pushed by the test to whoever started it (0.1 s each).
private final class TestAudioInput: AudioInput, @unchecked Sendable {
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44_100, channels: 1, interleaved: false)!
    private let lock = NSLock()
    private var callback: (@Sendable (AVAudioPCMBuffer) -> Void)?

    func start(onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws { lock.withLock { callback = onBuffer } }
    func stop() { lock.withLock { callback = nil } }

    func send(_ count: Int) {
        for _ in 0..<count {
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4410)!
            buffer.frameLength = 4410
            for i in 0..<4410 { buffer.floatChannelData![0][i] = 0.1 }
            lock.withLock { callback }?(buffer)
        }
    }
}

private final class TestAudioSink: AudioSink, @unchecked Sendable {
    private let lock = NSLock()
    private var frames: Int64 = 0
    func open(url: URL, sampleRate: Double, channels: Int) throws { FileManager.default.createFile(atPath: url.path, contents: Data("m4a".utf8)) }
    func write(_ buffer: AVAudioPCMBuffer) throws { lock.withLock { frames += Int64(buffer.frameLength) } }
    func close() throws {}
    var framesWritten: Int64 { lock.withLock { frames } }
}

private struct NoActivity: RecordingActivityController {
    func start(attributes: RecordingActivityAttributes, state: RecordingActivityAttributes.ContentState) async -> Bool { false }
    func update(state: RecordingActivityAttributes.ContentState) async {}
    func end(state: RecordingActivityAttributes.ContentState, dismissAfter: TimeInterval) async {}
    func endLeftovers() async {}
}

private actor Enqueued {
    var count = 0
    var failNext = false
    func failOnce() { failNext = true }
    func take() throws {
        if failNext {
            failNext = false
            throw RecordingError.failed("업로드 대기열에 넣지 못했습니다.")
        }
        count += 1
    }
}

private final class Clock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Date(timeIntervalSince1970: 1_792_387_800)
    var now: Date { lock.withLock { value } }
    func advance(_ seconds: TimeInterval) { lock.withLock { value = value.addingTimeInterval(seconds) } }
}

@MainActor
final class MacRecordingViewModelTests: XCTestCase {
    private var directory: URL!
    private var input: TestAudioInput!
    private var enqueued: Enqueued!
    private var clock: Clock!
    private var permission = true
    private var history: [MacRecordingState] = []
    private var cancellable: AnyCancellable?

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("mac-\(UUID().uuidString)", isDirectory: true)
        input = TestAudioInput()
        enqueued = Enqueued()
        clock = Clock()
        permission = true
        history = []
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func model() -> MacRecordingViewModel {
        let input = input!, directory = directory!, enqueued = enqueued!, clock = clock!, permission = permission
        let session = RecordingSession(
            makeRecorder: { Recorder(input: input, sink: TestAudioSink(), directory: directory, now: { clock.now }) },
            activity: NoActivity(),
            enqueue: { _, _ in try await enqueued.take() },
            now: { clock.now },
            hooks: RecordingHooks(requestPermission: { permission })
        )
        let model = MacRecordingViewModel(session: session, now: { clock.now })
        model.draft = RecordingDraft(workspaceID: "ws_1")
        cancellable = model.$state.removeDuplicates().sink { [weak self] in self?.history.append($0) }
        return model
    }

    private func until(_ condition: () -> Bool) async {
        for _ in 0..<400 where !condition() {
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    private var files: [String] { (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [] }

    func testToggleStartsAndStops() async {
        let m = model()
        await m.toggle()
        await until { m.state.isLive }
        input.send(30)  // 3 s
        await m.toggle()
        XCTAssertEqual(m.state, .idle)
        XCTAssertEqual(history.map(\.label), ["idle", "recording", "saving", "idle"])
        let count = await enqueued.count
        XCTAssertEqual(count, 1)
    }

    func testShortRecordingIsDiscarded() async {
        let m = model()
        await m.toggle()
        input.send(10)  // 1 s
        await m.toggle()
        XCTAssertEqual(m.state, .idle)
        let count = await enqueued.count
        XCTAssertEqual(count, 0)
        XCTAssertEqual(files, [])
    }

    func testPauseResume() async {
        let m = model()
        await m.toggle()
        input.send(100)  // 10 s on the file
        clock.advance(10)
        await m.pauseResume()
        await until { if case .paused = m.state { true } else { false } }
        XCTAssertEqual(m.state, .paused(elapsedMs: 10_000))
        clock.advance(30)
        m.tick()
        XCTAssertEqual(m.state, .paused(elapsedMs: 10_000))  // frozen
        await m.pauseResume()
        await until { if case .recording = m.state { true } else { false } }
        clock.advance(5)
        m.tick()
        XCTAssertEqual(m.state, .recording(elapsedMs: 15_000))  // the pause is not counted
    }

    func testMarkerWhileIdleDoesNothing() async {
        let m = model()
        await m.addMarker()
        XCTAssertEqual(m.state, .idle)
        XCTAssertEqual(m.markerCount, 0)
    }

    func testMicrophoneDenied() async {
        permission = false
        let m = model()
        await m.toggle()
        guard case let .failed(message) = m.state else { return XCTFail("\(m.state)") }
        XCTAssertTrue(message.hasPrefix("마이크 권한이 필요합니다."), message)
        XCTAssertEqual(message, MacRecordingViewModel.microphoneDeniedText)
    }

    func testElapsedFormatting() {
        XCTAssertEqual(MacRecordingViewModel.elapsedText(7_000), "0:07")
        XCTAssertEqual(MacRecordingViewModel.elapsedText(725_000), "12:05")
        XCTAssertEqual(MacRecordingViewModel.elapsedText(3_725_000), "1:02:05")
    }

    func testMenuBarAccessibilityLabel() {
        XCTAssertEqual(MacRecordingViewModel.menuBarAccessibilityLabel(.recording(elapsedMs: 725_000)), "Lectern, 녹음 중 12분 5초")
        XCTAssertEqual(MacRecordingViewModel.menuBarAccessibilityLabel(.idle), "Lectern")
        XCTAssertEqual(MacRecordingViewModel.menuBarTitle(.recording(elapsedMs: 725_000)), "12:05")
        XCTAssertNil(MacRecordingViewModel.menuBarTitle(.idle))
    }

    func testHotKeyDisplayString() {
        let combo = HotKeyCombo(keyCode: 0x0F, command: true, shift: false, option: true, control: false)  // R
        XCTAssertEqual(combo.displayString, "⌥⌘R")
        XCTAssertEqual(HotKeyCombo.default.displayString, "⌥Space")
        XCTAssertTrue(combo.isUsable)
        XCTAssertFalse(HotKeyCombo(keyCode: 0x0F, modifiers: HotKeyCombo.shift).isUsable)
    }

    func testEnqueueFailureSurfaces() async {
        let m = model()
        await m.toggle()
        input.send(50)
        await enqueued.failOnce()
        await m.toggle()
        XCTAssertEqual(m.state, .failed("업로드 대기열에 넣지 못했습니다."))
        XCTAssertEqual(files.count, 1)  // the recording is kept
    }

    // MARK: - Beyond the spec

    func testNoDraftAsksToSignIn() async {
        let m = model()
        m.draft = nil
        await m.toggle()
        XCTAssertEqual(m.state, .failed(MacRecordingViewModel.signInNeededText))
    }

    func testHotKeyComboRoundTrip() {
        let defaults = UserDefaults(suiteName: "hotkey-\(UUID().uuidString)")!
        XCTAssertEqual(HotKeyCombo.load(from: defaults), .default)
        let combo = HotKeyCombo(keyCode: 0x0F, modifiers: HotKeyCombo.command | HotKeyCombo.option)
        combo.save(to: defaults)
        XCTAssertEqual(HotKeyCombo.load(from: defaults), combo)
    }
}

private extension MacRecordingState {
    var label: String {
        switch self {
        case .idle: "idle"
        case .recording: "recording"
        case .paused: "paused"
        case .saving: "saving"
        case .failed: "failed"
        }
    }
}
