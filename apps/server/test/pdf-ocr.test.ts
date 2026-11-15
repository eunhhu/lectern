import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { lectureRecordingId, personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import {
  estimateOcrCost,
  Harness,
  loadRouting,
  ScriptedLlmProvider,
  ScriptedTranscriptionProvider,
  synthesizeSpeechTone,
  type ScriptLine,
} from "@lectern/harness";
import { isFfmpegAvailable } from "@lectern/media";
import { makeKoreanPdf } from "../../../packages/pdf/test/make-pdf.ts";
import { uuidv7 } from "../src/api/v2/store.ts";
import {
  createPendingLecture,
  createUser,
  DATA_DIR,
  db,
  generateId,
  getSystemSettings,
  HARNESS_BLOB_DIR,
  syncPendingLectures,
  updateSystemSettings,
  type LectureRecord,
  type UserRecord,
} from "../src/db.ts";
import { handleRequest } from "../src/index.ts";
import { savePdfPages } from "../src/pdf-publish.ts";
import { OCR_JOB_KIND, runOcrJob } from "../src/pdf-ocr-job.ts";
import { PROCESS_JOB_KIND, runProcessJob } from "../src/process-job.ts";
import { embeddedWorker, type JobWorker, type LeasedJob } from "../src/queue.ts";
import { notesAnswer } from "./fixtures/process-answers.ts";

// OCR only with the user's approval (P3-05, D-P3-3): a dry run answers the page count and
// the estimate without touching the model or the queue; a confirmed request queues a
// `pdf_ocr` job that reads only the pages without text and stores them with
// ocr_source='model'. Uploads and `process` runs never OCR. Gemini is a fake fetch that
// counts its calls; any other host throws.

const harness = new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} });
const OCR_MODEL = loadRouting().ocr.model;

let alice: UserRecord;
let bob: UserRecord;
let viewer: UserRecord;

const setEnv = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  resetConfigForTests();
};

// ---------------------------------------------------------------------------
// Fake Gemini
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
let geminiCalls = 0;
const ocrText = (page: number) => `OCR로 읽은 ${page}쪽 본문: 블록 암호의 운영 모드 정리`;

function installFakeGemini(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://generativelanguage.googleapis.com/")) throw new Error(`unexpected network call: ${new URL(url).host}`);
    geminiCalls += 1;
    const body = JSON.parse(String(init?.body));
    const prompt: string = body.contents[0].parts[1].text;
    const pages = (/쪽 번호: ([\d, ]+)/.exec(prompt)?.[1] ?? "").split(",").map((n) => Number(n.trim()));
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ pages: pages.map((page_no) => ({ page_no, text: ocrText(page_no) })) }) }] }, finishReason: "STOP" },
        ],
        usageMetadata: { promptTokenCount: 5 * 258, candidatesTokenCount: 300 },
        modelVersion: OCR_MODEL,
        responseId: "fake-ocr",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// This file runs jobs itself: the embedded worker (shared by every test file in this
// process) must not lease them, and with LECTERN_WORKER_MODE=external no new one starts.
const originalSettings = getSystemSettings();
let paused: JobWorker | null = null;
const touchedJobs: string[] = [];

