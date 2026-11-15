import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { lectureRecordingId, personalWorkspaceId, uuidv7 } from "@lectern/db";
import { API_BASE_PATH, MarkerDto, MarkerPage } from "@lectern/domain";
import { Harness, ScriptedLlmProvider, type Transcript } from "@lectern/harness";
import {
  completeLectureRecord,
  createPendingLecture,
  createUser,
  DATA_DIR,
  db,
  generateId,
  getSystemSettings,
  HARNESS_BLOB_DIR,
  syncPendingLectures,
  updateSystemSettings,
  type UserRecord,
} from "../src/db.ts";
import { handleRequest, resetAuthRateLimits } from "../src/index.ts";
import { MAX_MARKERS_PER_RECORDING } from "../src/markers.ts";
import { embeddedWorker, type JobWorker, type LeasedJob } from "../src/queue.ts";
import { REGENERATE_JOB_KIND, runRegenerateJob } from "../src/regenerate-job.ts";
import { publishTranscript } from "../src/transcript-publish.ts";
import { notesAnswer, notesCallOf } from "./fixtures/process-answers.ts";

// Recording markers (P6-01, D-P6-3): stored per recording, guarded like recording edits, gone
// with the recording, and passed to the structure stage as the segments to keep.

const originalSettings = getSystemSettings();
let paused: JobWorker | null = null;
beforeAll(async () => {
  // Notes runs here are called directly on scripted providers; no worker may lease them.
  process.env.LECTERN_WORKER_MODE = "external";
  process.env.LECTERN_TEAMS = "1";
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
  updateSystemSettings({ storage_auto_compact: false });
});
afterAll(() => {
  updateSystemSettings(originalSettings);
  for (const name of ["LECTERN_WORKER_MODE", "LECTERN_TEAMS"]) delete process.env[name];
  resetConfigForTests();
  paused?.start();
});
beforeEach(() => resetAuthRateLimits());

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

async function call(user: UserRecord, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return handleRequest(
    new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  );
}

const TEXTS = ["오늘은 운영 모드를 봅니다", "ECB는 위험합니다", "CBC는 IV가 필요합니다", "시험에 나옵니다", "과제는 다음 주까지", "수고하셨습니다"];

function transcript(): Transcript {
  return {
    version: 1,
    duration_ms: 360_000,
    failed_chunks: [],
    gaps: [],
    speakers: [{ label: "S1", confidence: 1, basis: "single_chunk", segments: TEXTS.length, chars: 60, members: [{ chunk: 0, label: "S1" }] }],
    segments: TEXTS.map((text, idx) => ({ idx, start_ms: idx * 60_000, end_ms: idx * 60_000 + 55_000, speaker: "S1", source_chunk: 0, text })),
  };
}

