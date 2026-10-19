import { denyUnlessMember } from "./access.ts";
import { defineRouter, okPage } from "./common.ts";
import * as F from "./fixtures.ts";

type Block = NonNullable<(typeof F.documentVersions)[number]["body"]>["sections"][number]["blocks"][number];

/** The searchable text of a document block. */
function blockTexts(block: Block): string[] {
  switch (block.type) {
    case "paragraph":
    case "quote":
    case "callout":
      return [block.text];
    case "list":
      return block.items.map((item) => item.text);
    case "term":
      return [block.term, block.definition];
    case "formula":
      return block.explanation ? [block.explanation] : [];
    default:
      return [];
  }
}

/** `text` cut into highlighted and plain runs around every case-insensitive match. */
function snippet(text: string, needle: string) {
  const lower = text.toLowerCase();
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, at)) {
    if (i > at) parts.push({ text: text.slice(at, i), highlight: false });
    parts.push({ text: text.slice(i, i + needle.length), highlight: true });
    at = i + needle.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), highlight: false });
  return parts;
}

// Substring search over the fixtures, standing in for the FTS5 index (ARCHITECTURE §12).
export const searchRouter = defineRouter({
  search: (req) => {
    const q = req.query as { workspace_id: string; q: string; kind?: string; recording_id?: string };
    const denied = denyUnlessMember(req, q.workspace_id);
    if (denied) return denied;
    const needle = q.q.toLowerCase();
    const wants = (kind: string) => q.kind === undefined || q.kind === kind;
    const hits: unknown[] = [];

    const scoped = F.recordings.filter(
      (r) => r.workspace_id === q.workspace_id && (q.recording_id === undefined || r.id === q.recording_id)
    );
    for (const recording of scoped) {
      const base = { recording_id: recording.id, recording_title: recording.title };
      if (wants("transcript")) {
        const transcript = F.transcripts.find((t) => t.recording_id === recording.id);
        for (const segment of transcript?.segments ?? []) {
          if (!segment.text.toLowerCase().includes(needle)) continue;
          hits.push({ kind: "transcript", ...base, snippet: snippet(segment.text, needle), segment_idx: segment.idx, start_ms: segment.start_ms });
        }
      }
      if (wants("document")) {
        for (const document of F.documents.filter((d) => d.recording_id === recording.id)) {
          const version = F.documentVersions.find((v) => v.document_id === document.id && v.version === document.current_version);
          for (const block of version?.body?.sections.flatMap((s) => s.blocks) ?? []) {
            const text = blockTexts(block).find((t) => t.toLowerCase().includes(needle));
            if (text) hits.push({ kind: "document", ...base, snippet: snippet(text, needle), document_id: document.id, block_id: block.id });
          }
        }
      }
      if (wants("pdf_page")) {
        for (const page of F.pdfPages.filter((p) => p.recording_id === recording.id)) {
          if (!page.text.toLowerCase().includes(needle)) continue;
          hits.push({ kind: "pdf_page", ...base, snippet: snippet(page.text, needle), asset_id: page.asset_id, page: page.page });
        }
      }
    }
    return okPage(req, hits);
  },
});
