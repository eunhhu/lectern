import { documentVersionId, LEGACY_TEMPLATE_ID } from "@lectern/db";
import { HEADER, parseVersionETag, versionETag, type DocumentBody } from "@lectern/domain";
import { db, getLectureById, updateLectureMarkdown } from "../../db.ts";
import { loadRecording } from "./access.ts";
import { apiError, defineRouter, notFound, ok, okPage, type Handler, type V2Request } from "./common.ts";
import {
  documentDto,
  documentVersionDto,
  documentVersionSummaryDto,
  parseJson,
  type DocumentRow,
  type DocumentVersionRow,
  type RecordingRow,
} from "./rows.ts";
import { markEditedBlocks, renderDocumentMarkdown } from "./render-md.ts";
import { announceLectures, transact } from "./store.ts";

/** A handler for `/documents/{document_id}/...`: 404 unless the caller can see its recording. */
function withDocument(
  handler: (req: V2Request, document: DocumentRow, recording: RecordingRow) => Response,
  action: "recording:read" | "recording:update" = "recording:read"
): Handler {
  return (req) => {
    const document = db.query(`SELECT * FROM document WHERE id = ?`).get(String(req.params.document_id)) as DocumentRow | null;
    if (!document) return notFound(req, "문서");
    const recording = loadRecording(req, document.recording_id, action);
    if (recording instanceof Response) return recording.status === 404 ? notFound(req, "문서") : recording;
    return handler(req, document, recording);
  };
}

const versionOf = (documentId: string, version: number) =>
  db.query(`SELECT * FROM document_version WHERE document_id = ? AND version = ?`).get(documentId, version) as DocumentVersionRow | null;

export const documentsRouter = defineRouter({
  getDocument: withDocument((req, document) => {
    const version = versionOf(document.id, document.current_version)!;
    return ok(
      req,
      { document: documentDto(document), version: documentVersionDto(version) },
      { headers: { [HEADER.etag]: versionETag(document.current_version) } }
    );
  }),

  listDocumentVersions: withDocument((req, document) => {
    const rows = db.query(`SELECT * FROM document_version WHERE document_id = ? ORDER BY version DESC`).all(document.id) as DocumentVersionRow[];
    return okPage(req, rows.map(documentVersionSummaryDto));
  }),

  getDocumentVersion: withDocument((req, document) => {
    const version = versionOf(document.id, Number(req.params.version));
    return version ? ok(req, documentVersionDto(version)) : notFound(req, "문서 버전");
  }),

  // A user edit (optimistic locking on the version, ARCHITECTURE §6). A `legacy-markdown`
  // document takes Markdown; it is also written to the lecture (v1 clients, the lecture
  // archive, the 물어보기 index). A structured document takes a body; the server marks the
  // blocks that changed and renders Markdown.
  createDocumentVersion: withDocument((req, document, recording) => {
    const expected = parseVersionETag(String(req.headers[HEADER.ifMatch]));
    if (expected === null) return apiError(req.c, 400, "bad_request", "If-Match 형식이 올바르지 않습니다.");
    const body = req.body as { body?: DocumentBody; markdown?: string };
    const legacy = document.template_id === LEGACY_TEMPLATE_ID;
    if (legacy && body.markdown === undefined) {
      return apiError(req.c, 400, "bad_request", "이 문서는 Markdown으로만 고칠 수 있습니다.");
    }
    if (!legacy && body.body === undefined) {
      return apiError(req.c, 400, "bad_request", "이 문서는 구조화된 본문(body)으로만 고칠 수 있습니다.");
    }
    const userId = req.user!.id;
    const lectureId = legacy ? recording.lecture_id : null;

    const result = transact((): { version: number } | { stale: number } => {
      const current = db.query(`SELECT current_version FROM document WHERE id = ?`).get(document.id) as { current_version: number };
      if (current.current_version !== expected) return { stale: current.current_version };
      const base = versionOf(document.id, current.current_version)!;
      const version = current.current_version + 1;
      const now = Date.now();
      let bodyJson: string | null = null;
      let markdown: string;
      if (legacy) {
        markdown = body.markdown!;
      } else {
        const marked = markEditedBlocks(body.body!, parseJson<DocumentBody | null>(base.body_json, null));
        bodyJson = JSON.stringify(marked);
        markdown = renderDocumentMarkdown(recording.title, marked);
      }
      db.query(
        `INSERT INTO document_version (id, workspace_id, document_id, recording_id, version, base_version, template_id,
           template_version, body_json, rendered_md, created_by, author_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?)`
      ).run(
        documentVersionId(document.id, version),
        document.workspace_id,
        document.id,
        document.recording_id,
        version,
        current.current_version,
        base.template_id,
        base.template_version,
        bodyJson,
        markdown,
        userId,
        now
      );
      db.query(`UPDATE document SET current_version = ?, user_edited = 1, updated_at = ? WHERE id = ?`).run(version, now, document.id);
      if (lectureId) {
        const lecture = getLectureById(lectureId);
        // The lecture's Markdown now equals the new version, so projecting it adds nothing.
        if (lecture) updateLectureMarkdown(lectureId, lecture.title, lecture.course, markdown, undefined, userId);
      }
      return { version };
    });

    if ("stale" in result) {
      return apiError(req.c, 412, "precondition_failed", "다른 곳에서 먼저 저장된 문서입니다. 새 버전을 불러온 뒤 다시 고치세요.", {
        current_version: result.stale,
      });
    }
    if (lectureId) announceLectures([lectureId]);
    return ok(req, documentVersionDto(versionOf(document.id, result.version)!), {
      status: 201,
      headers: { [HEADER.etag]: versionETag(result.version) },
    });
  }, "recording:update"),

  // The current version as a Markdown attachment (D-P2-4). `format` is `md` only (the
  // route's query schema answers 400 otherwise).
  exportDocument: withDocument((_req, document, recording) => {
    const version = versionOf(document.id, document.current_version)!;
    const name = `${recording.title}.md`.replace(/[^\w가-힣._ -]/g, "_");
    return new Response(`${version.rendered_md}\n`, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="note.md"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  }),
});
