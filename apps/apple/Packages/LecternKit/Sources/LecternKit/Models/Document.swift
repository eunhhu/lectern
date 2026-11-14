import Foundation

/// A document at its current version: sections of blocks, and the same content as Markdown.
public struct Document: Sendable, Equatable, Identifiable {
    public struct Section: Sendable, Equatable {
        /// The template's key, e.g. `summary`.
        public let key: String
        public let title: String
        public let blocks: [DocumentBlock]

        public init(key: String, title: String, blocks: [DocumentBlock]) {
            self.key = key
            self.title = title
            self.blocks = blocks
        }
    }

    public let id: String
    public let recordingID: String
    public let templateID: String
    /// Send it back in `If-Match` when editing.
    public let version: Int
    /// Empty for the old Markdown-only notes; use `markdown` then.
    public let sections: [Section]
    public let markdown: String
    public let updatedAt: Date

    public init(id: String, recordingID: String, templateID: String, version: Int, sections: [Section], markdown: String, updatedAt: Date) {
        self.id = id
        self.recordingID = recordingID
        self.templateID = templateID
        self.version = version
        self.sections = sections
        self.markdown = markdown
        self.updatedAt = updatedAt
    }

    init(_ d: Components.Schemas.DocumentWithVersion) {
        id = d.document.id
        recordingID = d.document.recording_id
        templateID = d.version.template_id
        version = d.version.version
        sections = (d.version.body?.sections ?? []).map {
            Section(key: $0.key, title: $0.title, blocks: $0.blocks.map(DocumentBlock.init))
        }
        markdown = d.version.rendered_md
        updatedAt = d.document.updated_at
    }
}
