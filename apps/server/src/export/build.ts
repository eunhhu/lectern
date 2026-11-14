// What goes into a workspace export zip (P5-08, D-P5-8): the recordings the user can see
// (VISIBLE_RECORDING_SQL), each with its document, transcript, events and action items in the
// API's own JSON shapes, and the original audio and PDFs when asked. Read lazily, one entry
// at a time, so a large workspace never sits in memory.

import { extname } from "node:path";
import { VISIBLE_RECORDING_SQL } from "../api/v2/access.ts";
import {
  actionItemDto,
  assetDto,
  documentDto,
  documentVersionDto,
  eventCandidateDto,
  gapDto,
  recordingDto,
  recordingTagDto,
  segmentDto,
  speakerDto,
  type ActionItemRow,
  type AssetRow,
  type DocumentVersionRow,
  type EventCandidateRow,
  type GapRow,
  type RecordingRow,
  type SegmentRow,
} from "../api/v2/rows.ts";
import { assetPath, documentsOf, getFolderRow, speakersOf, tagRowsOf } from "../api/v2/store.ts";
import { db } from "../db.ts";
import { AUDIO_EXT_BY_MIME } from "../media-files.ts";
import type { ZipEntry } from "./zip.ts";

const UNSAFE = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_NAME = 80;

/** A file or folder name from a title: no path separators or reserved characters, ≤ 80 chars. */
export function safeName(title: string): string {
  const cleaned = title.normalize("NFC").replace(UNSAFE, "_").trim();
  const short = Array.from(cleaned).slice(0, MAX_NAME).join("").trim();
  // "." and ".." are not names (and a zip entry may not be one).
  return short && !/^\.+$/.test(short) ? short : "제목 없음";
}

const encoder = new TextEncoder();

function bytesEntry(name: string, content: string): ZipEntry {
  const bytes = encoder.encode(content);
  return { name, size: bytes.length, open: () => bytes };
}

const jsonEntry = (name: string, value: unknown) => bytesEntry(name, `${JSON.stringify(value, null, 2)}\n`);

function fileEntry(name: string, path: string): ZipEntry {
  const file = Bun.file(path);
  return { name, size: file.size, open: () => file.stream() };
}

function readme(workspaceName: string): string {
  return (
    `Lectern 데이터 내보내기\n\n` +
    `이 파일에는 워크스페이스 "${workspaceName}"의 녹음과 노트가 들어 있습니다.\n` +
    `recordings/ 아래 폴더 하나가 녹음 하나입니다.\n` +
    `document.md는 사람이 읽는 노트, *.json은 프로그램이 읽는 원본 데이터입니다.\n`
  );
}

function audioExtension(path: string, mime: string): string {
  const ext = extname(path).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  const fromMime = AUDIO_EXT_BY_MIME[mime.split(";")[0]!.trim().toLowerCase()];
  return fromMime ? (fromMime.startsWith(".") ? fromMime : `.${fromMime}`) : ".bin";
}

/** The recordings the user can see in the workspace, oldest first. */
export function visibleRecordings(userId: string, workspaceId: string): RecordingRow[] {
  return db
    .query(`SELECT r.* FROM recording r WHERE r.workspace_id = ? AND ${VISIBLE_RECORDING_SQL} ORDER BY r.created_at, r.id`)
    .all(workspaceId, userId) as RecordingRow[];
}

function* recordingEntries(r: RecordingRow, dir: string, includeAudio: boolean): Iterable<ZipEntry> {
  const assets = db.query(`SELECT * FROM asset WHERE recording_id = ? ORDER BY kind, part_index, id`).all(r.id) as AssetRow[];
  const documents = documentsOf(r.id);
  yield jsonEntry(`${dir}/recording.json`, {
    ...recordingDto(r),
    folder: r.folder_id ? (getFolderRow(r.folder_id)?.name ?? null) : null,
    tags: tagRowsOf(r.id).map(recordingTagDto),
    assets: assets.map(assetDto),
    documents: documents.map(documentDto),
  });

  // The current version of each document; a recording has one, rarely more.
  for (const [i, d] of documents.entries()) {
    const version = db
      .query(`SELECT * FROM document_version WHERE document_id = ? AND version = ?`)
      .get(d.id, d.current_version) as DocumentVersionRow | null;
    if (!version) continue;
    const base = i === 0 ? "document" : `document-${i + 1}`;
    yield bytesEntry(`${dir}/${base}.md`, version.rendered_md);
    yield jsonEntry(`${dir}/${base}.json`, documentVersionDto(version));
  }

  const segments = db.query(`SELECT * FROM transcript_segment WHERE recording_id = ? ORDER BY idx`).all(r.id) as SegmentRow[];
  if (segments.length) {
    const gaps = db.query(`SELECT kind, start_ms, end_ms FROM transcript_gap WHERE recording_id = ? ORDER BY start_ms`).all(r.id) as GapRow[];
    yield jsonEntry(`${dir}/transcript.json`, {
      recording_id: r.id,
      segments: segments.map(segmentDto),
      speakers: speakersOf(r.id).map(speakerDto),
      gaps: gaps.map(gapDto),
    });
  }
  const events = db.query(`SELECT * FROM event_candidate WHERE recording_id = ? ORDER BY start_at, id`).all(r.id) as EventCandidateRow[];
  yield jsonEntry(`${dir}/events.json`, events.map(eventCandidateDto));
  const items = db.query(`SELECT * FROM action_item WHERE recording_id = ? ORDER BY created_at, id`).all(r.id) as ActionItemRow[];
  yield jsonEntry(`${dir}/action-items.json`, items.map(actionItemDto));

  if (!includeAudio) return;
  const pdfNames = new Set<string>();
  for (const asset of assets) {
    // A file that is gone (deleted audio, retention) is left out rather than failing the export.
    const path = assetPath(asset);
    if (!path) continue;
    if (asset.kind.startsWith("audio")) {
      yield fileEntry(`${dir}/audio/${asset.part_index}${audioExtension(path, asset.mime)}`, path);
    } else if (asset.kind === "pdf") {
      const meta = JSON.parse(asset.meta_json || "{}") as { filename?: unknown };
      let name = safeName(typeof meta.filename === "string" ? meta.filename : `${asset.part_index}.pdf`);
      if (pdfNames.has(name)) name = `${asset.part_index}-${name}`;
      pdfNames.add(name);
      yield fileEntry(`${dir}/pdf/${name}`, path);
    }
  }
}

export function* exportEntries(p: { userId: string; workspaceId: string; includeAudio: boolean; now?: number }): Iterable<ZipEntry> {
  const workspace = db.query(`SELECT id, name FROM workspace WHERE id = ?`).get(p.workspaceId) as { id: string; name: string } | null;
  if (!workspace) throw new Error("workspace not found");
  const recordings = visibleRecordings(p.userId, p.workspaceId);
  yield bytesEntry("README.txt", readme(workspace.name));
  yield jsonEntry("export.json", {
    format: 1,
    exported_at: new Date(p.now ?? Date.now()).toISOString(),
    workspace: { id: workspace.id, name: workspace.name },
    recordings: recordings.length,
    include_audio: p.includeAudio,
  });
  yield jsonEntry("recordings.json", recordings.map(recordingDto));
  let n = 0;
  for (const r of recordings) {
    n += 1;
    yield* recordingEntries(r, `recordings/${String(n).padStart(4, "0")}-${safeName(r.title)}`, p.includeAudio);
  }
}
