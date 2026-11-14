import Foundation
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

/// The recording Live Activity's fixed part and its changing state. The app and the widget
/// extension both use it, so it holds only values (no recorder).
public struct RecordingActivityAttributes: Codable, Hashable, Sendable {
    public enum Phase: String, Codable, Hashable, Sendable {
        case recording, paused, uploading, finished
    }

    public struct ContentState: Codable, Hashable, Sendable {
        public var phase: Phase
        /// Moved on each resume so that a timer counting from it shows the recorded time without
        /// the pauses (`timerStart`).
        public var startedAt: Date
        /// While not recording: the frozen elapsed time (after a stop, the recording's length).
        public var pausedElapsedMs: Int?
        public var markerCount: Int
        public var silenceWarning: Bool

        public init(phase: Phase, startedAt: Date, pausedElapsedMs: Int? = nil, markerCount: Int = 0, silenceWarning: Bool = false) {
            self.phase = phase
            self.startedAt = startedAt
            self.pausedElapsedMs = pausedElapsedMs
            self.markerCount = markerCount
            self.silenceWarning = silenceWarning
        }
    }

    /// "새 녹음", the recording's title, or the folder it goes to.
    public var title: String

    public init(title: String) {
        self.title = title
    }
}

#if canImport(ActivityKit) && os(iOS)
extension RecordingActivityAttributes: ActivityAttributes {}
#endif

/// Where a timer that counts up from the result shows `recordedMs` now.
public func timerStart(now: Date, recordedMs: Int) -> Date {
    now.addingTimeInterval(-Double(recordedMs) / 1000)
}

/// How the elapsed time is drawn: a running timer while recording, fixed text otherwise.
public enum ElapsedDisplay: Equatable, Sendable {
    case timer(since: Date)
    case fixed(String)
}

extension RecordingActivityAttributes.ContentState {
    public var elapsedDisplay: ElapsedDisplay {
        phase == .recording ? .timer(since: startedAt) : .fixed(RecordingActivityAttributes.clockText(pausedElapsedMs ?? 0))
    }

    /// The state in words (shown next to the color and the icon).
    public var statusText: String {
        switch phase {
        case .recording: "녹음 중"
        case .paused: "일시정지됨"
        case .uploading: "올리는 중"
        case .finished: "녹음 끝"
        }
    }

    public var isLive: Bool { phase == .recording || phase == .paused }
}

extension RecordingActivityAttributes {
    public static let silenceText = "소리가 들리지 않습니다"

    /// "0:10", "12:05", "1:02:05" (minutes and seconds; hours once there are any).
    public static func clockText(_ ms: Int) -> String {
        let total = max(0, ms) / 1000
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}
