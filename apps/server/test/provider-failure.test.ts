import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
// Provider outage rehearsal (P7-02, CONTRACTS D-P7-3): when Gemini keeps answering 5xx,
// 429 or never answers, a `process` job still ends — the recording never stays
// "processing". The real Gemini adapters run on a fake fetch that answers by script at the
// network boundary; any URL other than Gemini's throws, so nothing leaves the machine.
//
// Jobs run through a JobWorker of this file's own with registerProcessJobHandler(deps), so
// the job row's final state is the queue's, not a hand-written one. The harness sleeps for
// 0 ms between retries (the attempts themselves are unchanged).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { lectureRecordingId } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { GeminiLlmProvider, GeminiTranscriptionProvider, Harness, synthesizeSpeechTone, type ScriptLine } from "@lectern/harness";
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
  updateSystemSettings,
  type LectureRecord,
  type UserRecord,
} from "../src/db.ts";
import { handleRequest } from "../src/index.ts";
import { registerProcessJobHandler } from "../src/job-handlers.ts";
import { PROCESS_JOB_KIND } from "../src/process-job.ts";
import { embeddedWorker, enqueueJob, JobWorker } from "../src/queue.ts";

const S = 1000;
const GEMINI = "https://generativelanguage.googleapis.com/";
/** Per-call deadline of the adapters here: a `hang` is cut after this. */
const TIMEOUT_MS = 300;
/** transcribeStage's retry policy (packages/harness/src/transcript/stages.ts). */
const TRANSCRIBE_MAX_ATTEMPTS = 4;

type Fault = "5xx" | "429" | "hang" | "ok";
type Plan = { transcribe: Fault; llm: Fault };
type Calls = { transcribe: number; llm: number; outbound: number };

// --- the fake Gemini --------------------------------------------------------------------
// The `ok` answers are copied from apps/web/e2e/server/start.ts (the e2e server's fake).

/** What the fake "hears" in any chunk (clip-relative MM:SS). */
const FAKE_TRANSCRIPT = [
  { start: "00:00", end: "00:04", text: "오늘은 블록 암호의 운영 모드를 살펴봅니다." },
  { start: "00:04", end: "00:08", text: "ECB 모드는 같은 평문 블록을 같은 암호문으로 바꿉니다." },
  { start: "00:08", end: "00:12", text: "그래서 실제로는 CBC 모드처럼 이전 블록을 섞는 방식을 씁니다." },
];

function geminiJson(value: unknown, usage = { promptTokenCount: 900, candidatesTokenCount: 120, totalTokenCount: 1020 }): Response {
  return Response.json({
    candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }],
    usageMetadata: usage,
    modelVersion: "gemini-3.8-flash",
    responseId: "e2e-fake",
  });
}

const provenance = { sources: ["#0-#1"], pdf_pages: [] as number[] };

/** Notes-stage answers, told apart by the top-level properties of the request's responseSchema. */
function notesAnswer(properties: string[]): unknown {
  if (properties.includes("domain")) {
    return {
      domain: "lecture",
      language: "ko",
      title: "블록 암호 운영 모드 강의",
      participants: [],
      folder_suggestion: { folder_id: null, new_name: null },
      tags: [],
      confidence: 0.9,
    };
  }
  if (properties.includes("sections")) {
    return {
      sections: [
        { key: "summary", blocks: [{ type: "paragraph", heading: null, text: "ECB 모드의 한계와 CBC 모드가 쓰이는 이유를 다뤘다.", ...provenance }] },
        { key: "topics", blocks: [{ type: "paragraph", heading: "운영 모드", text: "ECB는 같은 평문 블록을 같은 암호문으로 바꾸고, CBC는 이전 블록을 섞는다.", ...provenance }] },
      ],
    };
  }
  if (["events", "action_items", "decisions", "glossary"].some((p) => properties.includes(p))) {
    return Object.fromEntries(properties.map((p) => [p, []]));
  }
  if (properties.includes("fixes")) return { fixes: [] };
  return null;
}

