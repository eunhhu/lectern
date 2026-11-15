import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import type { DistillationResult, DistillOptions } from "@lectern/core";
import {
  BlobStore,
  geminiLegacyDistillProvider,
  Harness,
  ScriptedTranscriptionProvider,
  synthesizeSpeechTone,
  type ScriptLine,
  type Transcript,
} from "@lectern/harness";
import { isFfmpegAvailable } from "@lectern/media";
import { personalWorkspaceId } from "../src/ask/workspace.ts";
import {
  createPendingLecture,
  DATA_DIR,
  db,
  deleteLectureById,
  ensureBootstrapOwner,
  generateId,
  getLectureById,
  getSystemSettings,
  HARNESS_BLOB_DIR,
  type LectureRecord,
  updateSystemSettings,
} from "../src/db.ts";
import { runDistillationOnHarness } from "../src/job-handlers.ts";
import { embeddedWorker, type JobWorker, type LeasedJob } from "../src/queue.ts";
import {
  enqueueTranscriptAfterDistill,
  runTranscriptJob,
  TRANSCRIBE_JOB_KIND,
  TRANSCRIPT_SOURCE_GONE_MESSAGE,
  transcriptBudgetMicrousd,
} from "../src/transcript-job.ts";

const REPO = join(import.meta.dir, "../../..");
const S = 1000;

// This file runs transcribe jobs itself, in process or in a spawned lectern-worker. The
// embedded worker (shared by every test file in this process) must not lease them, and with
// LECTERN_WORKER_MODE=external no new one starts.
const originalSettings = getSystemSettings();
let paused: JobWorker | null = null;
beforeAll(async () => {
  process.env.LECTERN_WORKER_MODE = "external";
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
  updateSystemSettings({ storage_auto_compact: false });
});
afterAll(() => {
  updateSystemSettings(originalSettings);
  for (const name of ["LECTERN_WORKER_MODE", "LECTERN_TRANSCRIPT_ENGINE", "GEMINI_API_KEY"]) delete process.env[name];
  resetConfigForTests();
  paused?.start();
});

function engine(mode: "off" | "shadow" | "on" | undefined): void {
  if (mode) process.env.LECTERN_TRANSCRIPT_ENGINE = mode;
  else delete process.env.LECTERN_TRANSCRIPT_ENGINE;
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
  const id = generateId("lec");
  return createPendingLecture({
    id,
    ownerId: ensureBootstrapOwner().id,
    title: "",
    course: "정보보호",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: existsSync(audioPath) ? statSync(audioPath).size : 0,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test", // keeps completeLectureRecord out of the lecture archive
  });
}

/** A job row nobody leases (kind not registered, already running), for a handler called directly. */
function directJob(lectureId: string, kind = "transcribe-direct-test"): LeasedJob {
  const ownerId = ensureBootstrapOwner().id;
  const id = `job_${crypto.randomUUID()}`;
  db.query(
    `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at)
     VALUES (?, ?, ?, ?, 'running', 0, '{}', 0)`
  ).run(id, ownerId, kind, lectureId);
  return { id, kind: TRANSCRIBE_JOB_KIND, subjectId: lectureId, ownerId, payload: {}, attempts: 0, secret: () => undefined };
}

function recorded(opts: DistillOptions): DistillationResult {
  return {
    markdown: `# 📚 ${opts.courseName} 강의 노트\n\n- [00:01] 블록 암호 운영 모드를 설명했습니다. 충분히 긴 문장입니다.`,
    title: `${opts.courseName} 강의 노트`,
    courseName: opts.courseName!,
    excerpt: "블록 암호 운영 모드를 설명했습니다.",
    modelRequested: opts.model!,
    modelUsed: "gemini-3.8-flash-001",
    durationSec: 95,
    sizeBytes: 16,
    usage: { promptTokenCount: 3100, candidatesTokenCount: 900 },
    requestId: "resp-test",
    generateMs: 1500,
  };
}

