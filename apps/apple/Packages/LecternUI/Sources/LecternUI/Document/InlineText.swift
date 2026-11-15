import SwiftUI

/// The old Markdown-only notes (no sections): inline Markdown, line breaks kept. Block text is
/// plain text and is not parsed (the domain defines it as plain; `2*3*4` must stay as written,
/// and a model-written link must not become a live one).
public func legacyMarkdown(_ markdown: String) -> AttributedString {
    let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    return (try? AttributedString(markdown: markdown, options: options)) ?? AttributedString(markdown)
}

/// Plain block text in the reading style.
struct ReadingText: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .lecternFont(.reading)
            .foregroundStyle(Theme.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }
}

/// An old note shown as it was written.
struct LegacyDocumentView: View {
    let markdown: String

    var body: some View {
        Text(legacyMarkdown(markdown))
            .lecternFont(.reading)
            .foregroundStyle(Theme.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }
}
