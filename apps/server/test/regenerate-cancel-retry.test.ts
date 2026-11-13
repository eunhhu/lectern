import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { lectureRecordingId, personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import {
  Harness,
  HarnessError,
  ScriptedLlmProvider,
  ScriptedTranscriptionProvider,
  synthesizeSpeechTone,
  type LlmRequest,
  type ScriptLine,
  type Transcript,
} from "@lectern/harness";
import { isFfmpegAvailable } from "@lectern/media";
import {
  createPendingLecture,
  createUser,
  DATA_DIR,
  db,
  ensureBootstrapOwner,
  generateId,
  getLectureById,
  getSystemSettings,
  HARNESS_BLOB_DIR,
  syncPendingLectures,
  type LectureRecord,
  updateSystemSettings,
  type UserRecord,
} from "../src/db.ts";
import { handleRequest } from "../src/index.ts";
import { registerProcessJobHandler, registerRegenerateJobHandler } from "../src/job-handlers.ts";
import { JOB_CANCELED_MESSAGE, PROCESS_JOB_KIND, type ProcessJobDeps } from "../src/process-job.ts";
import { embeddedWorker, enqueueJob, JobWorker, type LeasedJob } from "../src/queue.ts";
import { REGENERATE_JOB_KIND, runRegenerateJob, transcriptFromRows } from "../src/regenerate-job.ts";
import { publishTranscript } from "../src/transcript-publish.ts";
import { notesAnswer, notesCallOf } from "./fixtures/process-answers.ts";

// Jobs here run on scripted providers only: the embedded worker is paused, and a JobWorker
// of this file's own runs the queue while a test waits for its job.
const originalSettings = getSystemSettings();
let paused: JobWorker | null = null;
beforeAll(async () => {
  process.env.LECTERN_WORKER_MODE = "external";
  process.env.LECTERN_PIPELINE = "v2";
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
  updateSystemSettings({ storage_auto_compact: false });
});
afterAll(() => {
  // Back to the Gemini handlers the modules registered (no key in the sandbox: never called).
  registerProcessJobHandler();
  registerRegenerateJobHandler();
  updateSystemSettings(originalSettings);
  for (const name of ["LECTERN_WORKER_MODE", "LECTERN_PIPELINE"]) delete process.env[name];
  resetConfigForTests();
  paused?.start();
});

interface Res {
  status: number;
  body: any;
}

async function api(method: string, path: string, user: UserRecord, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handleRequest(
    new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  );
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null };
}

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

const alice = makeUser("alice");
const bob = makeUser("bob");
const admin = ensureBootstrapOwner();

const TEXTS = ["오늘은 운영 모드를 봅니다", "ECB는 위험합니다", "다음 주 화요일까지 과제를 제출하세요", "CBC는 IV가 필요합니다", "시험에 나옵니다", "수고하셨습니다"];

function syntheticTranscript(): Transcript {
  return {
    version: 1,
    duration_ms: 360_000,
    failed_chunks: [],
    gaps: [],
    speakers: [{ label: "S1", confidence: 1, basis: "single_chunk", segments: TEXTS.length, chars: 60, members: [{ chunk: 0, label: "S1" }] }],
    segments: TEXTS.map((text, idx) => ({ idx, start_ms: idx * 60_000, end_ms: idx * 60_000 + 55_000, speaker: "S1", source_chunk: 0, text })),
  };
}

