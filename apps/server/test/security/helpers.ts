// Shared by the P5-15 security tests: users, requests to the real app (handleRequest, the
// same entry the server listens with) and reading cookies off responses.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { lectureDocumentId, lectureRecordingId, personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import {
  completeLectureRecord,
  createPendingLecture,
  createUser,
  DATA_DIR,
  generateId,
  syncPendingLectures,
  type UserRecord,
} from "../../src/db.ts";
import { handleRequest } from "../../src/index.ts";

export const PASSWORD = "security_password_1";

export function makeUser(input: { role?: "admin" | "member" | "viewer"; email?: string } = {}): UserRecord {
  return createUser({
    email: input.email ?? `${generateId("sec")}@test.local`.toLowerCase(),
    displayName: "보안 테스트",
    password: PASSWORD,
    role: input.role ?? "member",
  });
}

export interface Res {
  status: number;
  body: any;
  text: string;
  res: Response;
}

export interface CallInit {
  /** A session token sent as the `lectern_session` cookie. */
  cookie?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Sent as is (not JSON). */
  raw?: BodyInit;
  origin?: string;
}

/** A request to the app; `path` is under /api/v2 unless it starts with "http" or "/api/" or "/". */
export async function call(method: string, path: string, init: CallInit = {}): Promise<Res> {
  const url = path.startsWith("http") ? path : `${init.origin ?? "http://localhost"}${path}`;
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers.Cookie = `lectern_session=${encodeURIComponent(init.cookie)}`;
  let body: BodyInit | undefined = init.raw;
  if (init.body !== undefined) {
    headers["Content-Type"] ??= "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await handleRequest(new Request(url, { method, headers, body, redirect: "manual" }));
  const text = await res.clone().text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text, res };
}

export const v2 = (method: string, path: string, init: CallInit = {}) => call(method, `${API_BASE_PATH}${path}`, init);

/** The value a Set-Cookie on `res` gives `name`, or null. */
export function cookieFrom(res: Response, name: string): string | null {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const at = pair!.indexOf("=");
    if (pair!.slice(0, at).trim() === name) return decodeURIComponent(pair!.slice(at + 1));
  }
  return null;
}

/** Signs in through the web login and returns the session token. */
export async function signIn(email: string, password = PASSWORD): Promise<string> {
  const res = await call("POST", "/api/auth/login", { body: { email, password } });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${res.text}`);
  return cookieFrom(res.res, "lectern_session")!;
}

/** Headers that sign a request in as `user` with the v1 API token (no cookie, no origin). */
export const tokenAuth = (user: UserRecord) => ({ "X-Lectern-Token": user.api_token });

export interface Seeded {
  lectureId: string;
  recordingId: string;
  documentId: string;
  workspaceId: string;
}

/** A finished v1 lecture with an audio file, mirrored into v2 (recording, document). */
export function seedLecture(owner: UserRecord, title = "보안 테스트 강의"): Seeded {
  const id = generateId("lec");
  const audioPath = join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`);
  writeFileSync(audioPath, `audio of ${id}`);
  createPendingLecture({
    id,
    ownerId: owner.id,
    title,
    course: "보안",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: `audio of ${id}`.length,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "web",
  });
  completeLectureRecord(id, { title, courseName: "보안", markdown: `# ${title}\n\n본문`, excerpt: "", modelUsed: "gemini-3.8-flash", durationSec: 300 });
  syncPendingLectures();
  return { lectureId: id, recordingId: lectureRecordingId(id), documentId: lectureDocumentId(id), workspaceId: personalWorkspaceId(owner.id) };
}

/** A v2 share link on a recording; returns its id and the token from the one-time URL. */
export async function createShareLink(owner: UserRecord, recordingId: string, extra: Record<string, unknown> = {}): Promise<{ id: string; token: string }> {
  const res = await v2("POST", "/share-links", {
    headers: tokenAuth(owner),
    body: { target_type: "recording", target_id: recordingId, scope: { transcript: false, audio: false }, ...extra },
  });
  if (res.status !== 201) throw new Error(`share link: ${res.status} ${res.text}`);
  return { id: res.body.link.id, token: String(res.body.url).split("/s/")[1]! };
}
