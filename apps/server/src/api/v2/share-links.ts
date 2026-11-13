import { randomBytes } from "node:crypto";
import { config } from "@lectern/config";
import { lectureShareLinkId, sha256Hex, uuidv7 } from "@lectern/db";
import { isAdminUser } from "../../auth.ts";
import { db, hashPassword, setLectureVisibility, type UserRecord } from "../../db.ts";
import { loadRecording, requireWorkspace, VISIBLE_RECORDING_SQL } from "./access.ts";
import { apiError, defineRouter, notFound, ok, okPage, type V2Request } from "./common.ts";
import { shareLinkDto, type RecordingRow, type ShareLinkRow } from "./rows.ts";
import { announceLectures } from "./store.ts";

// Share links (D-P2-3). Migrated v1 share tokens are rows here too (packages/db legacy.ts);
// a private lecture's token is a revoked link, which is not listed. The token is shown once
// in the create response and stored only as its SHA-256 (D-0-7). The public page that opens
// a link is share-page.ts.

const SHARE_RESTRICTED_MESSAGE = "외부 공유 링크 공개 권한이 제한된 계정입니다.";

/** The v1 rule (index.ts canSharePublicly): operators, or accounts allowed to share that are not viewers. */
function canShare(user: UserRecord): boolean {
  if (isAdminUser(user)) return true;
  return user.can_share !== 0 && user.role !== "viewer";
}

/** The recording a link target belongs to, if the caller may change it; a hidden one is 404. */
function targetRecording(req: V2Request, targetType: "recording" | "document", targetId: string, what: string): RecordingRow | Response {
  let recordingId = targetId;
  if (targetType === "document") {
    const doc = db.query(`SELECT recording_id FROM document WHERE id = ?`).get(targetId) as { recording_id: string } | null;
    if (!doc) return notFound(req, what);
    recordingId = doc.recording_id;
  }
  const recording = loadRecording(req, recordingId, "recording:update");
  if (recording instanceof Response) return recording.status === 404 ? notFound(req, what) : recording;
  return recording;
}

/** A link the caller may change. Revoked links are 404 unless `allowRevoked`. */
function linkFor(req: V2Request, options: { allowRevoked?: boolean } = {}): { link: ShareLinkRow; recording: RecordingRow } | Response {
  const link = db.query(`SELECT * FROM share_link WHERE id = ?`).get(String(req.params.share_link_id)) as ShareLinkRow | null;
  if (!link || (link.revoked_at !== null && !options.allowRevoked)) return notFound(req, "공유 링크");
  const recording = targetRecording(req, link.target_type, link.target_id, "공유 링크");
  return recording instanceof Response ? recording : { link, recording };
}

/** An ISO timestamp in the future, as milliseconds; a 400 otherwise. */
function futureMs(req: V2Request, iso: string): number | Response {
  const ms = Date.parse(iso);
  if (!(ms > Date.now())) return apiError(req.c, 400, "bad_request", "만료 시각은 지금보다 뒤여야 합니다.");
  return ms;
}

const shareUrl = (token: string) => `${config().baseUrl.replace(/\/+$/, "")}/s/${token}`;

