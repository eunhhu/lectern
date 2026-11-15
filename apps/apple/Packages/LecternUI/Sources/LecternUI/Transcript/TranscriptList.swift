import LecternKit
import SwiftUI

/// The transcript, following playback: the playing segment is highlighted and scrolled into
/// view. After the user scrolls, following stops until five seconds after the scroll rests.
/// With "Reduce Motion" the list jumps instead of animating.
public struct TranscriptList: View {
    private let transcript: Transcript
    private let positionMs: Int
    private let onSeek: (Int) -> Void
    private let startsMs: [Int]
    private let speakerNames: [String: String]

    @State private var userScrolling = false
    @State private var userScrollEndedAt: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(transcript: Transcript, positionMs: Int, onSeek: @escaping (Int) -> Void) {
        self.transcript = transcript
        self.positionMs = positionMs
        self.onSeek = onSeek
        startsMs = transcript.segments.map(\.startMs)
        speakerNames = Dictionary(transcript.speakers.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    }

    private var active: Int? {
        activeSegmentIndex(startsMs: startsMs, positionMs: positionMs)
    }

    public var body: some View {
        let active = active
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(transcript.segments.indices, id: \.self) { index in
                        let segment = transcript.segments[index]
                        TranscriptRow(
                            segment: segment,
                            speakerName: segment.speakerID.flatMap { speakerNames[$0] },
                            isActive: index == active,
                            onSeek: onSeek
                        )
                        .equatable()
                        .id(segment.idx)
                    }
                }
            }
            .onScrollPhaseChange { _, phase in
                switch phase {
                case .interacting:
                    userScrolling = true
                case .idle where userScrolling:
                    userScrolling = false
                    userScrollEndedAt = Date()
                default:
                    break
                }
            }
            .onAppear {
                // Opened in the middle of playback: start at the playing segment.
                if let active { proxy.scrollTo(transcript.segments[active].idx, anchor: .center) }
            }
            .onChange(of: active) { _, index in
                guard let index,
                      AutoScrollPolicy.shouldFollow(now: Date(), userScrolling: userScrolling, userScrollEndedAt: userScrollEndedAt)
                else { return }
                let id = transcript.segments[index].idx
                if reduceMotion {
                    proxy.scrollTo(id, anchor: .center)
                } else {
                    withAnimation(LecternTokens.Motion.easingStandard.animation(duration: LecternTokens.Motion.durationSlow)) {
                        proxy.scrollTo(id, anchor: .center)
                    }
                }
            }
        }
        .background(Theme.panel)
    }
}
