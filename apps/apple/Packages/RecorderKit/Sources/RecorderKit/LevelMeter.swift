import Foundation

/// RMS of the samples in dBFS; silence (or no samples) is -120.
public func dbfs(samples: UnsafeBufferPointer<Float>) -> Float {
    guard !samples.isEmpty else { return -120 }
    var sum: Float = 0
    for sample in samples { sum += sample * sample }
    let rms = (sum / Float(samples.count)).squareRoot()
    guard rms > 0 else { return -120 }
    return max(-120, 20 * log10(rms))
}

/// 0...1 for a level meter: -60 dB and below is 0, 0 dB and above is 1, linear in between.
public func normalizedLevel(dbfs: Float) -> Float {
    min(1, max(0, (dbfs + 60) / 60))
}

/// Warns when the input stays under a threshold for a while (a muted mic, a closed laptop lid).
/// One buffer above the threshold clears it. Paused time is not fed, so it does not count.
public struct SilenceDetector: Sendable {
    private let thresholdDb: Float
    private let seconds: Double
    private var quietFor: Double = 0

    public init(thresholdDb: Float = -50, seconds: Double = 20) {
        self.thresholdDb = thresholdDb
        self.seconds = seconds
    }

    /// True while the warning should show.
    public mutating func feed(dbfs: Float, duration: Double) -> Bool {
        if dbfs < thresholdDb {
            quietFor += duration
        } else {
            quietFor = 0
        }
        return quietFor >= seconds - 1e-9
    }

    public mutating func reset() {
        quietFor = 0
    }
}

/// At most one meter value per `interval` of audio (not wall-clock), the loudest buffer of
/// that stretch, so a 4096-frame tap and a 512-frame tap give the meter the same pace.
public struct LevelThrottle: Sendable {
    private let framesPerValue: Double
    private var frames: Double = 0
    private var loudest: Float = -120

    public init(sampleRate: Double, interval: Double = 0.1) {
        framesPerValue = sampleRate * interval
    }

    /// The normalized level to show now, or nil to wait for more audio.
    public mutating func feed(dbfs: Float, frames count: Int) -> Float? {
        frames += Double(count)
        loudest = max(loudest, dbfs)
        guard frames >= framesPerValue - 1e-9 else { return nil }
        let level = normalizedLevel(dbfs: loudest)
        frames = 0
        loudest = -120
        return level
    }
}
