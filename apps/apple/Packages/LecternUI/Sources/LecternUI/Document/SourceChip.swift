import LecternKit
import SwiftUI

/// One source: `12:05` (a transcript time) or `p.3` (a PDF page). Pressing it calls `onSource`.
/// The tappable area is at least 44 pt even though the chip looks small.
public struct SourceChip: View {
    private let ref: SourceRef?
    private let content: SourceChipContent
    private let onSource: (SourceRef) -> Void

    public init(_ ref: SourceRef, resolver: SourceResolver, onSource: @escaping (SourceRef) -> Void) {
        self.ref = ref
        content = SourceChipContent.make(ref, resolver: resolver)
        self.onSource = onSource
    }

    /// The "출처 확인 필요" mark for a block without sources.
    init(missing: Void = ()) {
        ref = nil
        content = .missing
        onSource = { _ in }
    }

    public var body: some View {
        if content.isButton, let ref {
            Button { onSource(ref) } label: {
                // Inside the label: the tappable area is the label's, not the frame around the button.
                chip(Theme.accentText)
                    .frame(minWidth: Theme.minTapTarget, minHeight: Theme.minTapTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(content.accessibilityLabel)
        } else {
            chip(ref == nil ? Theme.tone(.attention).text : Theme.textTertiary)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(content.accessibilityLabel)
        }
    }

    private func chip(_ color: Color) -> some View {
        Text(verbatim: content.text)
            .lecternFont(.caption)
            .monospacedDigit()
            .foregroundStyle(color)
            .padding(.horizontal, LecternTokens.Space.s6)
            .padding(.vertical, LecternTokens.Space.s2)
            .background(Theme.active, in: RoundedRectangle(cornerRadius: LecternTokens.Radius.xs))
    }
}

/// A block's chips, wrapping to the next line when they do not fit (large text sizes).
struct SourceChips: View {
    let sources: [SourceRef]
    let resolver: SourceResolver
    let onSource: (SourceRef) -> Void

    var body: some View {
        FlowLayout(spacing: LecternTokens.Space.s4) {
            if sources.isEmpty {
                SourceChip(missing: ())
            } else {
                ForEach(Array(sources.enumerated()), id: \.offset) { _, ref in
                    SourceChip(ref, resolver: resolver, onSource: onSource)
                }
            }
        }
    }
}

/// Lays children left to right and wraps them, like words.
struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            if needed > width, !row.indices.isEmpty {
                rows.append(row)
                row = Row()
            }
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}