/** A lecture distilled by the harness distill handler on a recorded answer (never Gemini). */
async function distill(audioPath: string, opts: { userKey?: string } = {}): Promise<LectureRecord> {
  const lecture = pendingLecture(audioPath);
  const job = directJob(lecture.id, "distill-direct-test");
  const outcome = await runDistillationOnHarness(
    {
      ...job,
      kind: "distill",
      payload: { audioPath, course: lecture.course, title: "", model: "gemini-3.8-flash" },
      secret: () => opts.userKey,
    },
    {
      provider: geminiLegacyDistillProvider(async (o) => recorded(o)),
      harness: new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} }),
    }
  );
  expect(outcome).toEqual({ ok: true });
  return getLectureById(lecture.id)!;
}

function jobsFor(lectureId: string, kind: string) {
  return db
    .query(`SELECT id, state, attempts, budget_microusd, result, finished_at, created_at FROM job WHERE kind = ? AND subject_id = ?`)
    .all(kind, lectureId) as Array<{
    id: string;
    state: string;
    attempts: number;
    budget_microusd: number | null;
    result: string | null;
    finished_at: number | null;
    created_at: number;
  }>;
}

function stageRuns(jobId: string) {
  return db
    .query(`SELECT stage, chunk_index, state, attempts FROM stage_run WHERE job_id = ? ORDER BY started_at, chunk_index`)
    .all(jobId) as Array<{ stage: string; chunk_index: number | null; state: string; attempts: number }>;
}

/** mulberry32 Hangul sentences: distinct text, so the overlap alignment has one right answer. */
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

const letters = (texts: readonly string[]) => texts.join("").replace(/[^\p{L}\p{N}]/gu, "");

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await Bun.sleep(50);
  }
}

describe("LECTERN_TRANSCRIPT_ENGINE wiring", () => {
  test("off by default: a distillation on the server key queues no transcribe job", async () => {
    engine(undefined);
    const audio = uploadPath();
    writeFileSync(audio, "audio");
    const lecture = await withServerKey(() => distill(audio));
    expect(lecture.status).toBe("done");
    expect(jobsFor(lecture.id, TRANSCRIBE_JOB_KIND)).toEqual([]);
  });

  test("shadow spends only the server key, only for accounts allowed to use it", async () => {
    engine("shadow");
    const audio = uploadPath();
    writeFileSync(audio, "audio");

    // The distillation ran on a key the user supplied: neither their key nor ours.
    const lecture = await withServerKey(() => distill(audio, { userKey: "AIza-user-key" }));
    expect(jobsFor(lecture.id, TRANSCRIBE_JOB_KIND)).toEqual([]);

    // No server key configured.
    expect(enqueueTranscriptAfterDistill(lecture, { userKey: false })).toBeNull();

    // An account the operator keeps off the server key.
    const ownerId = lecture.owner_id;
    db.query(`UPDATE users SET can_use_server_key = 0 WHERE id = ?`).run(ownerId);
    try {
      expect(await withServerKey(() => enqueueTranscriptAfterDistill(lecture, { userKey: false }))).toBeNull();
    } finally {
      db.query(`UPDATE users SET can_use_server_key = 1 WHERE id = ?`).run(ownerId);
    }

    // The audio is gone.
    unlinkSync(audio);
    expect(await withServerKey(() => enqueueTranscriptAfterDistill(lecture, { userKey: false }))).toBeNull();
    expect(jobsFor(lecture.id, TRANSCRIBE_JOB_KIND)).toEqual([]);
  });

  test("a job switched off after it was queued does nothing", async () => {
    engine("off");
    const audio = uploadPath();
    writeFileSync(audio, "audio");
    const job = directJob(pendingLecture(audio).id);
    expect(await runTranscriptJob(job)).toEqual({ ok: true, result: { skipped: "engine_off" } });
    expect(stageRuns(job.id)).toEqual([]);
  });

  test("a job whose recording was deleted stops before any stage", async () => {
    engine("shadow");
    const audio = uploadPath();
    writeFileSync(audio, "audio");
    const lecture = pendingLecture(audio);
    const job = directJob(lecture.id);
    deleteLectureById(lecture.id);
    const provider = new ScriptedTranscriptionProvider([]);
    expect(await runTranscriptJob(job, { provider })).toEqual({ ok: false, error: TRANSCRIPT_SOURCE_GONE_MESSAGE });
    expect(provider.calls).toEqual([]);
    expect(stageRuns(job.id)).toEqual([]);
  });

  test("the budget follows the recording length with a floor", () => {
    expect(transcriptBudgetMicrousd(0)).toBe(300_000);
    expect(transcriptBudgetMicrousd(95)).toBe(300_000);
    expect(transcriptBudgetMicrousd(3600)).toBe(600_000);
    expect(transcriptBudgetMicrousd(3 * 3600)).toBe(1_800_000);
  });
});

