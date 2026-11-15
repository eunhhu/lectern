import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  type PipelineStageEvent,
  type ScriptLine,
} from "@lectern/harness";
import { isFfmpegAvailable } from "@lectern/media";
import { chunkRecording } from "@lectern/ask";
import { translate, type EventRow } from "../src/api/v2/events.ts";
import { lectureSources } from "../src/ask/legacy.ts";
import {
  createPendingLecture,
  createUser,
  db,
  DATA_DIR,
  deleteLectureById,
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
import {
  enqueueRecordingProcessing,
  PROCESS_JOB_KIND,
  PROCESS_SOURCE_GONE_MESSAGE,
  processBudgetMicrousd,
  runProcessJob,
  type ProcessJobDeps,
} from "../src/process-job.ts";
import { embeddedWorker, type JobWorker, type LeasedJob } from "../src/queue.ts";
import { notesAnswer } from "./fixtures/process-answers.ts";

const REPO = join(import.meta.dir, "../../..");
const S = 1000;

// This file runs process jobs itself, in process or in a spawned lectern-worker. The
// embedded worker (shared by every test file in this process) must not lease them, and with
// LECTERN_WORKER_MODE=external no new one starts.
const originalSettings = getSystemSettings();
let paused: JobWorker | null = null;
const directJobs: string[] = [];
beforeAll(async () => {
  process.env.LECTERN_WORKER_MODE = "external";
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
  updateSystemSettings({ storage_auto_compact: false });
});
afterAll(() => {
  for (const id of directJobs) retire(id);
  updateSystemSettings(originalSettings);
  for (const name of ["LECTERN_WORKER_MODE", "LECTERN_PIPELINE", "GEMINI_API_KEY"]) delete process.env[name];
  resetConfigForTests();
  paused?.start();
});

/**
 * Finishes a job row this file queued or ran by hand, so no worker leases it: not the
 * embedded one once it resumes, not the lectern-worker the SIGKILL test spawns.
 */
function retire(jobId: string): void {
  db.query(`UPDATE job SET state = 'failed', finished_at = ? WHERE id = ? AND state IN ('queued', 'running')`).run(Date.now(), jobId);
}

function pipeline(mode: "v1" | "v2" | undefined): void {
  if (mode) process.env.LECTERN_PIPELINE = mode;
  else delete process.env.LECTERN_PIPELINE;
  resetConfigForTests();
}

/** The enqueue checks for a server key; it is never sent anywhere in this file (no Gemini provider runs). */
async function withServerKey<T>(fn: () => T | Promise<T>): Promise<T> {
  process.env.GEMINI_API_KEY = "test-key-never-sent";
  try {
    return await fn();
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
}

function uploadPath(ext = "m4a"): string {
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  return join(DATA_DIR, "uploads", `${generateId("aud")}.${ext}`);
}

function pendingLecture(audioPath: string): LectureRecord {
  return createPendingLecture({
    id: generateId("lec"),
    ownerId: ensureBootstrapOwner().id,
    title: "",
    course: "정보보호",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: existsSync(audioPath) ? statSync(audioPath).size : 0,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
}

/**
 * A running `process` row nobody leases (no lease to expire), for a handler called directly.
 * Its payload is the upload path's: no title from the user (the lecture's is a placeholder).
 */
function directJob(lecture: LectureRecord): LeasedJob {
  const id = `job_${crypto.randomUUID()}`;
  const payload = { title: "", course: lecture.course };
  db.query(
    `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at)
     VALUES (?, ?, ?, ?, 'running', 0, ?, ?)`
  ).run(id, lecture.owner_id, PROCESS_JOB_KIND, lecture.id, JSON.stringify(payload), Date.now());
  directJobs.push(id);
  return { id, kind: PROCESS_JOB_KIND, subjectId: lecture.id, ownerId: lecture.owner_id, payload, attempts: 0, secret: () => undefined };
}

function scripted(
  script: ScriptLine[],
  options: {
    llm?: ScriptedLlmProvider;
    failChunks?: number[];
    onCall?: (provider: ScriptedTranscriptionProvider) => void;
    onStage?: (event: PipelineStageEvent) => void;
  } = {}
): ProcessJobDeps & { transcription: ScriptedTranscriptionProvider; llm: ScriptedLlmProvider } {
  const transcription: ScriptedTranscriptionProvider = new ScriptedTranscriptionProvider(
    script,
    { failChunks: options.failChunks },
    () => options.onCall?.(transcription)
  );
  return {
    transcription,
    llm: options.llm ?? new ScriptedLlmProvider(notesAnswer),
    harness: new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} }),
    pipeline: {
      concurrency: 1,
      chunk: { targetMs: 30_000, overlapMinMs: 3_000, overlapMaxMs: 6_000 },
      onStage: (event) => {
        transcription.observe(event);
        options.onStage?.(event);
      },
    },
  };
}

function jobsFor(lectureId: string, kind: string) {
  return db
    .query(`SELECT id, kind, state, attempts, budget_microusd, payload, result, error FROM job WHERE kind = ? AND subject_id = ?`)
    .all(kind, lectureId) as Array<{
    id: string;
    kind: string;
    state: string;
    attempts: number;
    budget_microusd: number | null;
    payload: string;
    result: string | null;
    error: string | null;
  }>;
}

function recordingOf(lectureId: string) {
  return db.query(`SELECT status, title, template_id, failure_code, failure_message FROM recording WHERE id = ?`).get(lectureRecordingId(lectureId)) as {
    status: string;
    title: string;
    template_id: string | null;
    failure_code: string | null;
    failure_message: string | null;
  };
}

const count = (sql: string, ...args: string[]) => (db.query(sql).get(...args) as { n: number }).n;
const segmentsOf = (lectureId: string) => count(`SELECT COUNT(*) AS n FROM transcript_segment WHERE recording_id = ?`, lectureRecordingId(lectureId));
const structuredDocsOf = (lectureId: string) =>
  count(`SELECT COUNT(*) AS n FROM document WHERE recording_id = ? AND template_id != 'legacy-markdown'`, lectureRecordingId(lectureId));
const hangul = /\p{Script=Hangul}/u;

/** mulberry32 Hangul sentences: distinct text per line. */
function sentences(seed: number, n: number): string[] {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const syllable = () => String.fromCodePoint(0xac00 + Math.floor(r() * 19 * 21) * 28 + (r() < 0.5 ? 0 : 1 + Math.floor(r() * 27)));
  const word = () => Array.from({ length: 1 + Math.floor(r() * 4) }, syllable).join("");
  return Array.from({ length: n }, () => Array.from({ length: 4 + Math.floor(r() * 4) }, word).join(" ") + ".");
}

async function talk(seed: number): Promise<{ audio: string; script: ScriptLine[] }> {
  const script: ScriptLine[] = sentences(seed, 18).map((text, i) => ({
    start_ms: i * 5 * S,
    end_ms: i * 5 * S + 4 * S,
    speaker: "S1",
    text,
  }));
  return { audio: await synthesizeSpeechTone(script, 92 * S, uploadPath()), script };
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await Bun.sleep(50);
  }
}

