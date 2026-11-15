import Foundation

/// Two mono streams at one sample rate (the input side converts) into two channels: left the
/// microphone, right the system audio.
///
/// - A side that has nothing yet is silence: a system tap may deliver no buffers while nothing
///   plays, and the microphone must still be recorded.
/// - When one side gets more than `maxLagSeconds` ahead of the other, the lagging side is padded
///   with silence up to it, so the two channels never drift apart by more than that.
/// - Samples are clamped to -1...1.
///
/// A value type over two ring buffers (classes): a copy shares them. Not thread-safe; the owner
/// serializes pushes and pulls.
public struct ChannelMixer {
    public let sampleRate: Double
    public let maxLagFrames: Int
    public private(set) var droppedMicFrames = 0
    public private(set) var droppedSystemFrames = 0
    private let mic: RingBuffer
    private let system: RingBuffer

    public init(sampleRate: Double, maxLagSeconds: Double = 0.5) {
        self.sampleRate = sampleRate
        maxLagFrames = max(1, Int((sampleRate * maxLagSeconds).rounded()))
        // Both sides the same size: a catch-up pads the lagging side up to what the other holds,
        // so the pad always fits and never drops anything.
        let capacity = max(maxLagFrames * 4, Int(sampleRate * 10))
        mic = RingBuffer(capacity: capacity)
        system = RingBuffer(capacity: capacity)
    }

    /// Microphone frames waiting to be pulled.
    public var bufferedMicFrames: Int { mic.available }
    /// System frames waiting to be pulled.
    public var bufferedSystemFrames: Int { system.available }

    public mutating func pushMic(_ samples: [Float]) {
        droppedMicFrames += mic.write(samples)
        catchUp()
    }

    public mutating func pushSystem(_ samples: [Float]) {
        droppedSystemFrames += system.write(samples)
        catchUp()
    }

    /// Exactly `frames` on each side; a side that has fewer is filled with silence.
    public mutating func pull(frames: Int) -> (left: [Float], right: [Float]) {
        let count = max(frames, 0)
        return (Self.padded(mic.read(count: count), to: count), Self.padded(system.read(count: count), to: count))
    }

    /// Everything left (at stop), the shorter side padded with silence to the longer.
    public mutating func drain() -> (left: [Float], right: [Float]) {
        pull(frames: max(mic.available, system.available))
    }

    private mutating func catchUp() {
        let lead = mic.available - system.available
        if lead > maxLagFrames {
            droppedSystemFrames += system.writeSilence(lead)
        } else if -lead > maxLagFrames {
            droppedMicFrames += mic.writeSilence(-lead)
        }
    }

    private static func padded(_ samples: [Float], to count: Int) -> [Float] {
        var out = samples.map { min(max($0, -1), 1) }
        if out.count < count { out.append(contentsOf: repeatElement(0, count: count - out.count)) }
        return out
    }
}
