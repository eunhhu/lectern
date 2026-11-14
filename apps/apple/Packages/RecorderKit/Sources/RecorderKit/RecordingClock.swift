import Foundation

/// Elapsed recording time with the pauses taken out, from wall-clock instants. The recorder
/// itself counts written frames (the file's own time axis); this one is for the elapsed-time
/// label and for tests. A time earlier than the last one seen is ignored.
public struct RecordingClock: Sendable {
    private var startedAt: TimeInterval?
    private var pausedAt: TimeInterval?
    private var pausedTotal: TimeInterval = 0
    private var last: TimeInterval = -.infinity

    public init() {}

    public mutating func start(at t: TimeInterval) {
        guard startedAt == nil else { return }
        startedAt = t
        last = t
    }

    public mutating func pause(at t: TimeInterval) {
        guard startedAt != nil, pausedAt == nil, t >= last else { return }
        pausedAt = t
        last = t
    }

    public mutating func resume(at t: TimeInterval) {
        guard let pausedAt, t >= last else { return }
        pausedTotal += t - pausedAt
        self.pausedAt = nil
        last = t
    }

    /// Recorded time so far in ms. While paused, the value at the pause.
    public func elapsedMs(at t: TimeInterval) -> Int {
        guard let startedAt else { return 0 }
        let now = pausedAt ?? max(t, last)
        return max(0, Int(((now - startedAt - pausedTotal) * 1000).rounded()))
    }
}