describe.skipIf(!isFfmpegAvailable())("transcribe job end to end (scripted provider, synthetic audio)", () => {
  async function talk(seed: number): Promise<{ audio: string; script: ScriptLine[] }> {
    const script: ScriptLine[] = sentences(seed, 18).map((text, i) => ({
      start_ms: i * 5 * S,
      end_ms: i * 5 * S + 4 * S,
      speaker: "S1",
      text,
    }));
    return { audio: await synthesizeSpeechTone(script, 92 * S, uploadPath()), script };
  }

  test(
    "flag on: a distillation queues it; a worker killed mid-transcription is reclaimed and the rerun resumes",
    async () => {
      engine("on");
      updateSystemSettings({ storage_auto_compact: true });
      try {
        const { audio, script } = await talk(21);
        const lecture = await withServerKey(() => distill(audio));
        const lastEvent = (db.query(`SELECT MAX(id) AS id FROM job_event`).get() as { id: number }).id;

        // Queued instead of the compaction, which would replace the audio under it.
        const [queued] = jobsFor(lecture.id, TRANSCRIBE_JOB_KIND);
        expect(queued).toMatchObject({ state: "queued", attempts: 0, budget_microusd: transcriptBudgetMicrousd(95) });
        expect(jobsFor(lecture.id, "compact")).toEqual([]);

        const dir = join(process.env.LECTERN_TEST_SANDBOX!, `transcript-${lecture.id}`);
        mkdirSync(dir, { recursive: true });
        const scriptJson = join(dir, "script.json");
        const calls = join(dir, "calls");
        writeFileSync(scriptJson, JSON.stringify(script));
        const callCount = () => (existsSync(calls) ? readFileSync(calls, "utf8").length : 0);
        const worker = (crashAt: number) =>
          Bun.spawn(["bun", join(import.meta.dir, "fixtures/transcript-worker.ts")], {
            cwd: REPO,
            env: {
              ...process.env,
              LECTERN_WORKER_MODE: "external",
              LECTERN_TRANSCRIPT_ENGINE: "on",
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

        // SIGKILL at the second provider call: no cleanup runs, the lease stays behind.
        const first = worker(2);
        await first.exited;
        expect(first.signalCode).toBe("SIGKILL");
        expect(callCount()).toBe(2);
        expect(jobsFor(lecture.id, TRANSCRIBE_JOB_KIND)[0]!.state).toBe("running");
        expect(stageRuns(queued!.id).map(({ stage, chunk_index, state }) => ({ stage, chunk_index, state }))).toEqual([
          { stage: "ingest", chunk_index: null, state: "succeeded" },
          { stage: "normalize", chunk_index: null, state: "succeeded" },
          { stage: "speech_map", chunk_index: null, state: "succeeded" },
          { stage: "chunk", chunk_index: null, state: "succeeded" },
          { stage: "transcribe", chunk_index: 0, state: "succeeded" },
          { stage: "transcribe", chunk_index: 1, state: "running" },
        ]);

        // The next worker reclaims the expired lease and runs the same job id again.
        const second = worker(0);
        try {
          const unfinished = new Set(["queued", "running"]);
          await waitFor(() => !unfinished.has(jobsFor(lecture.id, TRANSCRIBE_JOB_KIND)[0]!.state), 60_000);
          const [done] = jobsFor(lecture.id, TRANSCRIBE_JOB_KIND);
          expect(done!.state).toBe("succeeded");
          expect(done!.attempts).toBe(1); // one interruption: the SIGKILL
          const result = JSON.parse(done!.result!) as Record<string, any>;
          expect(result).toMatchObject({ mode: "on", published: true, failed_chunks: [], gaps: expect.any(Number) });
          expect(result.chunks).toBeGreaterThanOrEqual(3);
          expect(result.segments).toBeGreaterThan(0);
          expect(result.speakers).toBe(1);
          // ingest, normalize, speech_map, chunk and chunk 0 came back from the first run.
          expect(result.resumed_stages).toBe(5);

          // One extra provider call in total: the interrupted chunk, again. Nothing else reran.
          expect(callCount()).toBe(result.chunks + 1);
          const runs = stageRuns(done!.id);
          expect(runs.filter((r) => r.stage !== "transcribe").map((r) => [r.stage, r.attempts])).toEqual([
            ["ingest", 1],
            ["normalize", 1],
            ["speech_map", 1],
            ["chunk", 1],
            ["merge", 1],
            ["speakers", 1],
          ]);
          expect(runs.filter((r) => r.stage === "transcribe" && r.chunk_index! < 2).map((r) => r.attempts)).toEqual([1, 2]);

          // Stored, not shown: the transcript is the speakers artifact, every word once.
          const artifact = db.query(`SELECT sha256 FROM artifact WHERE id = ? AND job_id = ?`).get(result.transcript_artifact, done!.id) as {
            sha256: string;
          };
          const transcript = JSON.parse(new BlobStore(HARNESS_BLOB_DIR).readText(artifact.sha256)) as Transcript;
          expect(transcript.segments.length).toBe(result.segments);
          expect(transcript.segments.every((s, i) => s.idx === i && s.end_ms <= 92 * S)).toBe(true);
          expect(letters(transcript.segments.map((s) => s.text))).toBe(letters(script.map((l) => l.text)));
          expect(JSON.stringify(result)).not.toContain(transcript.segments[0]!.text);

          // Costs are in the ledger under the owner's workspace; the killed call was never billed.
          const ledger = db.query(`SELECT workspace_id FROM ai_call WHERE job_id = ?`).all(done!.id) as Array<{ workspace_id: string }>;
          expect(ledger.length).toBe(result.chunks);
          expect(new Set(ledger.map((r) => r.workspace_id))).toEqual(new Set([personalWorkspaceId(lecture.owner_id)]));

          // The lecture and its events are untouched.
          const after = getLectureById(lecture.id)!;
          for (const field of ["status", "stage", "stage_message", "progress", "markdown", "title", "error_message"] as const) {
            expect(after[field]).toEqual(lecture[field]);
          }
          const events = db.query(`SELECT type FROM job_event WHERE subject_id = ? AND id > ?`).all(lecture.id, lastEvent) as Array<{
            type: string;
          }>;
          expect(events.filter((e) => e.type !== "updated")).toEqual([]); // "updated" only from a compaction

          // The compaction it held back is queued once the job's row is finished.
          await waitFor(() => jobsFor(lecture.id, "compact").length === 1, 10_000);
          expect(jobsFor(lecture.id, "compact")[0]!.created_at).toBeGreaterThanOrEqual(done!.finished_at!);
        } finally {
          second.kill("SIGTERM");
          expect(await second.exited).toBe(0);
        }
      } finally {
        updateSystemSettings({ storage_auto_compact: false });
      }
    },
    120_000
  );

  test("deleting the recording mid-run cancels the job and drops what it stored", async () => {
    engine("shadow");
    const { audio, script } = await talk(5);
    const lecture = pendingLecture(audio);
    const job = directJob(lecture.id);
    const provider = new ScriptedTranscriptionProvider(script, {}, () => {
      if (provider.calls.length === 1) deleteLectureById(lecture.id);
    });
    const outcome = await runTranscriptJob(job, {
      provider,
      harness: new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} }),
      pipeline: { concurrency: 1, chunk: { targetMs: 30_000, overlapMinMs: 3_000, overlapMaxMs: 6_000 }, onStage: provider.observe },
    });
    expect(outcome).toEqual({ ok: false, error: TRANSCRIPT_SOURCE_GONE_MESSAGE });
    expect(provider.calls).toEqual([0]); // no chunk after the deletion
    expect(db.query(`SELECT COUNT(*) AS n FROM artifact WHERE job_id = ?`).get(job.id)).toEqual({ n: 0 });
  }, 60_000);
});
