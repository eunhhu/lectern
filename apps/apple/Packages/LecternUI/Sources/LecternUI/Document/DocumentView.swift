import LecternKit
import SwiftUI

/// A structured document: section titles and their blocks, at most 720 pt wide and centered.
/// An old Markdown-only note (no sections) is shown as its Markdown.
///
/// `transcript` lets source chips show their time (`12:05`); without it they read "원본 없음".
public struct DocumentView: View {
    private let document: LecternKit.Document
    private let resolver: SourceResolver
    private let onSource: (SourceRef) -> Void

    public init(document: LecternKit.Document, transcript: Transcript? = nil, onSource: @escaping (SourceRef) -> Void) {
        self.document = document
        resolver = SourceResolver(transcript: transcript)
        self.onSource = onSource
    }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: LecternTokens.Space.s24) {
                if document.sections.isEmpty {
                    LegacyDocumentView(markdown: document.markdown)
                } else {
                    ForEach(Array(document.sections.enumerated()), id: \.offset) { _, section in
                        SectionView(section: section, resolver: resolver, onSource: onSource)
                    }
                }
            }
            .frame(maxWidth: Theme.readingWidth, alignment: .leading)
            .padding(.horizontal, LecternTokens.Space.s20)
            .padding(.vertical, LecternTokens.Space.s24)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.panel)
    }
}

private struct SectionView: View {
    let section: LecternKit.Document.Section
    let resolver: SourceResolver
    let onSource: (SourceRef) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: LecternTokens.Space.s16) {
            Text(verbatim: section.title)
                .lecternFont(.heading)
                .foregroundStyle(Theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array(renderableBlocks(section.blocks).enumerated()), id: \.offset) { _, block in
                BlockView(block: block, resolver: resolver, onSource: onSource)
            }
        }
    }
}
