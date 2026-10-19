import { db } from "../../db.ts";
import { requireWorkspace, VISIBLE_RECORDING_SQL } from "./access.ts";
import { defineRouter, okPage } from "./common.ts";
import { parseJson } from "./rows.ts";

// Basic search (ROADMAP P2): case-insensitive substring over the recordings the caller can
// see: titles, the current version of each document (blocks, or the paragraphs of a
// legacy-markdown document) and transcript segments. The hybrid index of 물어보기
// (search_chunk, ADR-0009) only exists while LECTERN_ASK is on; moving /search onto it is
// P3 ("전역 검색 UI").

interface Block {
  id: string;
  type: string;
  text?: string;
  term?: string;
  definition?: string;
  explanation?: string | null;
  items?: Array<{ text: string }>;
}

/** The searchable text of a document block. */
function blockTexts(block: Block): string[] {
  switch (block.type) {
    case "paragraph":
    case "quote":
    case "callout":
      return block.text ? [block.text] : [];
    case "list":
      return (block.items ?? []).map((item) => item.text);
    case "term":
      return [block.term ?? "", block.definition ?? ""];
    case "formula":
      return block.explanation ? [block.explanation] : [];
    default:
      return [];
  }
}

const RADIUS = 80;

/** Up to RADIUS characters around every match of the first window, as highlighted runs. */
function snippet(text: string, needle: string) {
  const lower = text.toLowerCase();
  const first = lower.indexOf(needle);
  const start = Math.max(0, first - RADIUS);
  const end = Math.min(text.length, first + needle.length + RADIUS);
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let at = start;
  for (let i = lower.indexOf(needle, start); i !== -1 && i + needle.length <= end; i = lower.indexOf(needle, at)) {
    if (i > at) parts.push({ text: text.slice(at, i), highlight: false });
    parts.push({ text: text.slice(i, i + needle.length), highlight: true });
    at = i + needle.length;
  }
  if (at < end) parts.push({ text: text.slice(at, end), highlight: false });
  if (start > 0) parts[0] = { ...parts[0]!, text: `…${parts[0]!.text}` };
  if (end < text.length) parts[parts.length - 1] = { ...parts[parts.length - 1]!, text: `${parts[parts.length - 1]!.text}…` };
  return parts;
}

/** Blank-line-separated paragraphs of Markdown (`md-<n>` block ids, domain DocumentSearchHit). */
export function markdownParagraphs(markdown: string): string[] {
  return markdown.split(/\n\s*\n/);
}

/** At most this many hits are collected per request (then paged). */
const MAX_HITS = 1_000;

export const searchRouter = defineRouter({
  search: (req) => {
    const q = req.query as { workspace_id: string; q: string; kind?: string; recording_id?: string };
    const caller = requireWorkspace(req, q.workspace_id);
    if (caller instanceof Response) return caller;
    const needle = q.q.toLowerCase();
    const wants = (kind: string) => q.kind === undefined || q.kind === kind;

    const recordings = db
      .query(
        `SELECT r.id, r.title FROM recording r WHERE r.workspace_id = ? AND ${VISIBLE_RECORDING_SQL}
         ${q.recording_id ? "AND r.id = ?" : ""} ORDER BY r.recorded_at DESC, r.id DESC`
      )
      .all(...(q.recording_id ? [q.workspace_id, req.user!.id, q.recording_id] : [q.workspace_id, req.user!.id])) as Array<{
      id: string;
      title: string;
    }>;

    const docVersions = db.query(
      `SELECT d.id, v.body_json, v.rendered_md FROM document d
       JOIN document_version v ON v.document_id = d.id AND v.version = d.current_version
       WHERE d.recording_id = ? AND instr(lower(v.rendered_md), ?) > 0 ORDER BY d.created_at, d.id`
    );
    const segments = db.query(
      `SELECT idx, start_ms, text FROM transcript_segment WHERE recording_id = ? AND instr(lower(text), ?) > 0 ORDER BY idx`
    );

    const hits: unknown[] = [];
    for (const recording of recordings) {
      if (hits.length >= MAX_HITS) break;
      const base = { recording_id: recording.id, recording_title: recording.title };
      if (wants("recording") && recording.title.toLowerCase().includes(needle)) {
        hits.push({ kind: "recording", ...base, snippet: snippet(recording.title, needle) });
      }
      if (wants("document")) {
        for (const doc of docVersions.all(recording.id, needle) as Array<{ id: string; body_json: string | null; rendered_md: string }>) {
          const body = parseJson<{ sections?: Array<{ blocks?: Block[] }> } | null>(doc.body_json, null);
          if (body) {
            for (const block of body.sections?.flatMap((s) => s.blocks ?? []) ?? []) {
              const text = blockTexts(block).find((t) => t.toLowerCase().includes(needle));
              if (text) hits.push({ kind: "document", ...base, snippet: snippet(text, needle), document_id: doc.id, block_id: block.id });
            }
          } else {
            markdownParagraphs(doc.rendered_md).forEach((paragraph, n) => {
              if (paragraph.toLowerCase().includes(needle)) {
                hits.push({ kind: "document", ...base, snippet: snippet(paragraph, needle), document_id: doc.id, block_id: `md-${n}` });
              }
            });
          }
        }
      }
      if (wants("transcript")) {
        for (const seg of segments.all(recording.id, needle) as Array<{ idx: number; start_ms: number; text: string }>) {
          hits.push({ kind: "transcript", ...base, snippet: snippet(seg.text, needle), segment_idx: seg.idx, start_ms: seg.start_ms });
        }
      }
    }
    return okPage(req, hits.slice(0, MAX_HITS));
  },
});
