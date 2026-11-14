import Foundation

/// Where a block's content came from: a range of transcript segments or a PDF page.
public enum SourceRef: Sendable, Equatable {
    /// Segments `startIdx...endIdx` (inclusive) of the transcript.
    case transcript(startIdx: Int, endIdx: Int)
    /// A 1-based page of a PDF asset.
    case pdfPage(assetID: String, page: Int)

    init(_ s: Components.Schemas.SourceRef) {
        switch s {
        case let .transcript(t): self = .transcript(startIdx: t.start_idx, endIdx: t.end_idx)
        case let .pdf_page(p): self = .pdfPage(assetID: p.asset_id, page: p.page)
        }
    }
}

public struct ListItem: Sendable, Equatable {
    public let text: String
    public let sources: [SourceRef]

    public init(text: String, sources: [SourceRef]) {
        self.text = text
        self.sources = sources
    }
}

/// One block of a document. The set of types is open: a type this app does not know decodes as
/// `.unknown` and is shown as nothing (domain freeze rule).
public enum DocumentBlock: Sendable, Equatable {
    case paragraph(id: String, heading: String?, text: String, sources: [SourceRef])
    case list(id: String, heading: String?, numbered: Bool, items: [ListItem], sources: [SourceRef])
    case quote(id: String, heading: String?, text: String, speaker: String?, sources: [SourceRef])
    case term(id: String, heading: String?, term: String, definition: String, sources: [SourceRef])
    case formula(id: String, heading: String?, expression: String, explanation: String?, sources: [SourceRef])
    /// `tone`: `exam`, `assignment`, `important`, `note` (domain `CalloutTone`; open).
    case callout(id: String, heading: String?, tone: String, text: String, sources: [SourceRef])
    /// A stretch the transcript does not cover. `kind`: `break`, `tail`, `missing_transcript` (open).
    case gap(id: String, heading: String?, kind: String, startMs: Int, endMs: Int)
    case unknown(type: String)

    /// The block's id (empty for `.unknown`).
    public var id: String {
        switch self {
        case let .paragraph(id, _, _, _), let .list(id, _, _, _, _), let .quote(id, _, _, _, _),
             let .term(id, _, _, _, _), let .formula(id, _, _, _, _), let .callout(id, _, _, _, _), let .gap(id, _, _, _, _):
            id
        case .unknown:
            ""
        }
    }

    init(_ b: Components.Schemas.DocumentBlock) {
        let refs = { (sources: [Components.Schemas.SourceRef]) in sources.map(SourceRef.init) }
        switch b {
        case let .paragraph(p):
            if p.id.hasPrefix(OpenUnion.unknownBlockPrefix) {
                self = .unknown(type: String(p.id.dropFirst(OpenUnion.unknownBlockPrefix.count)))
            } else {
                self = .paragraph(id: p.id, heading: p.heading, text: p.text, sources: refs(p.sources))
            }
        case let .list(l):
            self = .list(
                id: l.id, heading: l.heading, numbered: l.style == "numbered",
                items: l.items.map { ListItem(text: $0.text, sources: refs($0.sources)) }, sources: refs(l.sources)
            )
        case let .quote(q):
            self = .quote(id: q.id, heading: q.heading, text: q.text, speaker: q.speaker, sources: refs(q.sources))
        case let .term(t):
            self = .term(id: t.id, heading: t.heading, term: t.term, definition: t.definition, sources: refs(t.sources))
        case let .formula(f):
            self = .formula(id: f.id, heading: f.heading, expression: f.expression, explanation: f.explanation, sources: refs(f.sources))
        case let .callout(c):
            self = .callout(id: c.id, heading: c.heading, tone: c.tone, text: c.text, sources: refs(c.sources))
        case let .gap(g):
            self = .gap(id: g.id, heading: g.heading, kind: g.kind, startMs: g.start_ms, endMs: g.end_ms)
        }
    }
}