describe("LECTERN_PIPELINE queueing", () => {
  test("v1 enqueues distill", async () => {
    pipeline(undefined);
    const audio = uploadPath();
    writeFileSync(audio, "audio");
    const lecture = pendingLecture(audio);
    const queued = await withServerKey(() =>
      enqueueRecordingProcessing(lecture.id, lecture.owner_id, { audioPath: audio, course: lecture.course, title: "", model: "gemini-3.8-flash" })
    );
    retire(queued.jobId);
    expect(jobsFor(lecture.id, "distill").map((j) => j.id)).toEqual([queued.jobId]);
    expect(jobsFor(lecture.id, PROCESS_JOB_KIND)).toEqual([]);
  });

  test.skipIf(!isFfmpegAvailable())("v2 enqueues process with a budget", async () => {
    pipeline("v2");
    const audio = uploadPath();
    writeFileSync(audio, "audio");
    const lecture = pendingLecture(audio);
    const queued = await withServerKey(() =>
      enqueueRecordingProcessing(lecture.id, lecture.owner_id, { audioPath: audio, course: lecture.course, title: "제목", model: "gemini-3.8-flash" })
    );
    const [job] = jobsFor(lecture.id, PROCESS_JOB_KIND);
    retire(queued.jobId);
    expect(job).toMatchObject({ id: queued.jobId, kind: "process", state: "queued" });
    expect(job!.budget_microusd).toBeGreaterThanOrEqual(500_000);
    expect(JSON.parse(job!.payload)).toEqual({ title: "제목", course: lecture.course });
    expect(jobsFor(lecture.id, "distill")).toEqual([]);
  });

  test("v2 without server key falls back to distill", () => {
    pipeline("v2");
    const audio = uploadPath();
    writeFileSync(audio, "audio");
    const lecture = pendingLecture(audio);
    const queued = enqueueRecordingProcessing(lecture.id, lecture.owner_id, {
      audioPath: audio,
      course: lecture.course,
      title: "",
      model: "gemini-3.8-flash",
    });
    retire(queued.jobId);
    expect(jobsFor(lecture.id, "distill").map((j) => j.id)).toEqual([queued.jobId]);
    expect(jobsFor(lecture.id, PROCESS_JOB_KIND)).toEqual([]);
  });

  test("a job switched back to v1 after it was queued hands the lecture to distill", async () => {
    pipeline("v1");
    const audio = uploadPath();
    writeFileSync(audio, "audio");
    const lecture = pendingLecture(audio);
    const job = directJob(lecture);
    const outcome = await runProcessJob(job);
    expect(outcome).toMatchObject({ ok: true, result: { skipped: "pipeline_v1" } });
    expect(jobsFor(lecture.id, "distill")).toEqual([]); // not before the job's row is finished
    outcome.followUp!();
    const [distill] = jobsFor(lecture.id, "distill");
    retire(distill!.id);
    expect(JSON.parse(distill!.payload)).toEqual({ audioPath: audio, course: lecture.course, title: "", model: "gemini-3.8-flash" });
  });

  test("a job whose recording was deleted stops before any stage", async () => {
    pipeline("v2");
    const audio = uploadPath();
    writeFileSync(audio, "audio");
    const lecture = pendingLecture(audio);
    const job = directJob(lecture);
    deleteLectureById(lecture.id);
    const deps = scripted([]);
    expect(await runProcessJob(job, deps)).toEqual({ ok: false, error: PROCESS_SOURCE_GONE_MESSAGE });
    expect(deps.transcription.calls).toEqual([]);
  });

  test("the budget follows the recording length with a floor", () => {
    expect(processBudgetMicrousd(0)).toBe(500_000);
    expect(processBudgetMicrousd(95)).toBe(500_000);
    expect(processBudgetMicrousd(3600)).toBe(900_000);
    expect(processBudgetMicrousd(3 * 3600)).toBe(2_700_000);
  });
});