function audioFile(): string {
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  const path = join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`);
  writeFileSync(path, "audio");
  return path;
}

/** A lecture of `owner` with an audio file and, unless told otherwise, a published transcript. */
function seedLecture(owner: UserRecord, options: { transcript?: boolean; audioPath?: string } = {}): LectureRecord {
  const audioPath = options.audioPath ?? audioFile();
  const lecture = createPendingLecture({
    id: generateId("lec"),
    ownerId: owner.id,
    title: "",
    course: "정보보호",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: 5,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
  if (options.transcript !== false) {
    publishTranscript({ recordingId: lectureRecordingId(lecture.id), workspaceId: personalWorkspaceId(owner.id), transcript: syntheticTranscript() });
  }
  return lecture;
}

/** A running row nobody leases, for a handler called directly. */
function directJob(lecture: LectureRecord, kind: string): LeasedJob {
  const id = `job_${crypto.randomUUID()}`;
  db.query(
    `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at, finished_at)
     VALUES (?, ?, ?, ?, 'running', 0, '{}', ?, NULL)`
  ).run(id, lecture.owner_id, kind, lecture.id, Date.now());
  return { id, kind, subjectId: lecture.id, ownerId: lecture.owner_id, payload: {}, attempts: 0, secret: () => undefined };
}

function finish(jobId: string, state = "succeeded"): void {
  db.query(`UPDATE job SET state = ?, finished_at = ? WHERE id = ?`).run(state, Date.now(), jobId);
}

function harness(): Harness {
  return new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} });
}

function jobRow(id: string) {
  return db.query(`SELECT id, kind, state, error, attempts, cancel_requested_at FROM job WHERE id = ?`).get(id) as {
    id: string;
    kind: string;
    state: string;
    error: string | null;
    attempts: number;
    cancel_requested_at: number | null;
  };
}

function structuredDoc(lectureId: string) {
  return db
    .query(`SELECT id, current_version FROM document WHERE recording_id = ? AND template_id != 'legacy-markdown'`)
    .get(lectureRecordingId(lectureId)) as { id: string; current_version: number } | null;
}

const recordingOf = (lectureId: string) =>
  db.query(`SELECT status, title, failure_code FROM recording WHERE id = ?`).get(lectureRecordingId(lectureId)) as {
    status: string;
    title: string;
    failure_code: string | null;
  };

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await Bun.sleep(25);
  }
}

/** Runs the queue with a worker of this file's own until `jobId` is finished. */
async function runQueued(jobId: string): Promise<void> {
  const worker = new JobWorker({ pollMs: 25 });
  worker.start();
  try {
    await waitFor(() => !["queued", "running"].includes(jobRow(jobId).state), 30_000);
  } finally {
    await worker.drain(10_000);
  }
}

/** Notes on a lecture with a transcript (a document version), on scripted answers. */
async function regenerateNow(lecture: LectureRecord, deps: ProcessJobDeps) {
  const job = directJob(lecture, REGENERATE_JOB_KIND);
  const outcome = await runRegenerateJob(job, deps);
  finish(job.id, outcome.ok ? "succeeded" : "failed");
  return outcome;
}

describe("reprocess mode document (regenerate)", () => {
  test("the published transcript reads back as the harness transcript", () => {
    const lecture = seedLecture(alice);
    const transcript = transcriptFromRows(lectureRecordingId(lecture.id))!;
    expect(transcript.segments.map((s) => [s.idx, s.speaker, s.text])).toEqual(TEXTS.map((t, i) => [i, "S1", t]));
    expect(transcript.speakers).toMatchObject([{ label: "S1", segments: TEXTS.length }]);
    expect(transcriptFromRows(lectureRecordingId(seedLecture(alice, { transcript: false }).id))).toBeNull();
  });

  test("document mode estimate", async () => {
    const lecture = seedLecture(alice);
    const res = await api("POST", `/recordings/${lectureRecordingId(lecture.id)}/reprocess`, alice, { mode: "document", dry_run: true });
    expect(res.status).toBe(200);
    expect(res.body.estimate.estimated_microusd).toBeGreaterThan(0);
    expect(res.body.estimate.audio_ms).toBe(0);
    expect(res.body.job).toBeNull();
    expect(db.query(`SELECT COUNT(*) AS n FROM job WHERE subject_id = ?`).get(lecture.id)).toEqual({ n: 0 });
  });

  test("document mode without transcript", async () => {
    const lecture = seedLecture(alice, { transcript: false });
    const res = await api("POST", `/recordings/${lectureRecordingId(lecture.id)}/reprocess`, alice, { mode: "document" });
    expect(res.status).toBe(409);
  });

  test("regenerate adds a version without transcribing", async () => {
    const lecture = seedLecture(alice);
    expect(await regenerateNow(lecture, { llm: new ScriptedLlmProvider(notesAnswer), harness: harness() })).toMatchObject({
      ok: true,
      result: { status: "ready", version: 1 },
    });

    const llm = new ScriptedLlmProvider(notesAnswer);
    registerRegenerateJobHandler({ llm, harness: harness() });
    const res = await api("POST", `/recordings/${lectureRecordingId(lecture.id)}/reprocess`, alice, { mode: "document" });
    expect(res.status).toBe(202);
    expect(res.body.job).toMatchObject({ kind: "regenerate", state: "queued" });
    expect(res.body.estimate.estimated_microusd).toBeGreaterThan(0);
    await runQueued(res.body.job.id);

    expect(jobRow(res.body.job.id).state).toBe("succeeded");
    const doc = structuredDoc(lecture.id)!;
    expect(doc.current_version).toBe(2);
    expect(db.query(`SELECT COUNT(*) AS n FROM document_version WHERE document_id = ?`).get(doc.id)).toEqual({ n: 2 });
    const stages = db.query(`SELECT DISTINCT stage FROM stage_run WHERE job_id = ?`).all(res.body.job.id) as Array<{ stage: string }>;
    expect(stages.map((s) => s.stage).sort()).toEqual(["classify", "extract", "structure", "verify"]);
    expect(llm.calls.length).toBeGreaterThan(0);
    expect(recordingOf(lecture.id).status).toBe("ready");
  });

  test("regenerate keeps the user title", async () => {
    const lecture = seedLecture(alice);
    await regenerateNow(lecture, { llm: new ScriptedLlmProvider(notesAnswer), harness: harness() });
    db.query(`UPDATE lectures SET title = ? WHERE id = ?`).run("내 제목", lecture.id);
    syncPendingLectures();
    expect(await regenerateNow(lecture, { llm: new ScriptedLlmProvider(notesAnswer), harness: harness() })).toMatchObject({ ok: true });
    expect(recordingOf(lecture.id).title).toBe("내 제목");
    expect(structuredDoc(lecture.id)!.current_version).toBe(2);
  });

  test("regenerate failure keeps the old version", async () => {
    const lecture = seedLecture(alice);
    await regenerateNow(lecture, { llm: new ScriptedLlmProvider(notesAnswer), harness: harness() });
    const before = { doc: structuredDoc(lecture.id), recording: recordingOf(lecture.id), lecture: getLectureById(lecture.id)! };
    const down = new ScriptedLlmProvider(() => new HarnessError("transient", "scripted 503", { code: "http_503" }));
    const outcome = await regenerateNow(lecture, { llm: down, harness: harness() });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/\p{Script=Hangul}/u);
    expect(structuredDoc(lecture.id)).toEqual(before.doc);
    expect(recordingOf(lecture.id)).toEqual(before.recording);
    const after = getLectureById(lecture.id)!;
    for (const field of ["status", "stage", "progress", "markdown", "title"] as const) expect(after[field]).toEqual(before.lecture[field]);
  });

  test("a full notes run clears an earlier partial", async () => {
    const lecture = seedLecture(alice);
    await regenerateNow(lecture, { llm: new ScriptedLlmProvider(notesAnswer), harness: harness() });
    db.query(`UPDATE recording SET status = 'partial', failure_code = 'notes_partial', failure_message = '일부' WHERE id = ?`).run(
      lectureRecordingId(lecture.id)
    );
    await regenerateNow(lecture, { llm: new ScriptedLlmProvider(notesAnswer), harness: harness() });
    expect(recordingOf(lecture.id)).toEqual({ status: "ready", title: expect.any(String), failure_code: null });
  });

  test("regenerate refuses a busy recording", async () => {
    const lecture = seedLecture(alice);
    const queued = enqueueJob({ kind: REGENERATE_JOB_KIND, ownerId: alice.id, subjectId: lecture.id });
    try {
      const res = await api("POST", `/recordings/${lectureRecordingId(lecture.id)}/reprocess`, alice, { mode: "document" });
      expect(res.status).toBe(409);
    } finally {
      finish(queued.jobId, "failed");
    }
  });
});

describe("cancelJob", () => {
  test("cancel queued job", async () => {
    const lecture = seedLecture(alice, { transcript: false });
    const { jobId } = enqueueJob({ kind: PROCESS_JOB_KIND, ownerId: alice.id, subjectId: lecture.id });
    const res = await api("POST", `/jobs/${jobId}/cancel`, alice);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: jobId, state: "canceled" });
    expect(jobRow(jobId)).toMatchObject({ state: "canceled", error: JOB_CANCELED_MESSAGE, cancel_requested_at: expect.any(Number) });
    expect(getLectureById(lecture.id)).toMatchObject({ status: "error", error_message: JOB_CANCELED_MESSAGE });
    expect(recordingOf(lecture.id).status).toBe("failed");
  });

  test("cancel other user's job", async () => {
    const lecture = seedLecture(alice, { transcript: false });
    const { jobId } = enqueueJob({ kind: PROCESS_JOB_KIND, ownerId: alice.id, subjectId: lecture.id });
    try {
      expect((await api("POST", `/jobs/${jobId}/cancel`, bob)).status).toBe(404);
      expect(jobRow(jobId)).toMatchObject({ state: "queued", cancel_requested_at: null });
    } finally {
      finish(jobId, "failed");
    }
  });

  test("cancel finished job", async () => {
    const lecture = seedLecture(alice, { transcript: false });
    const job = directJob(lecture, PROCESS_JOB_KIND);
    finish(job.id, "succeeded");
    expect((await api("POST", `/jobs/${job.id}/cancel`, alice)).status).toBe(409);
  });

  test("only jobs that process a recording can be canceled", async () => {
    const lecture = seedLecture(alice, { transcript: false });
    const { jobId } = enqueueJob({ kind: "compact", ownerId: alice.id, subjectId: lecture.id });
    try {
      expect((await api("POST", `/jobs/${jobId}/cancel`, alice)).status).toBe(409);
    } finally {
      finish(jobId, "failed");
    }
  });

  test.skipIf(!isFfmpegAvailable())(
    "cancel running job stops before the next stage",
    async () => {
      const S = 1000;
      const script: ScriptLine[] = TEXTS.concat(TEXTS, TEXTS).map((text, i) => ({ start_ms: i * 5 * S, end_ms: i * 5 * S + 4 * S, speaker: "S1", text }));
      const audioPath = await synthesizeSpeechTone(script, 92 * S, join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`));
      const lecture = seedLecture(alice, { transcript: false, audioPath });
      let jobId = "";
      // A user cancels while the first chunk is being transcribed.
      const transcription: ScriptedTranscriptionProvider = new ScriptedTranscriptionProvider(script, {}, () => {
        if (transcription.calls.length === 1) db.query(`UPDATE job SET cancel_requested_at = ? WHERE id = ?`).run(Date.now(), jobId);
      });
      const llm = new ScriptedLlmProvider(notesAnswer);
      registerProcessJobHandler({
        transcription,
        llm,
        harness: harness(),
        pipeline: { concurrency: 1, chunk: { targetMs: 30_000, overlapMinMs: 3_000, overlapMaxMs: 6_000 }, onStage: transcription.observe },
      });
      jobId = enqueueJob({ kind: PROCESS_JOB_KIND, ownerId: alice.id, subjectId: lecture.id }).jobId;
      await runQueued(jobId);

      expect(jobRow(jobId)).toMatchObject({ state: "canceled", error: JOB_CANCELED_MESSAGE });
      expect(transcription.calls).toEqual([0]); // chunks 1.. never started (at least 3 chunks)
      expect(llm.calls).toEqual([]);
      expect(getLectureById(lecture.id)).toMatchObject({ status: "error", error_message: JOB_CANCELED_MESSAGE });
      expect(db.query(`SELECT COUNT(*) AS n FROM artifact WHERE job_id = ?`).get(jobId)).toEqual({ n: 0 });
    },
    60_000
  );
});

