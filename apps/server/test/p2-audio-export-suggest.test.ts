import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lectureDocumentId, lectureRecordingId, personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH, AskSuggestions, versionETag } from "@lectern/domain";
import { buildSuggestions } from "../src/api/v2/suggestions.ts";
import { completeLectureRecord, createPendingLecture, createUser, DATA_DIR, db, generateId, getLectureById, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";

// D-P2-4 over real rows: deleting only the audio, the Markdown export of a document, and
// rule-built ask suggestions (no model, so they answer with LECTERN_ASK off).

interface Res {
  status: number;
  body: any;
  res: Response;
}

async function api(method: string, path: string, user: UserRecord, init: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token, ...init.headers };
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body }));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null, res };
}

async function v1(method: string, path: string, user: UserRecord): Promise<Res> {
  const res = await handleRequest(new Request(`http://localhost${path}`, { method, headers: { "X-Lectern-Token": user.api_token } }));
  return { status: res.status, body: await res.json(), res };
}

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

/** A finished v1 lecture with an audio file under uploads. */
function seedLecture(owner: UserRecord, title: string, markdown = `# ${title}\n\n## 핵심\n- [10:15] FCFS 대기 시간`): { id: string; audioPath: string } {
  const id = generateId("lec");
  const audioPath = join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`);
  writeFileSync(audioPath, `audio of ${title}`);
  createPendingLecture({
    id,
    ownerId: owner.id,
    title,
    course: "운영체제",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: `audio of ${title}`.length,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "macos-native-menubar",
  });
  completeLectureRecord(id, { title, courseName: "운영체제", markdown, excerpt: "", modelUsed: "gemini-3.8-flash", durationSec: 600 });
  return { id, audioPath };
}

/** An extra audio part as a multi-part upload stores it (`file:` blob under uploads). */
function seedAudioPart(owner: UserRecord, recordingId: string): { assetId: string; path: string } {
  const assetId = generateId("ast");
  const path = join(DATA_DIR, "uploads", `${generateId("part")}.m4a`);
  writeFileSync(path, "part 2");
  db.query(
    `INSERT INTO asset (id, workspace_id, recording_id, kind, part_index, blob_key, sha256, bytes, mime, duration_ms, page_count, meta_json, created_at)
     VALUES (?, ?, ?, 'audio', 2, ?, ?, 6, 'audio/mp4', NULL, NULL, '{}', ?)`
  ).run(assetId, personalWorkspaceId(owner.id), recordingId, `file:${path}`, "0".repeat(64), Date.now());
  return { assetId, path };
}

function addMember(workspaceId: string, user: UserRecord, role: "admin" | "member" | "viewer") {
  const now = Date.now();
  db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(workspaceId, user.id, role, now, now);
}

describe("DELETE /recordings/{id}/audio", () => {
  test("the creator deletes the audio and keeps the notes", async () => {
    const alice = makeUser("alice");
    const { id, audioPath } = seedLecture(alice, "스케줄링");
    const recordingId = lectureRecordingId(id);
    const part = seedAudioPart(alice, recordingId);
    const before = await api("GET", `/recordings/${recordingId}`, alice);
    expect(before.body.assets.filter((a: { kind: string }) => a.kind.startsWith("audio"))).toHaveLength(2);
    const v1Before = await v1("GET", "/api/lectures", alice);

    const res = await api("DELETE", `/recordings/${recordingId}/audio`, alice);
    expect(res.status).toBe(204);

    const after = await api("GET", `/recordings/${recordingId}`, alice);
    expect(after.body.assets.filter((a: { kind: string }) => a.kind.startsWith("audio"))).toEqual([]);
    expect(after.body.documents).toEqual(before.body.documents);
    expect(existsSync(audioPath)).toBe(false);
    expect(existsSync(part.path)).toBe(false);
    expect(db.query(`SELECT id FROM asset WHERE id = ?`).get(part.assetId)).toBeNull();

    const lecture = await v1("GET", `/api/lectures/${id}`, alice);
    expect(lecture.body.lecture.has_audio).toBe(false);
    expect(lecture.body.lecture.markdown).toBe(getLectureById(id)!.markdown);
    expect(lecture.body.lecture.markdown).toContain("FCFS 대기 시간");

    // v1 list: same keys as before.
    const v1After = await v1("GET", "/api/lectures", alice);
    const keysOf = (body: any) => Object.keys(body.lectures.find((l: { id: string }) => l.id === id)).sort();
    expect(keysOf(v1After.body)).toEqual(keysOf(v1Before.body));

    // Idempotent.
    expect((await api("DELETE", `/recordings/${recordingId}/audio`, alice)).status).toBe(204);
  });

  test("viewers may not, outsiders do not see it, admins may", async () => {
    const alice = makeUser("alice");
    const viewer = makeUser("viewer");
    const admin = makeUser("admin");
    const outsider = makeUser("outsider");
    const workspace = personalWorkspaceId(alice.id);
    addMember(workspace, viewer, "viewer");
    addMember(workspace, admin, "admin");
    const { id } = seedLecture(alice, "공유 녹음");
    const recordingId = lectureRecordingId(id);
    expect((await api("PATCH", `/recordings/${recordingId}`, alice, { body: { visibility: "workspace" } })).status).toBe(200);

    expect((await api("DELETE", `/recordings/${recordingId}/audio`, viewer)).status).toBe(403);
    expect((await api("DELETE", `/recordings/${recordingId}/audio`, outsider)).status).toBe(404);
    expect(getLectureById(id)!.audio_path).not.toBeNull();
    expect((await api("DELETE", `/recordings/${recordingId}/audio`, admin)).status).toBe(204);
    expect(getLectureById(id)!.audio_path).toBeNull();
  });

  test("a private recording of someone else is not found", async () => {
    const alice = makeUser("alice");
    const bob = makeUser("bob");
    const { id } = seedLecture(alice, "비공개");
    expect((await api("DELETE", `/recordings/${lectureRecordingId(id)}/audio`, bob)).status).toBe(404);
  });
});

describe("GET /documents/{id}/export", () => {
  test("the current version as a Markdown attachment", async () => {
    const alice = makeUser("alice");
    const { id } = seedLecture(alice, "정보보호 7주차", "# 정보보호 7주차\n\n- 블록 암호");
    const documentId = lectureDocumentId(id);
    const res = await api("GET", `/documents/${documentId}/export?format=md`, alice);
    expect(res.status).toBe(200);
    expect(res.res.headers.get("content-type")!.startsWith("text/markdown")).toBe(true);
    const disposition = res.res.headers.get("content-disposition")!;
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain(encodeURIComponent("정보보호 7주차.md"));
    const current = db.query(`SELECT v.rendered_md FROM document d JOIN document_version v ON v.document_id = d.id AND v.version = d.current_version WHERE d.id = ?`).get(documentId) as { rendered_md: string };
    expect(await res.res.text()).toBe(`${current.rendered_md}\n`);
  });

  test("a saved edit is what gets exported", async () => {
    const alice = makeUser("alice");
    const { id } = seedLecture(alice, "편집 뒤");
    const documentId = lectureDocumentId(id);
    const saved = await api("POST", `/documents/${documentId}/versions`, alice, {
      body: { markdown: "# 고친 노트\n\n새 내용" },
      headers: { "If-Match": versionETag(1) },
    });
    expect(saved.status).toBe(201);
    const res = await api("GET", `/documents/${documentId}/export?format=md`, alice);
    expect(await res.res.text()).toContain("새 내용");
  });

  test("someone else's document and a wrong format", async () => {
    const alice = makeUser("alice");
    const bob = makeUser("bob");
    const { id } = seedLecture(alice, "남의 문서");
    const documentId = lectureDocumentId(id);
    expect((await api("GET", `/documents/${documentId}/export?format=md`, bob)).status).toBe(404);
    expect((await api("GET", `/documents/${documentId}/export?format=pdf`, alice)).status).toBe(400);
  });
});

describe("ask suggestions", () => {
  test("buildSuggestions: domain questions, then sections once each", () => {
    const out = buildSuggestions({ scope: "recording", domain: "lecture", sectionTitles: ["A", "A", "B"] });
    expect(out).toHaveLength(5);
    expect(out[0]).toBe("이 강의의 핵심 내용을 요약해 줘.");
    expect(out[3]).toBe("「A」 부분을 자세히 설명해 줘.");
    expect(buildSuggestions({ scope: "recording", domain: "call" })[0]).toBe("이 회의에서 결정된 것은 뭐야?");
    expect(buildSuggestions({ scope: "recording", domain: "unknown" })[0]).toBe("이 녹음의 핵심 내용을 요약해 줘.");
  });

  test("buildSuggestions: at most six", () => {
    const titles = Array.from({ length: 10 }, (_, i) => `섹션 ${i + 1}`);
    expect(buildSuggestions({ scope: "recording", domain: "lecture", sectionTitles: titles })).toHaveLength(6);
  });

  test("buildSuggestions: long titles are cut at 30 characters", () => {
    const title = "가".repeat(40);
    const out = buildSuggestions({ scope: "recording", domain: "other", sectionTitles: [`  ${title}`] });
    expect(out[3]).toBe(`「${"가".repeat(30)}…」 부분을 자세히 설명해 줘.`);
  });

  test("recording, workspace and folder scopes over the API (LECTERN_ASK off)", async () => {
    const alice = makeUser("alice");
    const workspace = personalWorkspaceId(alice.id);
    const { id } = seedLecture(alice, "추천 질문");
    const recordingId = lectureRecordingId(id);

    const forRecording = await api("GET", `/ask/suggestions?workspace_id=${workspace}&scope_type=recording&scope_id=${recordingId}`, alice);
    expect(forRecording.status).toBe(200);
    const parsed = AskSuggestions.parse(forRecording.body);
    expect(parsed.suggestions.length).toBeGreaterThan(0);
    expect(parsed.suggestions.length).toBeLessThanOrEqual(6);

    const forWorkspace = await api("GET", `/ask/suggestions?workspace_id=${workspace}&scope_type=workspace`, alice);
    expect(forWorkspace.status).toBe(200);
    expect(forWorkspace.body.suggestions).toEqual(buildSuggestions({ scope: "workspace" }));

    const folder = await api("POST", "/folders", alice, { body: { workspace_id: workspace, name: "추천 폴더" } });
    expect(folder.status).toBe(201);
    const forFolder = await api("GET", `/ask/suggestions?workspace_id=${workspace}&scope_type=folder&scope_id=${folder.body.id}`, alice);
    expect(forFolder.status).toBe(200);
    expect(forFolder.body.suggestions).toEqual(buildSuggestions({ scope: "folder" }));
  });

  test("permissions and a missing scope_id", async () => {
    const alice = makeUser("alice");
    const bob = makeUser("bob");
    const aliceWs = personalWorkspaceId(alice.id);
    const bobWs = personalWorkspaceId(bob.id);
    const { id } = seedLecture(alice, "비공개 추천");
    const recordingId = lectureRecordingId(id);
    await api("GET", "/me", bob); // makes sure bob's personal workspace exists

    expect((await api("GET", `/ask/suggestions?workspace_id=${aliceWs}&scope_type=workspace`, bob)).status).toBe(403);
    expect((await api("GET", `/ask/suggestions?workspace_id=${bobWs}&scope_type=recording&scope_id=${recordingId}`, bob)).status).toBe(404);
    expect((await api("GET", `/ask/suggestions?workspace_id=${aliceWs}&scope_type=recording`, alice)).status).toBe(400);
    expect((await api("GET", `/ask/suggestions?workspace_id=${aliceWs}&scope_type=folder&scope_id=nope`, alice)).status).toBe(404);
  });
});
