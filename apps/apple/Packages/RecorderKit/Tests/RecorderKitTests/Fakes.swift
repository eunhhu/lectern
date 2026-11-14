import AVFAudio
import Foundation
@testable import RecorderKit

func makeBuffer(_ format: AVAudioFormat, frames: AVAudioFrameCount, value: Float) -> AVAudioPCMBuffer {
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
    buffer.frameLength = frames
    for channel in 0..<Int(format.channelCount) {
        let samples = buffer.floatChannelData![channel]
        for i in 0..<Int(frames) { samples[i] = value }
    }
    return buffer
}

struct FakeError: Error, LocalizedError {
    var errorDescription: String? { "fake" }
}

/// Buffers pushed by the test, synchronously, to whoever started it.
final class FakeAudioInput: AudioInput, @unchecked Sendable {
    let format: AVAudioFormat
    private let lock = NSLock()
    private var callback: (@Sendable (AVAudioPCMBuffer) -> Void)?
    private var startCount = 0
    private var stopCount = 0
    private var failures = 0

    init(sampleRate: Double = 44_100) {
        format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
    }

    var starts: Int { lock.withLock { startCount } }
    var stops: Int { lock.withLock { stopCount } }

    /// The next `times` starts throw.
    func failStarts(_ times: Int = 1) {
        lock.withLock { failures = times }
    }

    func start(onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws {
        try lock.withLock {
            if failures > 0 {
                failures -= 1
                throw FakeError()
            }
            callback = onBuffer
            startCount += 1
        }
    }

    func stop() {
        lock.withLock {
            callback = nil
            stopCount += 1
        }
    }

    /// `count` buffers of `frames` frames (4410 = 0.1 s at 44.1 kHz), every sample `value`.
    func send(_ count: Int = 1, frames: AVAudioFrameCount = 4410, value: Float = 0.1) {
        for _ in 0..<count {
            let deliver = lock.withLock { callback }
            deliver?(makeBuffer(format, frames: frames, value: value))
        }
    }
}

/// Counts what it is given; creates an empty file on open so "the file is kept" can be checked.
final class FakeAudioSink: AudioSink, @unchecked Sendable {
    private let lock = NSLock()
    private var frames: Int64 = 0
    private var bufferCount = 0
    private var closeCount = 0
    private var openedURL: URL?
    var failWrites = false
    var failClose = false

    var buffers: Int { lock.withLock { bufferCount } }
    var closes: Int { lock.withLock { closeCount } }
    var opened: URL? { lock.withLock { openedURL } }

    func open(url: URL, sampleRate: Double, channels: Int) throws {
        FileManager.default.createFile(atPath: url.path, contents: Data())
        lock.withLock { openedURL = url }
    }

    func write(_ buffer: AVAudioPCMBuffer) throws {
        try lock.withLock {
            if failWrites { throw FakeError() }
            frames += Int64(buffer.frameLength)
            bufferCount += 1
        }
    }

    func close() throws {
        try lock.withLock {
            closeCount += 1
            if failClose { throw FakeError() }
        }
    }

    var framesWritten: Int64 { lock.withLock { frames } }
}