beforeAll(async () => {
  process.env.LECTERN_WORKER_MODE = "external";
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
  updateSystemSettings({ storage_auto_compact: false });
  installFakeGemini();
  const user = (name: string) => createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
  alice = user("alice");
  bob = user("bob");
  viewer = user("viewer");
  const now = Date.now();
  db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'viewer', ?, ?)`).run(
    personalWorkspaceId(alice.id),
    viewer.id,
    now,
    now
  );
});

afterEach(() => {
  for (const name of ["LECTERN_PDF", "LECTERN_ASK", "GEMINI_API_KEY", "LECTERN_PIPELINE"]) delete process.env[name];
  resetConfigForTests();
});

afterAll(() => {
  globalThis.fetch = realFetch;
  const ids = [...touchedJobs, ...(db.query(`SELECT id FROM job WHERE kind IN ('pdf_ocr', 'index') AND state IN ('queued', 'running')`).all() as Array<{ id: string }>).map((j) => j.id)];
  for (const id of ids) db.query(`UPDATE job SET state = 'failed', finished_at = ? WHERE id = ? AND state IN ('queued', 'running')`).run(Date.now(), id);
  updateSystemSettings(originalSettings);
  delete process.env.LECTERN_WORKER_MODE;
  resetConfigForTests();
  paused?.start();
});

function uploadPath(ext: string): string {
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  return join(DATA_DIR, "uploads", `${generateId("ocr")}.${ext}`);
}

function lectureFor(owner: UserRecord, audioPath: string): LectureRecord {
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
  syncPendingLectures();
  return lecture;
}

function insertPdfAsset(recordingId: string, workspaceId: string, path: string, partIndex = 0): string {
  const id = uuidv7(Date.now());
  db.query(
    `INSERT INTO asset (id, workspace_id, recording_id, kind, part_index, blob_key, sha256, bytes, mime, duration_ms, page_count, meta_json, created_at)
     VALUES (?, ?, ?, 'pdf', ?, ?, NULL, 10, 'application/pdf', NULL, NULL, ?, ?)`
  ).run(id, workspaceId, recordingId, partIndex, `file:${path}`, JSON.stringify({ filename: "scan.pdf", path }), Date.now());
  return id;
}

const TEXT_LAYER = "이 쪽에는 글자 층이 있어 OCR하지 않습니다 원래 글자";

/** A recording of `owner` with one 5-page PDF: pages 1 and 4 have text, 2, 3 and 5 do not. */
function scannedRecording(owner: UserRecord, options: { pages?: boolean } = {}) {
  const audio = uploadPath("m4a");
  writeFileSync(audio, "audio");
  const lecture = lectureFor(owner, audio);
  const recordingId = lectureRecordingId(lecture.id);
  const workspaceId = personalWorkspaceId(owner.id);
  const path = uploadPath("pdf");
  writeFileSync(path, `%PDF-1.4 scanned ${crypto.randomUUID()}`);
  const assetId = insertPdfAsset(recordingId, workspaceId, path);
  if (options.pages !== false) {
    savePdfPages({
      assetId,
      recordingId,
      workspaceId,
      out: {
        page_count: 5,
        scanned: true,
        pages: [1, 2, 3, 4, 5].map((page_no) => {
          const text = page_no === 1 || page_no === 4 ? TEXT_LAYER : "";
          return { page_no, text, char_count: [...text.replace(/\s/g, "")].length, has_text_layer: text !== "" };
        }),
      },
    });
  }
  return { lecture, recordingId, workspaceId, assetId };
}

async function ocr(user: UserRecord, assetId: string, dryRun: boolean) {
  const res = await handleRequest(
    new Request(`http://localhost${API_BASE_PATH}/assets/${assetId}/ocr`, {
      method: "POST",
      headers: { "X-Lectern-Token": user.api_token, "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: dryRun }),
    })
  );
  return { status: res.status, body: (await res.json()) as any };
}

/** The queued job row as the worker would lease it, marked running so no worker takes it. */
function leased(jobId: string): LeasedJob {
  touchedJobs.push(jobId);
  db.query(`UPDATE job SET state = 'running', started_at = ? WHERE id = ?`).run(Date.now(), jobId);
  const row = db.query(`SELECT id, kind, subject_id, owner_id, payload, attempts FROM job WHERE id = ?`).get(jobId) as any;
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    ownerId: row.owner_id,
    payload: JSON.parse(row.payload),
    attempts: row.attempts,
    secret: () => undefined,
  };
}

function finish(jobId: string, outcome: { ok: boolean; result?: Record<string, unknown> }): void {
  db.query(`UPDATE job SET state = ?, result = ?, finished_at = ? WHERE id = ?`).run(
    outcome.ok ? "succeeded" : "failed",
    JSON.stringify(outcome.result ?? null),
    Date.now(),
    jobId
  );
}

const count = (sql: string, ...args: string[]) => (db.query(sql).get(...args) as { n: number }).n;
const jobCount = () => count(`SELECT COUNT(*) AS n FROM job`);
const pageRows = (assetId: string) =>
  db.query(`SELECT page_no, text, char_count, has_text_layer, ocr_source FROM pdf_page WHERE asset_id = ? ORDER BY page_no`).all(assetId) as Array<{
    page_no: number;
    text: string;
    char_count: number;
    has_text_layer: number;
    ocr_source: string | null;
  }>;

// ---------------------------------------------------------------------------