function answerOk(body: any, transcribe: boolean): Response {
  if (transcribe) {
    const segments = FAKE_TRANSCRIPT.map((s) => ({ ...s, speaker: "S1" }));
    return geminiJson({ language: "ko", segments }, { promptTokenCount: 700, candidatesTokenCount: 90, totalTokenCount: 790 });
  }
  const answer = notesAnswer(Object.keys(body.generationConfig?.responseSchema?.properties ?? {}));
  if (answer !== null) return geminiJson(answer);
  return Response.json({ error: { code: 400, message: "not faked" } }, { status: 400 });
}

/** A fetch that answers Gemini URLs by script; any other URL throws (nothing leaves the machine). */
function faultyFetch(plan: Plan): { fetch: typeof fetch; calls: Calls; plan: Plan } {
  const calls: Calls = { transcribe: 0, llm: 0, outbound: 0 };
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(GEMINI)) {
      calls.outbound++;
      throw new Error(`provider-failure test: outbound request refused (${new URL(url).hostname})`);
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    const transcribe = ((body.contents?.[0]?.parts ?? []) as Array<{ inlineData?: unknown }>).some((p) => p.inlineData);
    const kind = transcribe ? "transcribe" : "llm";
    calls[kind]++;
    switch (plan[kind]) {
      case "5xx":
        return Response.json({ error: { code: 503, message: "unavailable", status: "UNAVAILABLE" } }, { status: 503 });
      case "429":
        return Response.json({ error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
      case "hang": {
        // Settles only when the request's signal aborts (the adapter's deadline), with the
        // signal's own reason: a TimeoutError, which the harness classifies as transient.
        const signal = init?.signal;
        return new Promise<Response>((_, reject) => {
          if (!signal) return; // never: the adapters always pass a deadline signal
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      case "ok":
        return answerOk(body, transcribe);
    }
  }) as typeof fetch;
  return { fetch: fake, calls, plan };
}

// --- set-up -----------------------------------------------------------------------------

const originalSettings = getSystemSettings();
let paused: JobWorker | null = null;
const admin = ensureBootstrapOwner();

beforeAll(async () => {
  process.env.LECTERN_WORKER_MODE = "external";
  process.env.LECTERN_PIPELINE = "v2";
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
  updateSystemSettings({ storage_auto_compact: false });
});

afterAll(() => {
  // Back to the Gemini handler the module registered (no key in the sandbox: never called).
  registerProcessJobHandler();
  updateSystemSettings(originalSettings);
  for (const name of ["LECTERN_WORKER_MODE", "LECTERN_PIPELINE"]) delete process.env[name];
  resetConfigForTests();
  paused?.start();
});

/** Each test gets its own workspace: transcribe answers are memoized per workspace and chunk audio. */
function freshUser(): UserRecord {
  return createUser({ email: `${generateId("outage")}@example.com`, displayName: "장애 리허설", password: "correct_password_1" });
}

/** Same shape as process-job.test.ts's `talk`: 92 s, a 4 s tone every 5 s. */
async function recording(owner: UserRecord): Promise<LectureRecord> {
  const script: ScriptLine[] = Array.from({ length: 18 }, (_, i) => ({
    start_ms: i * 5 * S,
    end_ms: i * 5 * S + 4 * S,
    speaker: "S1",
    text: `문장 ${i}`,
  }));
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  const audioPath = await synthesizeSpeechTone(script, 92 * S, join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`));
  return createPendingLecture({
    id: generateId("lec"),
    ownerId: owner.id,
    title: "",
    course: "정보보호",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: Bun.file(audioPath).size,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
}

/** The real adapters on `fake`, the harness without retry sleeps, small chunks. */
function useProviders(fake: { fetch: typeof fetch }): void {
  const options = { apiKey: () => "test-key", fetch: fake.fetch, timeoutMs: TIMEOUT_MS };
  registerProcessJobHandler({
    transcription: new GeminiTranscriptionProvider(options),
    llm: new GeminiLlmProvider(options),
    harness: new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} }),
    pipeline: { concurrency: 1, chunk: { targetMs: 30_000, overlapMinMs: 3_000, overlapMaxMs: 6_000 } },
  });
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await Bun.sleep(25);
  }
}

const jobRow = (id: string) => db.query(`SELECT state, error, result FROM job WHERE id = ?`).get(id) as { state: string; error: string | null; result: string | null };

/** Runs the queue with a worker of this file's own until `jobId` is finished; returns the elapsed ms. */
async function runQueued(jobId: string): Promise<number> {
  const started = Date.now();
  const worker = new JobWorker({ pollMs: 25 });
  worker.start();
  try {
    await waitFor(() => !["queued", "running"].includes(jobRow(jobId).state), 55_000);
  } finally {
    await worker.drain(10_000);
  }
  return Date.now() - started;
}

async function processWith(plan: Plan) {
  const fake = faultyFetch(plan);
  useProviders(fake);
  const lecture = await recording(freshUser());
  const jobId = enqueueJob({ kind: PROCESS_JOB_KIND, ownerId: lecture.owner_id, subjectId: lecture.id, payload: { title: "", course: lecture.course } }).jobId;
  const ms = await runQueued(jobId);
  return { fake, lecture, jobId, ms };
}

function recordingOf(lectureId: string) {
  return db.query(`SELECT status, failure_code, failure_message FROM recording WHERE id = ?`).get(lectureRecordingId(lectureId)) as {
    status: string;
    failure_code: string | null;
    failure_message: string | null;
  };
}

const count = (sql: string, ...args: string[]) => (db.query(sql).get(...args) as { n: number }).n;
const segmentsOf = (lectureId: string) => count(`SELECT COUNT(*) AS n FROM transcript_segment WHERE recording_id = ?`, lectureRecordingId(lectureId));
const openJobsOf = (lectureId: string) => count(`SELECT COUNT(*) AS n FROM job WHERE subject_id = ? AND state IN ('queued', 'running')`, lectureId);
const hangul = /\p{Script=Hangul}/u;

function expectFailedTranscript(run: Awaited<ReturnType<typeof processWith>>): void {
  expect(run.ms).toBeLessThan(60_000);
  expect(run.fake.calls.transcribe).toBeGreaterThan(0); // the fault was reached, not something else
  expect(run.fake.calls.llm).toBe(0);
  expect(run.fake.calls.outbound).toBe(0);
  const job = jobRow(run.jobId);
  expect(job.state).toBe("failed");
  expect(job.error ?? "").toMatch(hangul);
  const rec = recordingOf(run.lecture.id);
  expect(rec.status).toBe("failed");
  expect(rec.failure_message ?? "").toMatch(hangul);
  expect(getLectureById(run.lecture.id)).toMatchObject({ status: "error" });
  expect(getLectureById(run.lecture.id)!.error_message ?? "").toMatch(hangul);
  expect(openJobsOf(run.lecture.id)).toBe(0);
}

function expectPartialNotes(run: Awaited<ReturnType<typeof processWith>>): void {
  expect(run.ms).toBeLessThan(60_000);
  expect(run.fake.calls.transcribe).toBeGreaterThan(0);
  expect(run.fake.calls.llm).toBeGreaterThan(0); // the notes fault was reached
  expect(run.fake.calls.outbound).toBe(0);
  expect(jobRow(run.jobId).state).toBe("succeeded");
  expect(recordingOf(run.lecture.id)).toMatchObject({ status: "partial", failure_code: "notes_failed" });
  expect(segmentsOf(run.lecture.id)).toBeGreaterThan(0);
  expect(openJobsOf(run.lecture.id)).toBe(0);
}

// --- tests ------------------------------------------------------------------------------

describe.skipIf(!isFfmpegAvailable())("provider outage rehearsal (real adapters, fake fetch)", () => {
  test(
    "the copied ok answers process a recording to ready",
    async () => {
      const run = await processWith({ transcribe: "ok", llm: "ok" });
      expect(run.fake.calls.outbound).toBe(0);
      expect(jobRow(run.jobId).state).toBe("succeeded");
      expect(JSON.parse(jobRow(run.jobId).result!)).toMatchObject({ status: "ready", failed_chunks: [] });
      expect(recordingOf(run.lecture.id)).toMatchObject({ status: "ready", failure_code: null });
      expect(segmentsOf(run.lecture.id)).toBeGreaterThan(0);
    },
    60_000
  );

  test(
    "transcription 5xx on every call ends as failed",
    async () => {
      expectFailedTranscript(await processWith({ transcribe: "5xx", llm: "ok" }));
    },
    60_000
  );

  test(
    "transcription that never answers ends as failed",
    async () => {
      expectFailedTranscript(await processWith({ transcribe: "hang", llm: "ok" }));
    },
    60_000
  );

  test(
    "transcription 429 ends as failed",
    async () => {
      expectFailedTranscript(await processWith({ transcribe: "429", llm: "ok" }));
    },
    60_000
  );

  test(
    "notes 5xx keeps the transcript",
    async () => {
      expectPartialNotes(await processWith({ transcribe: "ok", llm: "5xx" }));
    },
    60_000
  );

  test(
    "notes that never answer keep the transcript",
    async () => {
      expectPartialNotes(await processWith({ transcribe: "ok", llm: "hang" }));
    },
    60_000
  );

  test(
    "notes 429 keeps the transcript",
    async () => {
      expectPartialNotes(await processWith({ transcribe: "ok", llm: "429" }));
    },
    60_000
  );

  test(
    "nothing is retried forever",
    async () => {
      const run = await processWith({ transcribe: "5xx", llm: "ok" });
      expect(jobRow(run.jobId).state).toBe("failed");
      const runs = db.query(`SELECT attempts FROM stage_run WHERE job_id = ? AND stage = 'transcribe'`).all(run.jobId) as Array<{ attempts: number }>;
      expect(runs.length).toBeGreaterThan(0);
      // Every call is one attempt of one chunk's run, and no run goes past the policy.
      expect(run.fake.calls.transcribe).toBe(runs.reduce((n, r) => n + r.attempts, 0));
      expect(run.fake.calls.transcribe).toBeLessThanOrEqual(runs.length * TRANSCRIBE_MAX_ATTEMPTS);
    },
    60_000
  );

  test(
    "recording can be retried after a failure",
    async () => {
      const run = await processWith({ transcribe: "5xx", llm: "ok" });
      expect(jobRow(run.jobId).state).toBe("failed");
      expect(recordingOf(run.lecture.id).status).toBe("failed");

      // The outage is over: the operator retries the job (same id, resumes at the failed stage).
      run.fake.plan.transcribe = "ok";
      const res = await handleRequest(
        new Request(`http://localhost${API_BASE_PATH}/admin/jobs/${run.jobId}/retry`, { method: "POST", headers: { "X-Lectern-Token": admin.api_token } })
      );
      expect(res.status).toBe(200);
      await runQueued(run.jobId);

      expect(jobRow(run.jobId).state).toBe("succeeded");
      expect(recordingOf(run.lecture.id)).toMatchObject({ status: "ready", failure_code: null });
      expect(getLectureById(run.lecture.id)).toMatchObject({ status: "done" });
      expect(segmentsOf(run.lecture.id)).toBeGreaterThan(0);
      expect(run.fake.calls.outbound).toBe(0);
    },
    60_000
  );

  test("no outbound request", async () => {
    const fake = faultyFetch({ transcribe: "ok", llm: "ok" });
    await expect(fake.fetch("https://example.com/")).rejects.toThrow("outbound request refused");
    expect(fake.calls).toEqual({ transcribe: 0, llm: 0, outbound: 1 });
  });
});
