import AVFAudio
import Foundation
@testable import RecorderKit
import XCTest

/// A system audio source the test drives; its start can be made to fail.
private final class FakeSystemAudio: SystemAudioSource, @unchecked Sendable {
    private let lock = NSLock()
    private var callback: (@Sendable ([Float]) -> Void)?
    private var failure: SystemAudioError?
    private var stopCount = 0

    init(failing failure: SystemAudioError? = nil) {
        self.failure = failure
    }

    var isStarted: Bool { lock.withLock { callback != nil } }
    var stops: Int { lock.withLock { stopCount } }

    func start(onSamples: @escaping @Sendable ([Float]) -> Void) throws {
        try lock.withLock {
            if let failure { throw failure }
            callback = onSamples
        }
    }

    func stop() {
        lock.withLock {
            callback = nil
            stopCount += 1
        }
    }

    func send(_ samples: [Float]) {
        lock.withLock { callback }?(samples)
    }
}

/// Buffers delivered by the input under test.
private final class Received: @unchecked Sendable {
    private let lock = NSLock()
    private var buffers: [AVAudioPCMBuffer] = []
    private var failures: [SystemAudioError] = []

    func add(_ buffer: AVAudioPCMBuffer) { lock.withLock { buffers.append(buffer) } }
    func fail(_ error: SystemAudioError) { lock.withLock { failures.append(error) } }
    var all: [AVAudioPCMBuffer] { lock.withLock { buffers } }
    var errors: [SystemAudioError] { lock.withLock { failures } }
}

final class DualInputTests: XCTestCase {
    private func until(_ condition: () -> Bool) {
        for _ in 0..<400 where !condition() {
            Thread.sleep(forTimeInterval: 0.005)
        }
    }

    private func channel(_ buffer: AVAudioPCMBuffer, _ index: Int) -> [Float] {
        Array(UnsafeBufferPointer(start: buffer.floatChannelData![index], count: Int(buffer.frameLength)))
    }

    func testMicrophoneLeftSystemRight() throws {
        let mic = FakeAudioInput()
        let system = FakeSystemAudio()
        let input = DualInput(mic: mic, system: system)
        XCTAssertEqual(input.format.channelCount, 2)
        let received = Received()
        try input.start(onBuffer: { received.add($0) })
        until { system.isStarted }
        system.send([Float](repeating: 0.5, count: 4096))
        mic.send(1, frames: 4096, value: 0.1)
        until { !received.all.isEmpty }

        let buffer = try XCTUnwrap(received.all.first)
        XCTAssertEqual(buffer.frameLength, 4096)
        XCTAssertEqual(buffer.format.channelCount, 2)
        XCTAssertEqual(channel(buffer, 0), [Float](repeating: 0.1, count: 4096))
        XCTAssertEqual(channel(buffer, 1), [Float](repeating: 0.5, count: 4096))
        input.stop()
    }

    func testSystemFailureKeepsRecordingTheMicrophone() throws {
        let mic = FakeAudioInput()
        let input = DualInput(mic: mic, system: FakeSystemAudio(failing: .permissionDenied))
        let received = Received()
        input.onSystemAudioFailed = { received.fail($0) }
        try input.start(onBuffer: { received.add($0) })
        until { !received.errors.isEmpty }
        XCTAssertEqual(received.errors, [.permissionDenied])

        mic.send(2, frames: 4096, value: 0.2)
        until { received.all.count == 2 }
        XCTAssertEqual(received.all.count, 2)
        for buffer in received.all {
            XCTAssertEqual(buffer.format.channelCount, 2)
            XCTAssertEqual(channel(buffer, 0), [Float](repeating: 0.2, count: 4096))
            XCTAssertEqual(channel(buffer, 1), [Float](repeating: 0, count: 4096))  // silent right channel
        }
        input.stop()
    }

    func testSilentSystemDoesNotHoldTheMicrophoneBack() throws {
        let mic = FakeAudioInput()
        let system = FakeSystemAudio()
        let input = DualInput(mic: mic, system: system)
        let received = Received()
        try input.start(onBuffer: { received.add($0) })
        mic.send(3, frames: 4096, value: 0.3)  // nothing plays: the tap gives no buffers
        until { received.all.count == 3 }
        XCTAssertEqual(received.all.count, 3)
        input.stop()
    }

    func testStopEndsDeliveryAndStopsBoth() throws {
        let mic = FakeAudioInput()
        let system = FakeSystemAudio()
        let input = DualInput(mic: mic, system: system)
        let received = Received()
        try input.start(onBuffer: { received.add($0) })
        until { system.isStarted }
        input.stop()
        until { system.stops > 0 }
        XCTAssertEqual(mic.stops, 1)
        XCTAssertGreaterThan(system.stops, 0)
        mic.send(1, frames: 4096)
        Thread.sleep(forTimeInterval: 0.05)
        XCTAssertTrue(received.all.isEmpty)
    }

    func testMicrophoneStartFailureThrows() {
        let mic = FakeAudioInput()
        mic.failStarts()
        let system = FakeSystemAudio()
        let input = DualInput(mic: mic, system: system)
        XCTAssertThrowsError(try input.start(onBuffer: { _ in }))
        Thread.sleep(forTimeInterval: 0.05)
        XCTAssertFalse(system.isStarted)
    }
}