describe("adminRetryJob", () => {
  test("retry resumes at the failed stage", async () => {
    const lecture = seedLecture(alice);
    // structure fails (transient, three times): the job fails after classify succeeded.
    const flaky = new ScriptedLlmProvider((req: LlmRequest<unknown>) =>
      notesCallOf(req) === "structure" ? new HarnessError("transient", "scripted 503", { code: "http_503" }) : notesAnswer(req)
    );
    registerRegenerateJobHandler({ llm: flaky, harness: harness() });
    const queued = await api("POST", `/recordings/${lectureRecordingId(lecture.id)}/reprocess`, alice, { mode: "document" });
    expect(queued.status).toBe(202);
    const jobId = queued.body.job.id as string;
    await runQueued(jobId);
    expect(jobRow(jobId).state).toBe("failed");
    expect(flaky.calls.filter((c) => notesCallOf(c.req) === "classify").length).toBe(1);
    expect(structuredDoc(lecture.id)).toBeNull();

    const fixed = new ScriptedLlmProvider(notesAnswer);
    registerRegenerateJobHandler({ llm: fixed, harness: harness() });
    const retried = await api("POST", `/admin/jobs/${jobId}/retry`, admin);
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ id: jobId, state: "queued", attempts: 0 });
    await runQueued(jobId);

    expect(jobRow(jobId).state).toBe("succeeded");
    expect(fixed.calls.filter((c) => notesCallOf(c.req) === "classify")).toEqual([]); // classify came from the first run
    expect(fixed.calls.some((c) => notesCallOf(c.req) === "structure")).toBe(true);
    expect(db.query(`SELECT COUNT(*) AS n FROM stage_run WHERE job_id = ? AND stage IN ('ingest', 'transcribe')`).get(jobId)).toEqual({ n: 0 });
    expect(structuredDoc(lecture.id)!.current_version).toBe(1);
    expect(recordingOf(lecture.id).status).toBe("ready");
  });

  test("retry non-failed job", async () => {
    const lecture = seedLecture(alice);
    const { jobId } = enqueueJob({ kind: REGENERATE_JOB_KIND, ownerId: alice.id, subjectId: lecture.id });
    try {
      expect((await api("POST", `/admin/jobs/${jobId}/retry`, admin)).status).toBe(409);
    } finally {
      finish(jobId, "failed");
    }
  });

  test("retry by a non-admin", async () => {
    const lecture = seedLecture(alice);
    const job = directJob(lecture, REGENERATE_JOB_KIND);
    finish(job.id, "failed");
    expect((await api("POST", `/admin/jobs/${job.id}/retry`, alice)).status).toBe(403);
    expect(jobRow(job.id).state).toBe("failed");
  });
});
