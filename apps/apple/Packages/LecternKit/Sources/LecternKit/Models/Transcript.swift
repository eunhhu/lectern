import Foundation

/// The whole transcript of a recording. Times are ms of the original audio.
public struct Transcript: Sendable, Equatable {
    public struct Segment: Sendable, Equatable, Identifiable {
        public let idx: Int
        public let startMs: Int
        public let endMs: Int
        public let speakerID: String?
        public let text: String
        public var id: Int { idx }

        public init(idx: Int, startMs: Int, endMs: Int, speakerID: String?, text: String) {
            self.idx = idx
            self.startMs = startMs
            self.endMs = endMs
            self.speakerID = speakerID
            self.text = text
        }
    }

    /// A stretch with no transcript (a break, the tail, a chunk that failed).
    public struct Gap: Sendable, Equatable {
        public let kind: String
        public let startMs: Int
        public let endMs: Int

        public init(kind: String, startMs: Int, endMs: Int) {
            self.kind = kind
            self.startMs = startMs
            self.endMs = endMs
        }
    }

    public let recordingID: String
    public let segments: [Segment]
    public let speakers: [Speaker]
    public let gaps: [Gap]

    public init(recordingID: String, segments: [Segment], speakers: [Speaker], gaps: [Gap]) {
        self.recordingID = recordingID
        self.segments = segments
        self.speakers = speakers
        self.gaps = gaps
    }

    /// The speaker of a segment, by its id.
    public func speaker(of segment: Segment) -> Speaker? {
        speakers.first { $0.id == segment.speakerID }
    }

    init(_ t: Components.Schemas.Transcript) {
        recordingID = t.recording_id
        segments = t.segments.map { Segment(idx: $0.idx, startMs: $0.start_ms, endMs: $0.end_ms, speakerID: $0.speaker_id, text: $0.text) }
        speakers = t.speakers.map(Speaker.init)
        gaps = t.gaps.map { Gap(kind: $0.kind, startMs: $0.start_ms, endMs: $0.end_ms) }
    }
}
