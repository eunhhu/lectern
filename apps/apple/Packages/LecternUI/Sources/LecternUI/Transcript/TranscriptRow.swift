import LecternKit
import SwiftUI

/// One segment: speaker, time, text. The playing one has a background and a bar on the left.
/// Equatable without the tap action, so a position update redraws only the rows whose
/// highlight changed.
struct TranscriptRow: View, Equatable {
    let segment: Transcript.Segment
    let speakerName: String?
    let isActive: Bool
    let onSeek: (Int) -> Void

    nonisolated static func == (a: TranscriptRow, b: TranscriptRow) -> Bool {
        a.segment == b.segment && a.speakerName == b.speakerName && a.isActive == b.isActive
    }

    /// `<화자>, <분>분 <초>초, <글>`.
    nonisolated static func accessibilityLabel(speakerName: String?, segment: Transcript.Segment) -> String {
        [speakerName, TimeText.spoken(segment.startMs), segment.text].compactMap { $0 }.joined(separator: ", ")
    }

    var body: some View {
        Button { onSeek(segment.startMs) } label: {
            HStack(alignment: .top, spacing: LecternTokens.Space.s12) {
                Rectangle()
                    .fill(isActive ? Theme.focus : .clear)
                    .frame(width: Theme.activeBarWidth)
                VStack(alignment: .leading, spacing: LecternTokens.Space.s4) {
                    HStack(spacing: LecternTokens.Space.s8) {
                        if let speakerName {
                            Text(verbatim: speakerName)
                                .lecternFont(.label)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Text(verbatim: TimeText.timestamp(segment.startMs))
                            .lecternFont(.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textTertiary)
                    }
                    Text(verbatim: segment.text)
                        .lecternFont(.reading)
                        .foregroundStyle(Theme.textPrimary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, LecternTokens.Space.s8)
                Spacer(minLength: 0)
            }
            .frame(minHeight: Theme.minTapTarget)
            .background(isActive ? Theme.selected : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Self.accessibilityLabel(speakerName: speakerName, segment: segment))
        .accessibilityHint("두 번 탭하면 이 위치부터 재생합니다")
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("transcript.row")
    }
}