describe("ocrAsset and the pdf_ocr job", () => {
  let approved: { assetId: string; jobId: string; lecture: LectureRecord; workspaceId: string } | null = null;

  test("dry run costs nothing", async () => {
    setEnv("LECTERN_PDF", "1");
    setEnv("GEMINI_API_KEY", "test-key-never-sent");
    const { assetId } = scannedRecording(alice);
    const jobsBefore = jobCount();
    const callsBefore = geminiCalls;
    const res = await ocr(alice, assetId, true);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pages_to_ocr: 3,
      estimated_cost_microusd: estimateOcrCost({ pagesToOcr: 3, pageCount: 5, model: OCR_MODEL }),
      job_id: null,
    });
    expect(res.body.estimated_cost_microusd).toBeGreaterThan(0);
    expect(geminiCalls).toBe(callsBefore);
    expect(jobCount()).toBe(jobsBefore);
  });

  test("approved run enqueues and runs", async () => {
    setEnv("LECTERN_PDF", "1");
    setEnv("LECTERN_ASK", "1");
    setEnv("GEMINI_API_KEY", "test-key-never-sent");
    const { assetId, lecture, workspaceId } = scannedRecording(alice);
    const res = await ocr(alice, assetId, false);
    expect(res.status).toBe(202);
    expect(typeof res.body.job_id).toBe("string");
    expect(res.body.pages_to_ocr).toBe(3);
    const job = db.query(`SELECT kind, budget_microusd, payload FROM job WHERE id = ?`).get(res.body.job_id) as any;
    expect(job.kind).toBe(OCR_JOB_KIND);
    expect(job.budget_microusd).toBe(res.body.estimated_cost_microusd * 2);
    expect(JSON.parse(job.payload)).toEqual({ asset_id: assetId });

    const callsBefore = geminiCalls;
    const outcome = await runOcrJob(leased(res.body.job_id), { harness });
    finish(res.body.job_id, outcome);
    expect(outcome).toEqual({ ok: true, result: { pages: 3 } });
    expect(geminiCalls - callsBefore).toBe(1);
    const rows = pageRows(assetId);
    for (const n of [2, 3, 5]) {
      expect(rows[n - 1]).toMatchObject({ text: ocrText(n), ocr_source: "model", has_text_layer: 0 });
      expect(rows[n - 1]!.char_count).toBe([...ocrText(n).replace(/\s/g, "")].length);
    }
    for (const n of [1, 4]) expect(rows[n - 1]).toMatchObject({ text: TEXT_LAYER, ocr_source: null, has_text_layer: 1 });
    const meta = JSON.parse((db.query(`SELECT meta_json FROM asset WHERE id = ?`).get(assetId) as { meta_json: string }).meta_json);
    expect(meta.ocr_pages).toBe(3);
    approved = { assetId, jobId: res.body.job_id, lecture, workspaceId };
  });

  test("text-layer pages never re-ocr", async () => {
    setEnv("LECTERN_PDF", "1");
    const res = await ocr(alice, approved!.assetId, true);
    expect(res).toEqual({ status: 200, body: { pages_to_ocr: 0, estimated_cost_microusd: 0, job_id: null } });
  });

  test("second approval is a no-op", async () => {
    setEnv("LECTERN_PDF", "1");
    setEnv("GEMINI_API_KEY", "test-key-never-sent");
    const jobsBefore = jobCount();
    const res = await ocr(alice, approved!.assetId, false);
    expect(res).toEqual({ status: 200, body: { pages_to_ocr: 0, estimated_cost_microusd: 0, job_id: null } });
    expect(jobCount()).toBe(jobsBefore);
  });

  test("cost lands in ai_call", () => {
    const calls = db.query(`SELECT workspace_id, provider, model, cost_microusd FROM ai_call WHERE job_id = ?`).all(approved!.jobId) as any[];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ workspace_id: approved!.workspaceId, provider: "gemini", model: OCR_MODEL });
    expect(calls[0].cost_microusd).toBeGreaterThan(0);
    const job = db.query(`SELECT spent_microusd FROM job WHERE id = ?`).get(approved!.jobId) as { spent_microusd: number };
    expect(job.spent_microusd).toBe(calls[0].cost_microusd);
  });

  test("index refresh queued", () => {
    expect(count(`SELECT COUNT(*) AS n FROM job WHERE kind = 'index' AND subject_id = ?`, approved!.lecture.id)).toBeGreaterThan(0);
  });

  test("job leaks no text", () => {
    const row = db.query(`SELECT result FROM job WHERE id = ?`).get(approved!.jobId) as { result: string };
    expect(JSON.parse(row.result)).toEqual({ pages: 3 });
    expect(row.result).not.toContain("OCR로 읽은");
  });

  test("a rerun of the job sends nothing", async () => {
    const callsBefore = geminiCalls;
    const outcome = await runOcrJob(leased(approved!.jobId), { harness });
    finish(approved!.jobId, { ok: true, result: { pages: 3 } });
    expect(outcome).toEqual({ ok: true, result: { pages: 0 } });
    expect(geminiCalls).toBe(callsBefore);
  });

  test("missing key is 503", async () => {
    setEnv("LECTERN_PDF", "1");
    setEnv("GEMINI_API_KEY", undefined);
    const { assetId } = scannedRecording(alice);
    const jobsBefore = jobCount();
    const res = await ocr(alice, assetId, false);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("unavailable");
    expect(jobCount()).toBe(jobsBefore);
  });

  test("rows not ready is 409", async () => {
    setEnv("LECTERN_PDF", "1");
    const { assetId } = scannedRecording(alice, { pages: false });
    const res = await ocr(alice, assetId, true);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
  });

  test("viewer cannot approve", async () => {
    setEnv("LECTERN_PDF", "1");
    setEnv("GEMINI_API_KEY", "test-key-never-sent");
    const { assetId, recordingId } = scannedRecording(alice);
    // Shared with the workspace, so the viewer sees it but may not change it.
    db.query(`UPDATE recording SET visibility = 'workspace' WHERE id = ?`).run(recordingId);
    expect((await ocr(viewer, assetId, false)).status).toBe(403);
    expect((await ocr(viewer, assetId, true)).status).toBe(403);
    expect((await ocr(bob, assetId, true)).status).toBe(404);
  });

  test("another pdf of the same recording waits for the pending ocr", async () => {
    setEnv("LECTERN_PDF", "1");
    setEnv("GEMINI_API_KEY", "test-key-never-sent");
    const { assetId, recordingId, workspaceId } = scannedRecording(alice);
    const first = await ocr(alice, assetId, false);
    expect(first.status).toBe(202);
    touchedJobs.push(first.body.job_id);
    // The same PDF again: the same queued job.
    const again = await ocr(alice, assetId, false);
    expect(again).toMatchObject({ status: 202, body: { job_id: first.body.job_id } });
    const path = uploadPath("pdf");
    writeFileSync(path, `%PDF-1.4 second ${crypto.randomUUID()}`);
    const second = insertPdfAsset(recordingId, workspaceId, path, 1);
    savePdfPages({ assetId: second, recordingId, workspaceId, out: { page_count: 1, scanned: true, pages: [{ page_no: 1, text: "", char_count: 0, has_text_layer: false }] } });
    const other = await ocr(alice, second, false);
    expect(other.status).toBe(409);
  });

  test("flag off", async () => {
    setEnv("LECTERN_PDF", "0");
    const { assetId } = scannedRecording(alice);
    const res = await ocr(alice, assetId, true);
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("not_implemented");
  });
});