describe.skipIf(!isFfmpegAvailable())("process job end to end (scripted providers, synthetic audio)", () => {
  let ready: { lecture: LectureRecord; job: LeasedJob; script: ScriptLine[] } | null = null;
  let partial: LectureRecord | null = null;
  let untitledFailed: { lecture: LectureRecord; script: ScriptLine[] } | null = null;

  test("upload to ready", async () => {
    pipeline("v2");
    const { audio, script } = await talk(31);
    const lecture = pendingLecture(audio);
    const job = directJob(lecture);
    const deps = scripted(script);
    const outcome = await runProcessJob(job, deps);
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({ status: "ready", failed_chunks: [] });
    ready = { lecture, job, script };

    expect(recordingOf(lecture.id)).toMatchObject({ status: "ready", title: "블록 암호 운영 모드", template_id: "lecture", failure_code: null });
    expect(segmentsOf(lecture.id)).toBeGreaterThan(0);
    const docs = db
      .query(`SELECT template_id, current_version FROM document WHERE recording_id = ? AND template_id != 'legacy-markdown'`)
      .all(lectureRecordingId(lecture.id));
    expect(docs).toEqual([{ template_id: "lecture", current_version: 1 }]);
    const after = getLectureById(lecture.id)!;
    expect(after).toMatchObject({ status: "done", progress: 100, title: "블록 암호 운영 모드" });
    expect(after.markdown).toContain("## 핵심 요약");
    expect(after.duration_sec).toBe(92);

    const stages = new Set((db.query(`SELECT stage FROM stage_run WHERE job_id = ?`).all(job.id) as Array<{ stage: string }>).map((r) => r.stage));
    for (const stage of ["ingest", "normalize", "speech_map", "chunk", "transcribe", "merge", "speakers", "classify", "structure", "extract", "verify"]) {
      expect(stages.has(stage)).toBe(true);
    }
    // The published copies are the ones that stay: the job's own are gone.
    expect(count(`SELECT COUNT(*) AS n FROM artifact WHERE job_id = ?`, job.id)).toBe(0);
    // Searchable by its transcript and by the document's blocks (not the bridged Markdown).
    const sources = lectureSources(after);
    const docId = (db.query(`SELECT id FROM document WHERE recording_id = ? AND template_id = 'lecture'`).get(lectureRecordingId(lecture.id)) as { id: string })
      .id;
    expect(sources.document).toMatchObject({ kind: "blocks", documentId: docId, version: 1 });
    expect(sources.transcript?.segments.length).toBe(segmentsOf(lecture.id));
    const chunks = chunkRecording(sources);
    expect(chunks.some((c) => c.kind === "document" && c.documentId === docId && c.blockId !== null && c.text.includes("CBC는 IV가 필요하다"))).toBe(
      true
    );
    expect(chunks.some((c) => c.kind === "transcript")).toBe(true);
  }, 60_000);

  test("progress events carry real stage names", () => {
    expect(ready).not.toBeNull();
    const { lecture } = ready!;
    const rows = db.query(`SELECT * FROM job_event WHERE subject_id = ? AND type = 'progress' ORDER BY id`).all(lecture.id) as EventRow[];
    const stages = rows.map((r) => JSON.parse(r.payload).stage as string);
    expect(stages).toContain("transcribe");
    expect(stages).toContain("structure");
    expect(new Set(stages).size).toBe(stages.length); // a stage is announced once, not per chunk

    const workspaceId = personalWorkspaceId(lecture.owner_id);
    const caller = { userId: lecture.owner_id, role: "owner" as const };
    const sent = rows.flatMap((row) => translate(row, workspaceId, caller)).filter((m) => m.type === "job.progress");
    expect(sent.map((m) => (m.data as any).payload.stage)).toEqual(stages);
  });

  test("notes failure is partial", async () => {
    pipeline("v2");
    const { audio, script } = await talk(32);
    const lecture = pendingLecture(audio);
    const job = directJob(lecture);
    const down = new ScriptedLlmProvider(() => new HarnessError("transient", "scripted 503", { code: "http_503" }));
    const outcome = await runProcessJob(job, scripted(script, { llm: down }));
    expect(outcome).toMatchObject({ ok: true, result: { status: "partial" } });
    expect(recordingOf(lecture.id)).toMatchObject({ status: "partial", failure_code: "notes_failed", failure_message: expect.stringMatching(hangul) });
    expect(segmentsOf(lecture.id)).toBeGreaterThan(0);
    expect(structuredDocsOf(lecture.id)).toBe(0);
    expect(getLectureById(lecture.id)).toMatchObject({ status: "done", markdown: "", excerpt: expect.stringContaining("전사") });
    partial = lecture;
  }, 60_000);

  test("partial survives later projection", () => {
    expect(partial).not.toBeNull();
    db.query(`UPDATE lectures SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), partial!.id);
    syncPendingLectures();
    expect(recordingOf(partial!.id)).toMatchObject({ status: "partial", failure_code: "notes_failed" });
  });

  test("total transcription failure", async () => {
    pipeline("v2");
    const { audio, script } = await talk(33);
    const lecture = pendingLecture(audio);
    const job = directJob(lecture);
    const deps = scripted(script, { failChunks: [0, 1, 2, 3, 4, 5, 6, 7] });
    const outcome = await runProcessJob(job, deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(hangul);
    expect(recordingOf(lecture.id)).toMatchObject({ status: "failed" });
    expect(segmentsOf(lecture.id)).toBe(0);
    expect(deps.llm.calls).toEqual([]);
    untitledFailed = { lecture, script };
  }, 60_000);

  test("a retried untitled recording takes the classified title; a reprocessed one keeps its title", async () => {
    pipeline("v2");
    // Failed before any notes: its title is the placeholder, so the classified one replaces it.
    expect(untitledFailed).not.toBeNull();
    const failed = untitledFailed!.lecture;
    expect(getLectureById(failed.id)!.title).toBe(failed.title); // the placeholder
    expect(await runProcessJob(directJob(failed), scripted(untitledFailed!.script))).toMatchObject({ ok: true, result: { status: "ready" } });
    expect(getLectureById(failed.id)!.title).toBe("블록 암호 운영 모드");

    // Has notes, and the user renamed it: a reprocess writes version 2 under the user's title.
    expect(ready).not.toBeNull();
    const { lecture, script } = ready!;
    db.query(`UPDATE lectures SET title = ? WHERE id = ?`).run("내가 고친 제목", lecture.id);
    syncPendingLectures();
    expect(await runProcessJob(directJob(lecture), scripted(script))).toMatchObject({ ok: true, result: { status: "ready" } });
    expect(recordingOf(lecture.id)).toMatchObject({ status: "ready", title: "내가 고친 제목" });
    expect(getLectureById(lecture.id)!.title).toBe("내가 고친 제목");
    const docs = db
      .query(`SELECT current_version FROM document WHERE recording_id = ? AND template_id != 'legacy-markdown'`)
      .all(lectureRecordingId(lecture.id));
    expect(docs).toEqual([{ current_version: 2 }]);
  }, 60_000);

  test("budget stop is partial, not stuck", async () => {
    // Scripted providers cost nothing, so the budget is spent by hand: the runner stops
    // before the next paid stage once spent_microusd reaches budget_microusd.
    pipeline("v2");
    const spend = (jobId: string) => db.query(`UPDATE job SET budget_microusd = 1, spent_microusd = 1 WHERE id = ?`).run(jobId);

    // Spent before the transcript: nothing to publish, the recording fails.
    const early = await talk(34);
    const first = pendingLecture(early.audio);
    const firstJob = directJob(first);
    spend(firstJob.id);
    const failed = await runProcessJob(firstJob, scripted(early.script));
    expect(failed).toMatchObject({ ok: false, error: expect.stringMatching(hangul) });
    expect(recordingOf(first.id).status).toBe("failed");

    // Spent once the transcript is in: the transcript stays, the notes stop, the recording is partial.
    const late = await talk(37);
    const second = pendingLecture(late.audio);
    const secondJob = directJob(second);
    const deps = scripted(late.script, { onStage: (ev) => ev.stage === "speakers" && spend(secondJob.id) });
    expect(await runProcessJob(secondJob, deps)).toMatchObject({ ok: true, result: { status: "partial" } });
    expect(recordingOf(second.id)).toMatchObject({ status: "partial", failure_code: "budget_exceeded" });
    expect(segmentsOf(second.id)).toBeGreaterThan(0);
    expect(deps.llm.calls).toEqual([]);

    for (const lecture of [first, second]) expect(getLectureById(lecture.id)!.status).not.toBe("processing");
  }, 60_000);

  test("deleted recording cancels", async () => {
    pipeline("v2");
    const { audio, script } = await talk(35);
    const lecture = pendingLecture(audio);
    const job = directJob(lecture);
    const deps = scripted(script, {
      onCall: (provider) => {
        if (provider.calls.length === 1) deleteLectureById(lecture.id);
      },
    });
    expect(await runProcessJob(job, deps)).toEqual({ ok: false, error: PROCESS_SOURCE_GONE_MESSAGE });
    expect(deps.transcription.calls).toEqual([0]); // no chunk after the deletion
    expect(deps.llm.calls).toEqual([]);
    expect(count(`SELECT COUNT(*) AS n FROM artifact WHERE job_id = ?`, job.id)).toBe(0);
  }, 60_000);

  test(
    "SIGKILL then resume",
    async () => {
      pipeline("v2");
      const { audio, script } = await talk(36);
      const lecture = pendingLecture(audio);
      await withServerKey(() =>
        enqueueRecordingProcessing(lecture.id, lecture.owner_id, { audioPath: audio, course: lecture.course, title: "", model: "gemini-3.8-flash" })
      );
      const [queued] = jobsFor(lecture.id, PROCESS_JOB_KIND);
      expect(queued).toMatchObject({ state: "queued", attempts: 0 });

      const dir = join(process.env.LECTERN_TEST_SANDBOX!, `process-${lecture.id}`);
      mkdirSync(dir, { recursive: true });
      const scriptJson = join(dir, "script.json");
      const calls = join(dir, "calls");
      writeFileSync(scriptJson, JSON.stringify(script));
      const callCount = () => (existsSync(calls) ? readFileSync(calls, "utf8").length : 0);
      const worker = (crashAt: number) =>
        Bun.spawn(["bun", join(import.meta.dir, "fixtures/process-worker.ts")], {
          cwd: REPO,
          env: {
            ...process.env,
            LECTERN_WORKER_MODE: "external",
            LECTERN_PIPELINE: "v2",
            LECTERN_JOB_LEASE_TTL_MS: "1500",
            LECTERN_JOB_POLL_MS: "100",
            LECTERN_SHUTDOWN_GRACE_SEC: "2",
            LECTERN_TEST_SCRIPT: scriptJson,
            LECTERN_TEST_CALLS: calls,
            LECTERN_TEST_CRASH_AT: String(crashAt),
          },
          stdout: "ignore",
          stderr: "pipe",
        });

      // SIGKILL at the second transcription call: no cleanup runs, the lease stays behind.
      const first = worker(2);
      await first.exited;
      expect(first.signalCode).toBe("SIGKILL");
      expect(callCount()).toBe(2);
      expect(jobsFor(lecture.id, PROCESS_JOB_KIND)[0]!.state).toBe("running");

      const second = worker(0);
      try {
        const unfinished = new Set(["queued", "running"]);
        await waitFor(() => !unfinished.has(jobsFor(lecture.id, PROCESS_JOB_KIND)[0]!.state), 60_000);
        const [done] = jobsFor(lecture.id, PROCESS_JOB_KIND);
        expect(done!.state).toBe("succeeded");
        expect(done!.attempts).toBe(1); // one interruption: the SIGKILL
        const result = JSON.parse(done!.result!) as Record<string, any>;
        expect(result).toMatchObject({ status: "ready", failed_chunks: [] });
        expect(result.chunks).toBeGreaterThanOrEqual(3);
        expect(result.resumed_stages).toBe(5); // ingest, normalize, speech_map, chunk, chunk 0
        // One extra transcription call in total: the interrupted chunk, again.
        expect(callCount()).toBe(result.chunks + 1);
        expect(recordingOf(lecture.id)).toMatchObject({ status: "ready", template_id: "lecture" });
        expect(getLectureById(lecture.id)!.markdown).toContain("## 핵심 요약");
      } finally {
        second.kill("SIGTERM");
        expect(await second.exited).toBe(0);
      }
    },
    120_000
  );
});

describe("completeUpload queues by flag", () => {
  const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

  async function api(method: string, path: string, user: UserRecord, init: { body?: unknown; raw?: Uint8Array } = {}) {
    const headers: Record<string, string> = { "X-Lectern-Token": user.api_token };
    let body: BodyInit | undefined = init.raw ? new Blob([init.raw as Uint8Array<ArrayBuffer>]) : undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body }));
    return { status: res.status, body: (await res.json()) as any };
  }

  async function upload(user: UserRecord, seed: number): Promise<string> {
    const audio = new Uint8Array(1000).map((_, i) => (i * seed) % 251);
    const created = await api("POST", "/uploads", user, {
      body: {
        workspace_id: personalWorkspaceId(user.id),
        files: [{ kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes: audio.length, sha256: sha256(audio) }],
      },
    });
    expect(created.status).toBe(201);
    expect((await api("PUT", `/uploads/${created.body.id}/parts/1`, user, { raw: audio })).status).toBe(200);
    const done = await api("POST", `/uploads/${created.body.id}/complete`, user);
    expect(done.status).toBe(200);
    expect(done.body.job).toMatchObject({ kind: "process", state: "queued" }); // v2 names both kinds `process`
    retire(done.body.job.id);
    return (db.query(`SELECT kind FROM job WHERE id = ?`).get(done.body.job.id) as { kind: string }).kind;
  }

  test.skipIf(!isFfmpegAvailable())("v2 queues process, v1 queues distill", async () => {
    const user = createUser({ email: `${generateId("up")}@example.com`, displayName: "업로더", password: "correct_password_1" });
    pipeline("v2");
    expect(await withServerKey(() => upload(user, 3))).toBe("process");
    pipeline(undefined);
    expect(await withServerKey(() => upload(user, 7))).toBe("distill");
  });
});
