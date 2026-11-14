import LecternKit
import SwiftUI

/// One block, drawn the way the web's DocumentPane draws it. Unknown blocks draw nothing.
public struct BlockView: View {
    private let block: DocumentBlock
    private let resolver: SourceResolver
    private let onSource: (SourceRef) -> Void

    public init(block: DocumentBlock, resolver: SourceResolver, onSource: @escaping (SourceRef) -> Void) {
        self.block = block
        self.resolver = resolver
        self.onSource = onSource
    }

    public var body: some View {
        switch block {
        case let .paragraph(_, heading, text, sources):
            titled(heading) {
                ReadingText(text: text)
                chips(sources)
            }
        case let .list(_, heading, numbered, items, _):
            titled(heading) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: LecternTokens.Space.s8) {
                        Text(verbatim: numbered ? "\(index + 1)." : "•")
                            .lecternFont(.reading)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textSecondary)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: LecternTokens.Space.s4) {
                            ReadingText(text: item.text)
                            chips(item.sources)
                        }
                    }
                }
            }
        case let .quote(_, heading, text, speaker, sources):
            titled(heading) {
                HStack(alignment: .top, spacing: LecternTokens.Space.s12) {
                    Rectangle()
                        .fill(Theme.border)
                        .frame(width: Theme.activeBarWidth)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: LecternTokens.Space.s4) {
                        ReadingText(text: text)
                            .accessibilityLabel("인용, \(text)")
                        if let who = quoteSpeaker(sources: sources, speaker: speaker) {
                            Text(verbatim: who)
                                .lecternFont(.caption)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        chips(sources)
                    }
                }
            }
        case let .term(_, heading, term, definition, sources):
            titled(heading) {
                VStack(alignment: .leading, spacing: LecternTokens.Space.s4) {
                    Text(verbatim: term)
                        .lecternFont(.title)
                        .foregroundStyle(Theme.textPrimary)
                    ReadingText(text: definition)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("용어 \(term), \(definition)")
                chips(sources)
            }
        case let .formula(_, heading, expression, explanation, sources):
            titled(heading) {
                Text(verbatim: expression)
                    .lecternFont(.mono)
                    .foregroundStyle(Theme.textPrimary)
                    .textSelection(.enabled)
                    .padding(LecternTokens.Space.s12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.active, in: RoundedRectangle(cornerRadius: LecternTokens.Radius.sm))
                    .accessibilityLabel("수식, \(expression)")
                if let explanation {
                    Text(verbatim: explanation)
                        .lecternFont(.body)
                        .foregroundStyle(Theme.textSecondary)
                }
                chips(sources)
            }
        case let .callout(_, heading, tone, text, sources):
            let color = Theme.tone(CalloutStyle.toneName(for: tone))
            let label = CalloutStyle.label(for: tone)
            titled(heading) {
                VStack(alignment: .leading, spacing: LecternTokens.Space.s6) {
                    HStack(alignment: .firstTextBaseline, spacing: LecternTokens.Space.s8) {
                        Text(verbatim: label)
                            .lecternFont(.label)
                            .foregroundStyle(color.text)
                        ReadingText(text: text)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(label), \(text)")
                    chips(sources)
                }
                .padding(LecternTokens.Space.s12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(color.background, in: RoundedRectangle(cornerRadius: LecternTokens.Radius.md))
                .overlay(RoundedRectangle(cornerRadius: LecternTokens.Radius.md).strokeBorder(color.border))
            }
        case let .gap(_, _, kind, startMs, endMs):
            Text(verbatim: GapText.text(kind: kind, startMs: startMs, endMs: endMs))
                .lecternFont(.body)
                .foregroundStyle(Theme.textTertiary)
        case .unknown:
            EmptyView()
        }
    }

    @ViewBuilder
    private func titled(_ heading: String?, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: LecternTokens.Space.s6) {
            if let heading, !heading.isEmpty {
                Text(verbatim: heading)
                    .lecternFont(.title)
                    .foregroundStyle(Theme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
            }
            content()
        }
    }

    private func chips(_ sources: [SourceRef]) -> some View {
        SourceChips(sources: sources, resolver: resolver, onSource: onSource)
    }

    /// The quoted speaker: from the first transcript source when it resolves, else the block's.
    private func quoteSpeaker(sources: [SourceRef], speaker: String?) -> String? {
        for case let .transcript(startIdx, endIdx) in sources {
            if let range = resolver.range(startIdx: startIdx, endIdx: endIdx), let name = resolver.speakerName(of: range) {
                return name
            }
            break
        }
        return speaker.map { "화자 \($0.hasPrefix("S") ? String($0.dropFirst()) : $0)" }
    }
}
