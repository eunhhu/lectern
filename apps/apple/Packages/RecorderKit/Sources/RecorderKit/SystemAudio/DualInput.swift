import AVFAudio
import Foundation
import os

public enum SystemAudioError: Error, Equatable, LocalizedError, Sendable {
    case permissionDenied
    case unavailable(Int32)

    public var errorDescription: String? {
        switch self {
        case .permissionDenied:
            "시스템 오디오 녹음 권한이 필요합니다. 시스템 설정 > 개인정보 보호 및 보안 > 화면 및 시스템 오디오 녹음에서 Lectern을 켜 주세요."
        case let .unavailable(status):
            "시스템 오디오를 열지 못했습니다. (\(status))"
        }
    }
}

/// Where the system's sound comes from: mono `Float` samples at the rate it was made for.
/// `SystemAudioTap` on a Mac; a fake in tests.
public protocol SystemAudioSource: AnyObject, Sendable {
    func start(onSamples: @escaping @Sendable ([Float]) -> Void) throws
    func stop()
}

/// The microphone and the system's sound as one two-channel input: left the microphone, right
/// the system audio, in buffers of `chunkFrames`.
///
/// The microphone drives the output: a buffer goes out whenever that much microphone audio is
/// in, and the system side is silence where it has nothing. The system source starts on its own
/// queue (its first start can show the permission prompt), and if it fails the recording goes on
/// with the microphone alone and a silent right channel; `onSystemAudioFailed` says so.
public final class DualInput: AudioInput, @unchecked Sendable {
    public static let micOnlyWarning = "시스템 오디오를 녹음하지 못해 마이크만 녹음합니다."
    public static let chunkFrames = 4096

    public let format: AVAudioFormat
    private let mic: AudioInput
    private let system: SystemAudioSource
    /// Pushes, pulls and deliveries, in order, on one queue (no lock is held across `onBuffer`).
    private let mixQueue = DispatchQueue(label: "com.qucord.lectern.recorder.mix")
    private let systemQueue = DispatchQueue(label: "com.qucord.lectern.recorder.system-start")
    private var mixer: ChannelMixer  // only on mixQueue
    private let lock = NSLock()
    private var onBuffer: (@Sendable (AVAudioPCMBuffer) -> Void)?
    private var failureHandler: (@Sendable (SystemAudioError) -> Void)?
    /// Bumped by every start and stop: a system start that finishes late must not join a newer run.
    private var run = 0
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "recorder")

    /// `mic` must give mono buffers; its sample rate is the file's.
    public init(mic: AudioInput, system: SystemAudioSource) {
        precondition(mic.format.channelCount == 1, "DualInput needs a mono microphone input")
        self.mic = mic
        self.system = system
        format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: mic.format.sampleRate, channels: 2, interleaved: false)!
        mixer = ChannelMixer(sampleRate: mic.format.sampleRate)
    }

    /// Called (on a background queue) when the system audio could not start.
    public var onSystemAudioFailed: (@Sendable (SystemAudioError) -> Void)? {
        get { lock.withLock { failureHandler } }
        set { lock.withLock { failureHandler = newValue } }
    }

    public func start(onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws {
        let current: Int = lock.withLock {
            run += 1
            self.onBuffer = onBuffer
            return run
        }
        mixQueue.sync { mixer = ChannelMixer(sampleRate: format.sampleRate) }
        do {
            try mic.start(onBuffer: { [weak self] buffer in self?.receiveMic(buffer) })
        } catch {
            lock.withLock { self.onBuffer = nil }
            throw error
        }
        systemQueue.async { [weak self] in self?.startSystem(run: current) }
    }

    public func stop() {
        lock.withLock {
            run += 1
            onBuffer = nil
        }
        mic.stop()
        // In order after any start still queued or running, without waiting for it: a first
        // start can sit on the permission prompt.
        systemQueue.async { [system] in system.stop() }
    }

    // MARK: - Internals

    private func startSystem(run startedRun: Int) {
        guard lock.withLock({ run == startedRun }) else { return }
        do {
            try system.start(onSamples: { [weak self] samples in self?.receiveSystem(samples) })
        } catch {
            let failure = error as? SystemAudioError ?? .unavailable(-1)
            Self.log.error("recorder: system audio did not start: \(String(describing: failure), privacy: .public)")
            let handler = lock.withLock { run == startedRun ? failureHandler : nil }
            handler?(failure)
            return
        }
        if !lock.withLock({ run == startedRun }) { system.stop() }  // stopped while starting
    }

    private func receiveMic(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?[0] else { return }
        let samples = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
        mixQueue.async { [weak self] in
            self?.mixer.pushMic(samples)
            self?.deliverReady()
        }
    }

    private func receiveSystem(_ samples: [Float]) {
        mixQueue.async { [weak self] in
            self?.mixer.pushSystem(samples)
            self?.deliverReady()  // a stalled microphone was padded: output goes on
        }
    }

    /// On mixQueue.
    private func deliverReady() {
        while mixer.bufferedMicFrames >= Self.chunkFrames {
            let (left, right) = mixer.pull(frames: Self.chunkFrames)
            guard let deliver = lock.withLock({ onBuffer }), let buffer = makeBuffer(left: left, right: right) else { continue }
            deliver(buffer)
        }
    }

    private func makeBuffer(left: [Float], right: [Float]) -> AVAudioPCMBuffer? {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(left.count)),
              let channels = buffer.floatChannelData else { return nil }
        buffer.frameLength = AVAudioFrameCount(left.count)
        left.withUnsafeBufferPointer { channels[0].update(from: $0.baseAddress!, count: left.count) }
        right.withUnsafeBufferPointer { channels[1].update(from: $0.baseAddress!, count: right.count) }
        return buffer
    }
}
