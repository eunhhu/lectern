import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, resetConfigForTests } from "@lectern/config";
import { lectureRecordingId, personalWorkspaceId, uuidv7 } from "@lectern/db";
import { ApiError, DataExportDto, DataExportPage, Recording, Transcript } from "@lectern/domain";
import { createApiV2App } from "../src/api/v2/index.ts";
import { completeLectureRecord, createPendingLecture, createUser, db, deleteUserAndData, generateId, type UserRecord } from "../src/db.ts";
import { EXPORT_JOB_KIND, EXPORT_NOT_MEMBER_MESSAGE, exportDir, expireExports, getExport, runExportJob } from "../src/export/job.ts";
import { embeddedWorker, type JobWorker } from "../src/queue.ts";
import { jsonOf, readZip, textOf, type ReadEntry } from "./zip-reader.ts";

// Workspace export zips (P5-08, D-P5-8): requested over the API, built by runExportJob (run
// here directly), downloaded by the requester only, expired after 7 days.

const app = createApiV2App();

// This file runs the export jobs itself: the embedded worker (shared by every test file in
// this process) must not lease them, and with LECTERN_WORKER_MODE=external no new one starts.
let paused: JobWorker | null = null;

beforeAll(async () => {
  Object.assign(process.env, { LECTERN_WORKER_MODE: "external", LECTERN_TEAMS: "1" });
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
});
afterAll(() => {
  db.query(`DELETE FROM job WHERE kind = ?`).run(EXPORT_JOB_KIND);
  delete process.env.LECTERN_WORKER_MODE;
  delete process.env.LECTERN_TEAMS;
  resetConfigForTests();
  paused?.start();
});

const user = () => createUser({ email: `${generateId("exp")}@test.local`, displayName: "exp", password: "correct_password_1" });

