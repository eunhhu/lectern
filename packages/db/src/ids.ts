// Ids of v2 rows. Ids are opaque strings matching the domain pattern [A-Za-z0-9_-]{1,64}
// (packages/domain primitives.ts). New rows get a UUIDv7; rows carried over from a v1
// lecture get an id derived from it, so the migration, the v1 bridge of 물어보기
// (apps/server/src/ask, ARCHITECTURE §12.4) and the v1 adapter all agree without a lookup
// table (ARCHITECTURE §5.3). No imports beyond node:crypto, so db.ts and the ask bridge can
// both use these without an import cycle.

import { createHash, randomBytes } from "node:crypto";

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const short = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);

/** A UUIDv7 (RFC 9562): 48-bit Unix ms timestamp, then random bits. Sorts by creation time. */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * `wsp_<user id>` (a v1 user id is `usr_<uuid>`), or a hash for ids that would not fit
 * the domain id pattern. Every user has exactly one personal workspace with this id.
 */
export function personalWorkspaceId(userId: string): string {
  const direct = `wsp_${userId}`;
  return ID_PATTERN.test(direct) ? direct : `wsp_${createHash("sha256").update(userId).digest("hex").slice(0, 40)}`;
}

/** The folder a v1 course name became, per (owner, course name). Only used when the folder is created. */
export function courseFolderId(ownerId: string, course: string): string {
  return `fld_${short(`${ownerId}\n${course}`)}`;
}

/** The legacy-markdown document of a lecture (one per lecture). */
export function lectureDocumentId(lectureId: string): string {
  return `doc_${lectureId}`.length <= 64 ? `doc_${lectureId}` : `doc_${short(lectureId)}`;
}

/** The recording of a lecture: the lecture id itself whenever it is a valid domain id. */
export function lectureRecordingId(lectureId: string): string {
  return ID_PATTERN.test(lectureId) ? lectureId : `rec_${short(lectureId)}`;
}

/** `<prefix>_<key>` when that is a valid id, else `<prefix>_<hash of key>`. */
function derivedId(prefix: string, key: string): string {
  const direct = `${prefix}_${key}`;
  return ID_PATTERN.test(direct) ? direct : `${prefix}_${short(key)}`;
}

/** The original-audio asset of a lecture. */
export const lectureAudioAssetId = (lectureId: string) => derivedId("ast", lectureId);

/** The share link a lecture's v1 share token became. */
export const lectureShareLinkId = (lectureId: string) => derivedId("shl", lectureId);

/** Version `n` of a document. */
export const documentVersionId = (documentId: string, version: number) => derivedId(`dv${version}`, documentId);

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
