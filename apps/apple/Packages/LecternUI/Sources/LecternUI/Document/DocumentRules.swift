import Foundation
import LecternKit

// What the document views show, as pure functions (the same meaning as the web's DocumentPane).

/// The blocks to draw: every known block. An unknown type draws nothing (domain freeze rule).
public func renderableBlocks(_ blocks: [DocumentBlock]) -> [DocumentBlock] {
    blocks.filter {
        if case .unknown = $0 { return false }
        return true
    }
}

/// A callout's text label (callouts are never told apart by color alone) and its color.
public enum CalloutStyle {
    /// Domain `CalloutTone`. An unknown tone reads as "참고", as on the web.
    public static func label(for tone: String) -> String {
        switch tone {
        case "exam": "시험"
        case "assignment": "과제"
        case "important": "중요"
        default: "참고"
        }
    }

    public static func toneName(for tone: String) -> Theme.ToneName {
        switch tone {
        case "exam": .danger
        case "assignment": .severe
        case "important": .attention
        default: .info
        }
    }
}

/// A gap block's line: the web's per-kind label and the stretch it covers.
public enum GapText {
    public static func text(kind: String, startMs: Int, endMs: Int) -> String {
        let label: String
        switch kind {
        case "break": label = "쉬는 시간"
        case "tail": label = "녹음 끝"
        case "missing_transcript": label = "전사하지 못한 구간"
        default: label = "전사가 비어 있는 구간입니다"
        }
        return "\(label) (\(TimeText.timestamp(startMs))–\(TimeText.timestamp(endMs)))"
    }
}

/// Transcript sources name segments by `idx`; this finds their times. Segments are ordered by
/// `idx`, so lookups are binary searches (the web's `resolveSourceRange`).
public struct SourceResolver: Sendable {
    public struct Range: Sendable, Equatable {
        /// Array positions of the first and last segment.
        public let first: Int
        public let last: Int
        public let startMs: Int
        public let endMs: Int
    }

    private let segments: [Transcript.Segment]
    private let speakers: [Speaker]

    public init(transcript: Transcript?) {
        segments = transcript?.segments ?? []
        speakers = transcript?.speakers ?? []
    }

    /// The name of the speaker of the range's first segment (a name the user gave, else `S1` …).
    public func speakerName(of range: Range) -> String? {
        guard let id = segments[range.first].speakerID else { return nil }
        return speakers.first { $0.id == id }?.name
    }

    /// nil when a segment is missing (the transcript changed, or it is not loaded).
    public func range(startIdx: Int, endIdx: Int) -> Range? {
        guard let first = position(of: startIdx), let last = position(of: endIdx), first <= last else { return nil }
        return Range(first: first, last: last, startMs: segments[first].startMs, endMs: segments[last].endMs)
    }

    private func position(of idx: Int) -> Int? {
        var lo = 0
        var hi = segments.count - 1
        while lo <= hi {
            let mid = (lo + hi) / 2
            let value = segments[mid].idx
            if value == idx { return mid }
            if value < idx { lo = mid + 1 } else { hi = mid - 1 }
        }
        return nil
    }
}

/// What a source chip shows and says.
public struct SourceChipContent: Sendable, Equatable {
    public let text: String
    public let accessibilityLabel: String
    /// False when the source cannot be followed (its segments are gone): shown, not pressable.
    public let isButton: Bool

    public static func make(_ ref: SourceRef, resolver: SourceResolver) -> SourceChipContent {
        switch ref {
        case let .transcript(startIdx, endIdx):
            guard let range = resolver.range(startIdx: startIdx, endIdx: endIdx) else {
                return SourceChipContent(text: "원본 없음", accessibilityLabel: "출처, 원본 없음", isButton: false)
            }
            return SourceChipContent(
                text: TimeText.timestamp(range.startMs),
                accessibilityLabel: "출처, \(TimeText.spoken(range.startMs))부터 듣기",
                isButton: true
            )
        case let .pdfPage(_, page):
            return SourceChipContent(text: "p.\(page)", accessibilityLabel: "출처, PDF \(page)쪽", isButton: true)
        }
    }

    /// Shown instead of chips when a block has no source at all.
    public static let missing = SourceChipContent(text: "출처 확인 필요", accessibilityLabel: "출처 확인 필요", isButton: false)
}