// ---------------------------------------------------------------------------
// No OCR without approval: a scanned PDF through a whole `process` run.
// ---------------------------------------------------------------------------

const S = 1000;

describe.skipIf(!isFfmpegAvailable())("process never OCRs", () => {
  test("no ocr without approval", async () => {
    setEnv("LECTERN_PDF", "1");
    setEnv("LECTERN_PIPELINE", "v2");
    setEnv("GEMINI_API_KEY", "test-key-never-sent");
    const script: ScriptLine[] = Array.from({ length: 18 }, (_, i) => ({
      start_ms: i * 5 * S,
      end_ms: i * 5 * S + 4 * S,
      speaker: "S1",
      text: `${i + 1}번째 문장에서는 블록 암호의 운영 모드를 설명합니다.`,
    }));
    const audio = await synthesizeSpeechTone(script, 92 * S, uploadPath("m4a"));
    const lecture = lectureFor(alice, audio);
    const recordingId = lectureRecordingId(lecture.id);
    // Under 20 characters: no text layer, so the one-page PDF is a scan.
    const path = uploadPath("pdf");
    writeFileSync(path, makeKoreanPdf("스캔한 쪽"));
    const assetId = insertPdfAsset(recordingId, personalWorkspaceId(alice.id), path);

    const jobId = `job_${crypto.randomUUID()}`;
    const payload = { title: "", course: lecture.course };
    db.query(
      `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at) VALUES (?, ?, ?, ?, 'running', 0, ?, ?)`
    ).run(jobId, alice.id, PROCESS_JOB_KIND, lecture.id, JSON.stringify(payload), Date.now());
    touchedJobs.push(jobId);
    const transcription: ScriptedTranscriptionProvider = new ScriptedTranscriptionProvider(script, {});
    const callsBefore = geminiCalls;
    const outcome = await runProcessJob(
      { id: jobId, kind: PROCESS_JOB_KIND, subjectId: lecture.id, ownerId: alice.id, payload, attempts: 0, secret: () => undefined },
      {
        transcription,
        llm: new ScriptedLlmProvider(notesAnswer),
        harness,
        pipeline: {
          concurrency: 1,
          chunk: { targetMs: 30_000, overlapMinMs: 3_000, overlapMaxMs: 6_000 },
          onStage: (event) => transcription.observe(event),
        },
      }
    );
    expect(outcome.ok).toBe(true);
    const meta = JSON.parse((db.query(`SELECT meta_json FROM asset WHERE id = ?`).get(assetId) as { meta_json: string }).meta_json);
    expect(meta.scanned).toBe(true);
    expect(geminiCalls).toBe(callsBefore);
    expect(pageRows(assetId).every((p) => p.ocr_source === null)).toBe(true);
    expect(count(`SELECT COUNT(*) AS n FROM job WHERE kind = ? AND subject_id = ?`, OCR_JOB_KIND, recordingId)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM stage_run WHERE job_id = ? AND stage = 'pdf_ocr'`, jobId)).toBe(0);
  }, 120_000);
});
