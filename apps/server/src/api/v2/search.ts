import { type ChunkKind, type ChunkRow, costOf, isScopeError, resolveAccessScope, searchIndex } from "@lectern/ask";
import type { AskScope } from "@lectern/domain";
import { folderRows, recordingRows } from "../../ask/legacy.ts";
import type { AskService } from "../../ask/service.ts";
import { db } from "../../db.ts";
import { requireWorkspace, VISIBLE_RECORDING_SQL } from "./access.ts";
import { apiError, defineRouter, okPage, type V2Request } from "./common.ts";
import { parseJson } from "./rows.ts";

// GET /search (CONTRACTS D-P3-5). With the 물어보기 index (LECTERN_ASK on) it is the hybrid
// search of packages/ask (BM25 + vectors) over the recordings the caller may read:
// transcript windows, document blocks and lecture PDF pages, plus title matches first.
// With LECTERN_ASK off there is no index, and it stays the P2 search: a case-insensitive
// substring over titles, the current documents and the transcript segments.

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

/** The P2 search (LECTERN_ASK off), unchanged. */
function substringSearch(req: V2Request): Response {
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
}

/** At most this many hits come from the index. */
const MAX_INDEX_HITS = 50;

/**
 * `md-<n>` of a legacy-markdown chunk: the first paragraph of the document's current
 * `rendered_md` that holds the chunk's first line, or 0.
 */
function markdownBlockId(chunk: ChunkRow): string {
  const row = db
    .query(
      `SELECT v.rendered_md FROM document d JOIN document_version v ON v.document_id = d.id AND v.version = d.current_version WHERE d.id = ?`
    )
    .get(chunk.documentId ?? "") as { rendered_md: string } | null;
  const firstLine = chunk.text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  const n = row && firstLine ? markdownParagraphs(row.rendered_md).findIndex((p) => p.includes(firstLine)) : -1;
  return `md-${Math.max(0, n)}`;
}

function hitOf(chunk: ChunkRow, base: { recording_id: string; recording_title: string; snippet: unknown }): { key: string; hit: unknown } {
  switch (chunk.kind) {
    case "transcript":
      return { key: `${chunk.startIdx}`, hit: { kind: "transcript", ...base, segment_idx: chunk.startIdx, start_ms: chunk.startMs } };
    case "pdf_page":
      return { key: `${chunk.assetId}:${chunk.page}`, hit: { kind: "pdf_page", ...base, asset_id: chunk.assetId, page: chunk.page } };
    default: {
      const blockId = chunk.blockId ?? markdownBlockId(chunk);
      return { key: `${chunk.documentId}:${blockId}`, hit: { kind: "document", ...base, document_id: chunk.documentId, block_id: blockId } };
    }
  }
}

async function indexSearch(req: V2Request, service: AskService): Promise<Response> {
  const q = req.query as { workspace_id: string; q: string; kind?: string; recording_id?: string };
  const caller = requireWorkspace(req, q.workspace_id);
  if (caller instanceof Response) return caller;
  const scope = (q.recording_id ? { kind: "recording", recording_id: q.recording_id } : { kind: "workspace" }) as AskScope;
  const access = resolveAccessScope({
    workspaceId: q.workspace_id,
    caller: { userId: req.user!.id, role: caller.role },
    scope,
    recordings: recordingRows(q.workspace_id),
    folders: folderRows(q.workspace_id),
    roles: ["owner", "admin", "member", "viewer"],
  });
  if (isScopeError(access)) return apiError(req.c, access.code === "forbidden" ? 403 : 404, access.code, access.message);

  const hits: unknown[] = [];
  // Titles are not in the index: a substring match on the recordings in scope comes first.
  if (q.kind === undefined || q.kind === "recording") {
    const needle = q.q.toLowerCase();
    for (const [id, rec] of access.recordings) {
      if (rec.title.toLowerCase().includes(needle)) {
        hits.push({ kind: "recording", recording_id: id, recording_title: rec.title, snippet: snippet(rec.title, needle) });
      }
    }
  }
  if (q.kind !== "recording") {
    const deps = service.deps;
    const { hits: found, embeddingTokens } = await searchIndex(
      { db, embedder: deps.embedder, vectorIndex: deps.vectorIndex, queryCache: deps.queryCache },
      access,
      q.q,
      { kinds: q.kind ? [q.kind as ChunkKind] : undefined, limit: MAX_INDEX_HITS }
    );
    if (embeddingTokens > 0 && deps.embedder) {
      const usage = { inputTokens: embeddingTokens, cachedTokens: 0, outputTokens: 0 };
      const price = deps.price(deps.embedder.provider, deps.embedder.model);
      deps.onModelCall?.({
        purpose: "ask_embed",
        workspaceId: access.workspaceId,
        provider: deps.embedder.provider,
        model: deps.embedder.model,
        usage,
        latencyMs: 0,
        status: "ok",
        requestId: null,
        costMicrousd: price ? costOf(usage, price) : 0,
      });
    }
    const seen = new Set<string>();
    for (const { chunk, snippet: runs } of found) {
      const title = access.recordings.get(chunk.recordingId)?.title ?? "";
      const { key, hit } = hitOf(chunk, { recording_id: chunk.recordingId, recording_title: title, snippet: runs });
      const unique = `${chunk.recordingId}|${chunk.kind}|${key}`;
      if (seen.has(unique)) continue;
      seen.add(unique);
      hits.push(hit);
    }
  }
  return okPage(req, hits.slice(0, MAX_INDEX_HITS));
}

/** The search route: the hybrid index while the ask service exists, else the P2 substring search. */
export function createSearchRouter(getService: () => AskService | null) {
  return defineRouter({
    search: (req) => {
      const service = getService();
      return service ? indexSearch(req, service) : substringSearch(req);
    },
  });
}