async function call(u: UserRecord, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "X-Lectern-Token": u.api_token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** A processed lecture with an audio file, plus a transcript, an event and an action item. */
function lecture(owner: UserRecord, title: string): { recordingId: string; audio: Uint8Array } {
  const id = generateId("lec");
  const audio = crypto.getRandomValues(new Uint8Array(4096));
  const audioPath = join(config().lecturesDir, `${id}.m4a`);
  writeFileSync(audioPath, audio);
  createPendingLecture({
    id,
    ownerId: owner.id,
    title,
    course: "자료구조",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: audio.length,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "web",
  });
  completeLectureRecord(id, { title, courseName: "자료구조", markdown: `# ${title}\n\n- 스택과 큐\n`, excerpt: "", modelUsed: "gemini-3.8-flash", durationSec: 600 });
  const recordingId = lectureRecordingId(id);
  const ws = personalWorkspaceId(owner.id);
  const now = Date.now();
  const speaker = uuidv7(now);
  db.query(`INSERT INTO speaker (id, workspace_id, recording_id, label, created_at, updated_at) VALUES (?, ?, ?, 'S1', ?, ?)`).run(speaker, ws, recordingId, now, now);
  db.query(
    `INSERT INTO transcript_segment (workspace_id, recording_id, idx, start_ms, end_ms, speaker_id, text) VALUES (?, ?, 0, 0, 4000, ?, '오늘은 스택을 배웁니다.'), (?, ?, 1, 4000, 9000, ?, '다음 주 화요일에 퀴즈가 있습니다.')`
  ).run(ws, recordingId, speaker, ws, recordingId, speaker);
  db.query(
    `INSERT INTO event_candidate (id, workspace_id, recording_id, kind, title, start_at, tz, raw_expression, resolution_json, confidence, evidence_json, created_at, updated_at)
     VALUES (?, ?, ?, 'quiz', '자료구조 퀴즈', ?, 'Asia/Seoul', '다음 주 화요일', '{}', 0.9, '[]', ?, ?)`
  ).run(uuidv7(now), ws, recordingId, now + 7 * 86_400_000, now, now);
  db.query(`INSERT INTO action_item (id, workspace_id, recording_id, text, evidence_json, created_at, updated_at) VALUES (?, ?, ?, '퀴즈 준비', '[]', ?, ?)`).run(
    uuidv7(now),
    ws,
    recordingId,
    now,
    now
  );
  return { recordingId, audio };
}

async function requestExport(u: UserRecord, workspaceId: string, includeAudio = false): Promise<DataExportDto> {
  const res = await call(u, "POST", "/me/exports", { workspace_id: workspaceId, include_audio: includeAudio });
  expect(res.status).toBe(202);
  return DataExportDto.parse(await res.json());
}

async function download(u: UserRecord, id: string): Promise<Response> {
  return call(u, "GET", `/me/exports/${id}/content`);
}

/** Requests, builds and downloads an export; returns its entries by name. */
async function exportOf(u: UserRecord, workspaceId: string, includeAudio = false): Promise<{ id: string; files: Map<string, ReadEntry> }> {
  const created = await requestExport(u, workspaceId, includeAudio);
  await runExportJob(created.id);
  const res = await download(u, created.id);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/zip");
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="lectern-export-\d{8}\.zip"$/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(Number(res.headers.get("content-length"))).toBe(bytes.length);
  return { id: created.id, files: new Map(readZip(bytes).map((e) => [e.name, e])) };
}

describe("export contents", () => {
  const owner = user();
  const ws = personalWorkspaceId(owner.id);
  const first = lecture(owner, "자료구조 3주차");
  const second = lecture(owner, "자료구조: 4주차?");

  test("export contains the expected files", async () => {
    const { files } = await exportOf(owner, ws);
    const names = [...files.keys()];
    expect(names.slice(0, 3)).toEqual(["README.txt", "export.json", "recordings.json"]);
    expect(textOf(files.get("README.txt"))).toContain("recordings/ 아래 폴더 하나가 녹음 하나입니다.");
    expect(jsonOf(files.get("export.json"))).toMatchObject({ format: 1, workspace: { id: ws }, recordings: 2, include_audio: false });
    for (const dir of ["recordings/0001-자료구조 3주차", "recordings/0002-자료구조_ 4주차_"]) {
      for (const f of ["recording.json", "document.md", "document.json", "transcript.json", "events.json", "action-items.json"]) {
        expect(files.has(`${dir}/${f}`), `${dir}/${f}`).toBe(true);
      }
    }
    expect(textOf(files.get("recordings/0001-자료구조 3주차/document.md"))).toContain("- 스택과 큐");
    expect(jsonOf(files.get("recordings/0001-자료구조 3주차/events.json"))).toMatchObject([{ title: "자료구조 퀴즈" }]);
    expect(jsonOf(files.get("recordings/0001-자료구조 3주차/action-items.json"))).toMatchObject([{ text: "퀴즈 준비" }]);
    expect(names.some((n) => n.includes("/audio/"))).toBe(false);
  });

  test("json shapes", async () => {
    const { files } = await exportOf(owner, ws);
    const recording = Recording.parse(jsonOf(files.get("recordings/0001-자료구조 3주차/recording.json")));
    expect(recording.id).toBe(first.recordingId as never);
    const transcript = Transcript.parse(jsonOf(files.get("recordings/0001-자료구조 3주차/transcript.json")));
    expect(transcript.segments.map((s) => s.text)).toEqual(["오늘은 스택을 배웁니다.", "다음 주 화요일에 퀴즈가 있습니다."]);
    const list = jsonOf(files.get("recordings.json")) as unknown[];
    expect(list.map((r) => Recording.parse(r).id)).toEqual([first.recordingId, second.recordingId] as never[]);
  });

  test("audio only when asked", async () => {
    const { files } = await exportOf(owner, ws, true);
    const audio = files.get("recordings/0001-자료구조 3주차/audio/0.m4a");
    expect(audio).toBeDefined();
    expect(Buffer.from(audio!.data).equals(Buffer.from(first.audio))).toBe(true);
    expect(Buffer.from(files.get("recordings/0002-자료구조_ 4주차_/audio/0.m4a")!.data).equals(Buffer.from(second.audio))).toBe(true);
  });
});

describe("export access", () => {
  test("private recordings of others are left out", async () => {
    const a = user();
    const b = user();
    const created = await call(a, "POST", "/workspaces", { name: "스터디" });
    expect(created.status).toBe(201);
    const team = ((await created.json()) as { id: string }).id;
    const now = Date.now();
    db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', ?, ?)`).run(team, b.id, now, now);
    const add = (by: UserRecord, title: string, visibility: string) =>
      db
        .query(
          `INSERT INTO recording (id, workspace_id, title, recorded_at, recorded_at_source, status, created_by, visibility, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'upload', 'ready', ?, ?, ?, ?)`
        )
        .run(uuidv7(now), team, title, now, by.id, visibility, now, now);
    add(a, "A의 비공개", "private");
    add(b, "B의 공유", "workspace");
    add(b, "B의 비공개", "private");

    const { files } = await exportOf(a, team);
    const titles = (jsonOf(files.get("recordings.json")) as Array<{ title: string }>).map((r) => r.title).sort();
    expect(titles).toEqual(["A의 비공개", "B의 공유"]);
    expect([...files.keys()].some((n) => n.includes("B의 비공개"))).toBe(false);
    // Not a member: no export at all.
    expect((await call(user(), "POST", "/me/exports", { workspace_id: team, include_audio: false })).status).toBe(403);
  });

  test("leaving the workspace before the job runs fails the export", async () => {
    const a = user();
    const b = user();
    const team = ((await (await call(a, "POST", "/workspaces", { name: "팀" })).json()) as { id: string }).id;
    const now = Date.now();
    db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', ?, ?)`).run(team, b.id, now, now);
    const created = await requestExport(b, team);
    db.query(`DELETE FROM membership WHERE workspace_id = ? AND user_id = ?`).run(team, b.id);
    await runExportJob(created.id);
    expect(getExport(created.id)).toMatchObject({ state: "failed", error: EXPORT_NOT_MEMBER_MESSAGE, blob_key: null });
    expect((await download(b, created.id)).status).toBe(409);
  });

  test("someone else's export", async () => {
    const a = user();
    const created = await requestExport(a, personalWorkspaceId(a.id));
    await runExportJob(created.id);
    expect((await download(a, created.id)).status).toBe(200);
    expect((await download(user(), created.id)).status).toBe(404);
    const listed = DataExportPage.parse(await (await call(user(), "GET", "/me/exports")).json());
    expect(listed.items).toEqual([]);
  });

  test("not ready", async () => {
    const a = user();
    const created = await requestExport(a, personalWorkspaceId(a.id));
    const res = await download(a, created.id);
    expect(res.status).toBe(409);
    expect(ApiError.parse(await res.json()).error.message).toBe("아직 준비되지 않았거나 만료된 내보내기입니다.");
  });

  test("one at a time", async () => {
    const a = user();
    await requestExport(a, personalWorkspaceId(a.id));
    const again = await call(a, "POST", "/me/exports", { workspace_id: personalWorkspaceId(a.id), include_audio: true });
    expect(again.status).toBe(409);
    expect(ApiError.parse(await again.json()).error.message).toBe("이미 만들고 있는 내보내기가 있습니다.");
  });

  test("five a day", async () => {
    const a = user();
    const ws = personalWorkspaceId(a.id);
    for (let i = 0; i < 5; i++) await runExportJob((await requestExport(a, ws)).id);
    const sixth = await call(a, "POST", "/me/exports", { workspace_id: ws, include_audio: false });
    expect(sixth.status).toBe(409);
    expect(ApiError.parse(await sixth.json()).error.message).toBe("내보내기는 하루에 5번까지 만들 수 있습니다.");
    const listed = DataExportPage.parse(await (await call(a, "GET", "/me/exports")).json());
    expect(listed.items.length).toBe(5);
    expect(listed.items.every((e) => e.state === "ready" && e.bytes !== null && e.expires_at !== null)).toBe(true);
  });
});

describe("export lifecycle", () => {
  test("expires after 7 days", async () => {
    const a = user();
    const created = await requestExport(a, personalWorkspaceId(a.id));
    await runExportJob(created.id);
    const file = join(exportDir(), `${created.id}.zip`);
    expect(existsSync(file)).toBe(true);
    expect(expireExports()).toBe(0);

    db.query(`UPDATE data_export SET expires_at = ? WHERE id = ?`).run(Date.now() - 1, created.id);
    expect(expireExports()).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect(getExport(created.id)).toMatchObject({ state: "expired", blob_key: null });
    expect((await download(a, created.id)).status).toBe(409);
  });

  test("failure is reported", async () => {
    const a = user();
    // A membership in a workspace row that is gone: the build throws after the file was opened.
    const id = uuidv7();
    const gone = `wsp_${generateId("gone")}`;
    const now = Date.now();
    db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)`).run(gone, a.id, now, now);
    db.query(`INSERT INTO data_export (id, user_id, workspace_id, include_audio, state, requested_at) VALUES (?, ?, ?, 0, 'queued', ?)`).run(id, a.id, gone, now);
    await runExportJob(id);
    const row = getExport(id)!;
    expect(row.state).toBe("failed");
    expect(row.error).toBe("내보내기를 만들지 못했습니다.");
    expect(readdirSync(exportDir()).some((n) => n.startsWith(id))).toBe(false);
  });

  test("an export whose job is gone does not block the next one", async () => {
    const a = user();
    const ws = personalWorkspaceId(a.id);
    const created = await requestExport(a, ws);
    // The job ended without the handler (a crash, a cleanup): the row would hold the slot.
    db.query(`UPDATE job SET state = 'failed' WHERE kind = ? AND subject_id = ?`).run(EXPORT_JOB_KIND, created.id);
    expect((await call(a, "POST", "/me/exports", { workspace_id: ws, include_audio: false })).status).toBe(409);
    expireExports();
    expect(getExport(created.id)).toMatchObject({ state: "failed", error: "내보내기를 만들지 못했습니다." });
    await requestExport(a, ws);
  });

  test("file mode", async () => {
    const a = user();
    const created = await requestExport(a, personalWorkspaceId(a.id));
    await runExportJob(created.id);
    expect(statSync(join(exportDir(), `${created.id}.zip`)).mode & 0o777).toBe(0o600);
    expect(statSync(exportDir()).mode & 0o777).toBe(0o700);
    // Only <data dir>/exports holds export files.
    expect(readdirSync(exportDir()).every((n) => n.endsWith(".zip"))).toBe(true);
  });

  test("deleting the account deletes its exports", async () => {
    const a = user();
    const created = await requestExport(a, personalWorkspaceId(a.id));
    await runExportJob(created.id);
    const file = join(exportDir(), `${created.id}.zip`);
    expect(existsSync(file)).toBe(true);
    expect(deleteUserAndData(a.id)).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(getExport(created.id)).toBeNull();
  });
});