export const shareLinksRouter = defineRouter({
  listShareLinks: (req) => {
    const { workspace_id, target_id } = req.query as { workspace_id: string; target_id?: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    const rows = db
      .query(
        `SELECT s.* FROM share_link s
         JOIN recording r ON r.id = s.target_id OR r.id = (SELECT d.recording_id FROM document d WHERE d.id = s.target_id)
         WHERE s.workspace_id = ? AND s.revoked_at IS NULL AND ${VISIBLE_RECORDING_SQL} ${target_id ? "AND s.target_id = ?" : ""}
         ORDER BY s.created_at DESC, s.id`
      )
      .all(...(target_id ? [workspace_id, req.user!.id, target_id] : [workspace_id, req.user!.id])) as ShareLinkRow[];
    return okPage(req, rows.map(shareLinkDto));
  },

  createShareLink: (req) => {
    const body = req.body as {
      target_type: "recording" | "document";
      target_id: string;
      scope: { transcript: boolean; audio: boolean };
      expires_at?: string | null;
      password?: string | null;
    };
    const recording = targetRecording(req, body.target_type, body.target_id, body.target_type === "document" ? "문서" : "녹음");
    if (recording instanceof Response) return recording;
    if (!canShare(req.user!)) return apiError(req.c, 403, "forbidden", SHARE_RESTRICTED_MESSAGE);
    let expiresAt: number | null = null;
    if (body.expires_at) {
      const ms = futureMs(req, body.expires_at);
      if (ms instanceof Response) return ms;
      expiresAt = ms;
    }
    const now = Date.now();
    const token = randomBytes(18).toString("base64url");
    const row: ShareLinkRow = {
      id: uuidv7(now),
      workspace_id: recording.workspace_id,
      target_type: body.target_type,
      target_id: body.target_id,
      token_hash: sha256Hex(token),
      scope_json: JSON.stringify({ transcript: body.scope.transcript, audio: body.scope.audio }),
      expires_at: expiresAt,
      password_hash: body.password ? hashPassword(body.password) : null,
      created_by: req.user!.id,
      created_at: now,
      revoked_at: null,
    };
    db.query(
      `INSERT INTO share_link (id, workspace_id, target_type, target_id, token_hash, scope_json, expires_at, password_hash, created_by, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(row.id, row.workspace_id, row.target_type, row.target_id, row.token_hash, row.scope_json, row.expires_at, row.password_hash, row.created_by, row.created_at);
    return ok(req, { link: shareLinkDto(row), url: shareUrl(token) }, { status: 201 });
  },

  updateShareLink: (req) => {
    const found = linkFor(req);
    if (found instanceof Response) return found;
    if (!canShare(req.user!)) return apiError(req.c, 403, "forbidden", SHARE_RESTRICTED_MESSAGE);
    const body = req.body as { scope?: { transcript: boolean; audio: boolean }; expires_at?: string | null; password?: string | null };
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (body.scope !== undefined) {
      sets.push("scope_json = ?");
      params.push(JSON.stringify({ transcript: body.scope.transcript, audio: body.scope.audio }));
    }
    if (body.expires_at !== undefined) {
      let expiresAt: number | null = null;
      if (body.expires_at !== null) {
        const ms = futureMs(req, body.expires_at);
        if (ms instanceof Response) return ms;
        expiresAt = ms;
      }
      sets.push("expires_at = ?");
      params.push(expiresAt);
    }
    if (body.password !== undefined) {
      sets.push("password_hash = ?");
      params.push(body.password === null ? null : hashPassword(body.password));
    }
    if (sets.length) db.query(`UPDATE share_link SET ${sets.join(", ")} WHERE id = ?`).run(...params, found.link.id);
    const row = db.query(`SELECT * FROM share_link WHERE id = ?`).get(found.link.id) as ShareLinkRow;
    return ok(req, shareLinkDto(row));
  },

  // Revoking is always allowed to whoever may change the recording; already revoked is 204.
  revokeShareLink: (req) => {
    const found = linkFor(req, { allowRevoked: true });
    if (found instanceof Response) return found;
    const { link, recording } = found;
    if (link.revoked_at === null) db.query(`UPDATE share_link SET revoked_at = ? WHERE id = ?`).run(Date.now(), link.id);
    // A migrated v1 link follows lectures.is_public: make the lecture private too, or the
    // next projection (projectShareLink) would bring the link back.
    if (recording.lecture_id && link.id === lectureShareLinkId(recording.lecture_id)) {
      setLectureVisibility(recording.lecture_id, false, false);
      announceLectures([recording.lecture_id]);
    }
    return req.c.body(null, 204);
  },
});