/** A finished lecture of `owner` (personal, so private to everyone else), optionally with a v2 transcript. */
function lecture(owner: UserRecord, withTranscript = false): { lectureId: string; recordingId: string } {
  const id = generateId("lec");
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  const audioPath = join(DATA_DIR, "uploads", `${id}.m4a`);
  writeFileSync(audioPath, "audio");
  createPendingLecture({
    id,
    ownerId: owner.id,
    title: "",
    course: "정보보호",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: 5,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
  if (withTranscript) {
    publishTranscript({ recordingId: lectureRecordingId(id), workspaceId: personalWorkspaceId(owner.id), transcript: transcript() });
  } else {
    completeLectureRecord(id, { title: "강의", courseName: "정보보호", markdown: "# 노트", excerpt: "", modelUsed: "gemini-3.8-flash", durationSec: 60 });
  }
  syncPendingLectures();
  return { lectureId: id, recordingId: lectureRecordingId(id) };
}

/** A team with an owner, a member and a viewer, and a recording of the owner shared with the team. */
function team(): { owner: UserRecord; member: UserRecord; viewer: UserRecord; recordingId: string } {
  const owner = makeUser("owner");
  const member = makeUser("member");
  const viewer = makeUser("viewer");
  const ws = uuidv7();
  const now = Date.now();
  db.query(`INSERT INTO workspace (id, name, kind, plan, settings_json, personal_user_id, created_at, updated_at) VALUES (?, '팀', 'team', 'free', '{}', NULL, ?, ?)`).run(ws, now, now);
  for (const [u, role] of [[owner, "owner"], [member, "member"], [viewer, "viewer"]] as const) {
    db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(ws, u.id, role, now, now);
  }
  const recordingId = uuidv7();
  db.query(
    `INSERT INTO recording (id, workspace_id, folder_id, title, domain, template_id, language, recorded_at, recorded_at_source,
       duration_ms, status, created_by, visibility, lecture_id, source_client, failure_code, failure_message, created_at, updated_at)
     VALUES (?, ?, NULL, '팀 녹음', 'lecture', NULL, NULL, ?, 'upload', NULL, 'ready', ?, 'workspace', NULL, 'test', NULL, NULL, ?, ?)`
  ).run(recordingId, ws, now, owner.id, now, now);
  return { owner, member, viewer, recordingId };
}

const mark = (user: UserRecord, recordingId: string, at_ms: number, label?: string) =>
  call(user, "POST", `/recordings/${recordingId}/markers`, label === undefined ? { at_ms } : { at_ms, label });
const markerCount = (recordingId: string) =>
  (db.query(`SELECT COUNT(*) AS n FROM recording_marker WHERE recording_id = ?`).get(recordingId) as { n: number }).n;

describe("markers", () => {
  test("create and list in time order", async () => {
    const a = makeUser("a");
    const { recordingId } = lecture(a);
    const late = await mark(a, recordingId, 5000, "시험");
    expect(late.status).toBe(201);
    expect(MarkerDto.parse(await late.json())).toMatchObject({ recording_id: recordingId, at_ms: 5000, label: "시험", created_by: a.id });
    expect((await mark(a, recordingId, 1000)).status).toBe(201);
    const list = await call(a, "GET", `/recordings/${recordingId}/markers`);
    expect(list.status).toBe(200);
    const page = MarkerPage.parse(await list.json());
    expect(page.items.map((m) => [m.at_ms, m.label])).toEqual([
      [1000, null],
      [5000, "시험"],
    ]);
  });

  test("double tap is one marker", async () => {
    const a = makeUser("a");
    const { recordingId } = lecture(a);
    const first = (await (await mark(a, recordingId, 5000)).json()) as { id: string };
    const second = await mark(a, recordingId, 5300);
    expect(second.status).toBe(201);
    expect(((await second.json()) as { id: string }).id).toBe(first.id);
    expect(markerCount(recordingId)).toBe(1);
    // Further than 500 ms is another marker.
    expect((await mark(a, recordingId, 5600)).status).toBe(201);
    expect(markerCount(recordingId)).toBe(2);
  });

  test("viewer cannot mark", async () => {
    const t = team();
    expect((await mark(t.viewer, t.recordingId, 1000)).status).toBe(403);
    expect((await mark(t.member, t.recordingId, 1000)).status).toBe(403); // a member may not edit someone else's recording
    expect((await mark(t.owner, t.recordingId, 1000)).status).toBe(201);
    // Everyone who can see the recording sees its markers.
    expect(MarkerPage.parse(await (await call(t.viewer, "GET", `/recordings/${t.recordingId}/markers`)).json()).items).toHaveLength(1);
    expect(markerCount(t.recordingId)).toBe(1);
  });

  test("someone else's private recording", async () => {
    const a = makeUser("a");
    const b = makeUser("b");
    const { recordingId } = lecture(a);
    expect((await mark(b, recordingId, 1000)).status).toBe(404);
    expect((await call(b, "GET", `/recordings/${recordingId}/markers`)).status).toBe(404);
  });

  test("delete by the author", async () => {
    const a = makeUser("a");
    const { recordingId } = lecture(a);
    const { id } = (await (await mark(a, recordingId, 1000)).json()) as { id: string };
    expect((await call(a, "DELETE", `/recordings/${recordingId}/markers/${id}`)).status).toBe(204);
    expect(markerCount(recordingId)).toBe(0);
    expect((await call(a, "DELETE", `/recordings/${recordingId}/markers/${id}`)).status).toBe(404);
  });

  test("delete by another member without rights", async () => {
    const t = team();
    const { id } = (await (await mark(t.owner, t.recordingId, 1000)).json()) as { id: string };
    expect((await call(t.member, "DELETE", `/recordings/${t.recordingId}/markers/${id}`)).status).toBe(403);
    expect((await call(t.viewer, "DELETE", `/recordings/${t.recordingId}/markers/${id}`)).status).toBe(403);
    expect(markerCount(t.recordingId)).toBe(1);
  });

  test("200 markers per recording", async () => {
    const a = makeUser("a");
    const { recordingId } = lecture(a);
    const now = Date.now();
    for (let i = 0; i < MAX_MARKERS_PER_RECORDING; i += 1) {
      db.query(
        `INSERT INTO recording_marker (id, workspace_id, recording_id, at_ms, label, created_by, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)`
      ).run(uuidv7(), personalWorkspaceId(a.id), recordingId, i * 10_000, a.id, now);
    }
    const res = await mark(a, recordingId, 5_000_000);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("표시는 녹음 하나에 200개까지 넣을 수 있습니다.");
  });

  test("recording delete removes markers", async () => {
    // A lecture-backed recording (deleteLectureById) and a loose team recording (v2 rows only).
    const a = makeUser("a");
    const { recordingId } = lecture(a);
    await mark(a, recordingId, 1000);
    expect((await call(a, "DELETE", `/recordings/${recordingId}`)).status).toBe(204);
    expect(markerCount(recordingId)).toBe(0);

    const t = team();
    await mark(t.owner, t.recordingId, 1000);
    const device = crypto.randomUUID();
    await call(t.owner, "PUT", `/me/push-devices/${device}`, { platform: "ios", apns_token: randomBytes(32).toString("hex") });
    expect((await call(t.owner, "PUT", `/recordings/${t.recordingId}/live-activity`, { device_id: device, push_token: randomBytes(32).toString("hex") })).status).toBe(204);
    expect((await call(t.owner, "DELETE", `/recordings/${t.recordingId}`)).status).toBe(204);
    expect(markerCount(t.recordingId)).toBe(0);
    expect(db.query(`SELECT COUNT(*) AS n FROM live_activity WHERE recording_id = ?`).get(t.recordingId)).toEqual({ n: 0 });
  });
});

describe("markers in the notes", () => {
  /** Runs `regenerate` on the lecture with scripted model answers; returns the structure request. */
  async function structureRequest(owner: UserRecord, lectureId: string) {
    const id = `job_${crypto.randomUUID()}`;
    db.query(
      `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at, finished_at)
       VALUES (?, ?, ?, ?, 'running', 0, '{}', ?, NULL)`
    ).run(id, owner.id, REGENERATE_JOB_KIND, lectureId, Date.now());
    const job: LeasedJob = { id, kind: REGENERATE_JOB_KIND, subjectId: lectureId, ownerId: owner.id, payload: {}, attempts: 0, secret: () => undefined };
    const llm = new ScriptedLlmProvider(notesAnswer);
    const outcome = await runRegenerateJob(job, { llm, harness: new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} }) });
    db.query(`UPDATE job SET state = ?, finished_at = ? WHERE id = ?`).run(outcome.ok ? "succeeded" : "failed", Date.now(), id);
    expect(outcome.ok).toBe(true);
    const structure = llm.calls.filter((c) => notesCallOf(c.req) === "structure");
    expect(structure).toHaveLength(1);
    return structure[0]!.req;
  }

  test("markers reach the structure request", async () => {
    const a = makeUser("a");
    const { lectureId, recordingId } = lecture(a, true);
    // 130 s plays in segment #2 (120–175 s); the segment before (#1) comes along.
    expect((await mark(a, recordingId, 130_000, "시험")).status).toBe(201);
    const req = await structureRequest(a, lectureId);
    expect(req.instruction).toContain(`사용자가 녹음 중에 "중요"라고 표시한 구간: #1, #2(시험)`);
  });

  test("no markers: request unchanged", async () => {
    const a = makeUser("a");
    const { lectureId } = lecture(a, true);
    const req = await structureRequest(a, lectureId);
    expect(req.instruction).not.toContain("사용자가 녹음 중에");
    expect(req.instruction).not.toContain("중요");
  });
});
