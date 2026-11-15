import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
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
  type JobRun,
  type PdfExtractor,
  type ScriptLine,
} from "@lectern/harness";
import { isFfmpegAvailable } from "@lectern/media";
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
import { ingestRecordingPdfs } from "../src/pdf-publish.ts";
import { PROCESS_JOB_KIND, runProcessJob } from "../src/process-job.ts";
import { embeddedWorker, type JobWorker, type LeasedJob } from "../src/queue.ts";
import { notesAnswer } from "./fixtures/process-answers.ts";

// Lecture PDFs in processing (P3-03, D-P3-2, D-P3-3): pdf_ingest stores page text in
// pdf_page and the asset's page count and scan flag, GET /assets/{id}/pages reads them, the
// same PDF is read once, a scan runs no model, and an unreadable PDF leaves the recording
// `partial`, never failed. The extractor is a fake except in the process-job tests, where a
// file that only starts like a PDF goes through the real reader. Nothing calls a model.

const harness = new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} });

const setPdf = (on: boolean) => {
  process.env.LECTERN_PDF = on ? "1" : "0";
  resetConfigForTests();
};

let alice: UserRecord;
let bob: UserRecord;

// This file runs process jobs itself: the embedded worker (shared by every test file in this
// process) must not lease them, and with LECTERN_WORKER_MODE=external no new one starts.
const originalSettings = getSystemSettings();
let paused: JobWorker | null = null;
const finishedJobs: string[] = [];

beforeAll(async () => {
  process.env.LECTERN_WORKER_MODE = "external";
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
  updateSystemSettings({ storage_auto_compact: false });
  alice = createUser({ email: `${generateId("alice")}@example.com`, displayName: "alice", password: "correct_password_1" });
  bob = createUser({ email: `${generateId("bob")}@example.com`, displayName: "bob", password: "correct_password_1" });
});

afterEach(() => setPdf(false));

afterAll(() => {
  for (const id of finishedJobs) {
    db.query(`UPDATE job SET state = 'failed', finished_at = ? WHERE id = ? AND state IN ('queued', 'running')`).run(Date.now(), id);
  }
  updateSystemSettings(originalSettings);
  for (const name of ["LECTERN_PDF", "LECTERN_WORKER_MODE", "LECTERN_PIPELINE"]) delete process.env[name];
  resetConfigForTests();
  paused?.start();
});

function uploadPath(ext: string): string {
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  return join(DATA_DIR, "uploads", `${generateId("pdf")}.${ext}`);
}

/** A file that starts like a PDF; unique content, so no test shares another's memo. */
function fakePdf(content = `%PDF-fake ${crypto.randomUUID()}`): string {
  const path = uploadPath("pdf");
  writeFileSync(path, content);
  return path;
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

function insertAsset(recordingId: string, workspaceId: string, kind: "pdf" | "audio", path: string, partIndex = 0): string {
  const id = uuidv7(Date.now());
  db.query(
    `INSERT INTO asset (id, workspace_id, recording_id, kind, part_index, blob_key, sha256, bytes, mime, duration_ms, page_count, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 10, ?, NULL, NULL, ?, ?)`
  ).run(
    id,
    workspaceId,
    recordingId,
    kind,
    partIndex,
    `file:${path}`,
    kind === "pdf" ? "application/pdf" : "audio/mp4",
    JSON.stringify({ filename: kind === "pdf" ? "slides.pdf" : "extra.m4a", path }),
    Date.now()
  );
  return id;
}

/** A recording of `owner` with one PDF asset per file. */
function recordingWithPdfs(owner: UserRecord, pdfPaths: string[]) {
  const audio = uploadPath("m4a");
  writeFileSync(audio, "audio");
  const lecture = lectureFor(owner, audio);
  const recordingId = lectureRecordingId(lecture.id);
  const workspaceId = personalWorkspaceId(owner.id);
  const assetIds = pdfPaths.map((path, i) => insertAsset(recordingId, workspaceId, "pdf", path, i));
  return { lecture, recordingId, workspaceId, assetIds };
}

/** A finished job row (budget lookups, ledger) that no worker leases. */
function jobRun(owner: UserRecord, workspaceId: string): JobRun {
  const id = `job_${crypto.randomUUID()}`;
  const now = Date.now();
  db.query(`INSERT INTO job (id, owner_id, kind, state, run_after, created_at, finished_at) VALUES (?, ?, 'pdf-test', 'succeeded', 0, ?, ?)`).run(
    id,
    owner.id,
    now,
    now
  );
  return harness.job({ jobId: id, scope: workspaceId, workspaceId });
}

type Extracted = Awaited<ReturnType<PdfExtractor>>;
const page = (pageNo: number, hasText: boolean) => ({
  pageNo,
  text: hasText ? `Page ${pageNo} has enough readable words for a text layer` : "",
  charCount: hasText ? 40 : 0,
  hasTextLayer: hasText,
});

function counting(impl: () => Promise<Extracted>) {
  const calls: string[] = [];
  const extract: PdfExtractor = async (path) => {
    calls.push(path);
    return impl();
  };
  return { extract, calls };
}

const THREE_PAGES: Extracted = { pageCount: 3, scanned: false, pages: [page(1, true), page(2, false), page(3, true)] };
const SCANNED: Extracted = { pageCount: 3, scanned: true, pages: [page(1, false), page(2, false), page(3, false)] };

async function api(method: string, path: string, user: UserRecord) {
  const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers: { "X-Lectern-Token": user.api_token } }));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? ((await res.json()) as any) : null };
}

const count = (sql: string, ...args: string[]) => (db.query(sql).get(...args) as { n: number }).n;
const pageRows = (assetId: string) => count(`SELECT COUNT(*) AS n FROM pdf_page WHERE asset_id = ?`, assetId);
const assetRow = (assetId: string) => db.query(`SELECT page_count, meta_json FROM asset WHERE id = ?`).get(assetId) as { page_count: number | null; meta_json: string };

describe("pdf_ingest and listAssetPages", () => {
  test("upload then listAssetPages", async () => {
    setPdf(true);
    const { recordingId, workspaceId, assetIds } = recordingWithPdfs(alice, [fakePdf()]);
    const { extract } = counting(async () => THREE_PAGES);
    const summary = await ingestRecordingPdfs({ run: jobRun(alice, workspaceId), recordingId, workspaceId, extract });
    expect(summary).toEqual({ ingested: 1, failed: 0, scannedAssets: [], cacheHits: 0 });
    const res = await api("GET", `/assets/${assetIds[0]}/pages`, alice);
    expect(res.status).toBe(200);
    expect(res.body.page_count).toBe(3);
    expect(res.body.scanned).toBe(false);
    expect(res.body.pages[1]).toEqual({ page_no: 2, has_text_layer: false, char_count: 0 });
    expect(res.body.pages.map((p: { page_no: number }) => p.page_no)).toEqual([1, 2, 3]);
    expect(pageRows(assetIds[0]!)).toBe(3);
    expect(assetRow(assetIds[0]!).page_count).toBe(3);
    expect(JSON.parse(assetRow(assetIds[0]!).meta_json)).toMatchObject({ filename: "slides.pdf", scanned: false });
  });

  test("scanned pdf is flagged and nothing else runs", async () => {
    setPdf(true);
    const { recordingId, workspaceId, assetIds } = recordingWithPdfs(alice, [fakePdf()]);
    const { extract } = counting(async () => SCANNED);
    const run = jobRun(alice, workspaceId);
    const realFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("no network in this test");
    }) as unknown as typeof fetch;
    let summary;
    try {
      summary = await ingestRecordingPdfs({ run, recordingId, workspaceId, extract });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(summary.scannedAssets).toEqual([assetIds[0]!]);
    expect((await api("GET", `/assets/${assetIds[0]}/pages`, alice)).body.scanned).toBe(true);
    expect(fetches).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM ai_call WHERE job_id = ?`, run.context.jobId)).toBe(0);
  });

  test("re-upload of the same pdf hits the memo", async () => {
    setPdf(true);
    const content = `%PDF-fake same ${crypto.randomUUID()}`;
    const { recordingId, workspaceId, assetIds } = recordingWithPdfs(alice, [fakePdf(content), fakePdf(content)]);
    const { extract, calls } = counting(async () => THREE_PAGES);
    const summary = await ingestRecordingPdfs({ run: jobRun(alice, workspaceId), recordingId, workspaceId, extract });
    expect(summary.cacheHits).toBe(1);
    expect(summary.ingested).toBe(2);
    expect(calls).toHaveLength(1);
    expect(assetIds.map(pageRows)).toEqual([3, 3]);
  });

  test("rerun is idempotent", async () => {
    setPdf(true);
    const { recordingId, workspaceId, assetIds } = recordingWithPdfs(alice, [fakePdf()]);
    const { extract, calls } = counting(async () => THREE_PAGES);
    await ingestRecordingPdfs({ run: jobRun(alice, workspaceId), recordingId, workspaceId, extract });
    const again = await ingestRecordingPdfs({ run: jobRun(alice, workspaceId), recordingId, workspaceId, extract });
    expect(again.cacheHits).toBe(1);
    expect(calls).toHaveLength(1);
    expect(pageRows(assetIds[0]!)).toBe(3);
  });

  test("failure does not throw", async () => {
    setPdf(true);
    const { recordingId, workspaceId, assetIds } = recordingWithPdfs(alice, [fakePdf()]);
    const { extract, calls } = counting(async () => {
      throw Object.assign(new Error("PDF 파일이 손상되었거나 PDF가 아닙니다."), { name: "PdfError", code: "corrupt" });
    });
    const summary = await ingestRecordingPdfs({ run: jobRun(alice, workspaceId), recordingId, workspaceId, extract });
    expect(summary).toEqual({ ingested: 0, failed: 1, scannedAssets: [], cacheHits: 0 });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(assetRow(assetIds[0]!).meta_json).pdf_error).toBe("corrupt");
    expect(pageRows(assetIds[0]!)).toBe(0);
    const res = await api("GET", `/assets/${assetIds[0]}/pages`, alice);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ page_count: 0, scanned: false, pages: [] });
  });

  test("a later success clears the recorded error", async () => {
    setPdf(true);
    const { recordingId, workspaceId, assetIds } = recordingWithPdfs(alice, [fakePdf()]);
    const broken = counting(async () => {
      throw Object.assign(new Error("x"), { name: "PdfError", code: "unreadable" });
    });
    await ingestRecordingPdfs({ run: jobRun(alice, workspaceId), recordingId, workspaceId, extract: broken.extract });
    const fixed = counting(async () => THREE_PAGES);
    await ingestRecordingPdfs({ run: jobRun(alice, workspaceId), recordingId, workspaceId, extract: fixed.extract });
    const meta = JSON.parse(assetRow(assetIds[0]!).meta_json);
    expect(meta.pdf_error).toBeUndefined();
    expect(meta.scanned).toBe(false);
  });

  test("canceled run rethrows", async () => {
    setPdf(true);
    const { recordingId, workspaceId } = recordingWithPdfs(alice, [fakePdf()]);
    const { extract } = counting(async () => {
      throw new HarnessError("canceled", "녹음이 삭제되었습니다.");
    });
    const err = await ingestRecordingPdfs({ run: jobRun(alice, workspaceId), recordingId, workspaceId, extract }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(HarnessError);
    expect((err as HarnessError).kind).toBe("canceled");
  });

  test("flag off: pages route is 501", async () => {
    setPdf(false);
    const { assetIds } = recordingWithPdfs(alice, [fakePdf()]);
    const res = await api("GET", `/assets/${assetIds[0]}/pages`, alice);
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("not_implemented");
  });

  test("other user cannot list pages", async () => {
    setPdf(true);
    const { recordingId, workspaceId, assetIds } = recordingWithPdfs(alice, [fakePdf()]);
    await ingestRecordingPdfs({ run: jobRun(alice, workspaceId), recordingId, workspaceId, extract: counting(async () => THREE_PAGES).extract });
    const res = await api("GET", `/assets/${assetIds[0]}/pages`, bob);
    expect(res.status).toBe(404);
  });

  test("non-pdf asset is 404", async () => {
    setPdf(true);
    const { recordingId, workspaceId } = recordingWithPdfs(alice, []);
    const audioPath = uploadPath("m4a");
    writeFileSync(audioPath, "audio");
    const audioId = insertAsset(recordingId, workspaceId, "audio", audioPath);
    expect((await api("GET", `/assets/${audioId}/pages`, alice)).status).toBe(404);
    expect((await api("GET", `/assets/${crypto.randomUUID()}/pages`, alice)).status).toBe(404);
  });

  test("deleting the recording deletes pages", async () => {
    setPdf(true);
    const { recordingId, workspaceId, assetIds } = recordingWithPdfs(alice, [fakePdf()]);
    await ingestRecordingPdfs({ run: jobRun(alice, workspaceId), recordingId, workspaceId, extract: counting(async () => THREE_PAGES).extract });
    expect(pageRows(assetIds[0]!)).toBe(3);
    const res = await api("DELETE", `/recordings/${recordingId}`, alice);
    expect(res.status).toBe(204);
    expect(count(`SELECT COUNT(*) AS n FROM pdf_page WHERE recording_id = ?`, recordingId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The process job (scripted providers, synthetic audio): a PDF that cannot be read leaves the
// recording `partial` with its transcript; a recording without PDFs never runs the stage.
// ---------------------------------------------------------------------------

const S = 1000;

async function talk(): Promise<{ audio: string; script: ScriptLine[] }> {
  const script: ScriptLine[] = Array.from({ length: 18 }, (_, i) => ({
    start_ms: i * 5 * S,
    end_ms: i * 5 * S + 4 * S,
    speaker: "S1",
    text: `${i + 1}번째 문장에서는 블록 암호의 운영 모드와 초기화 벡터를 설명합니다.`,
  }));
  return { audio: await synthesizeSpeechTone(script, 92 * S, uploadPath("m4a")), script };
}

function processJob(lecture: LectureRecord): LeasedJob {
  const id = `job_${crypto.randomUUID()}`;
  const payload = { title: "", course: lecture.course };
  db.query(
    `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, payload, created_at)
     VALUES (?, ?, ?, ?, 'running', 0, ?, ?)`
  ).run(id, lecture.owner_id, PROCESS_JOB_KIND, lecture.id, JSON.stringify(payload), Date.now());
  finishedJobs.push(id);
  return { id, kind: PROCESS_JOB_KIND, subjectId: lecture.id, ownerId: lecture.owner_id, payload, attempts: 0, secret: () => undefined };
}

function scriptedDeps(script: ScriptLine[]) {
  const transcription: ScriptedTranscriptionProvider = new ScriptedTranscriptionProvider(script, {});
  return {
    transcription,
    llm: new ScriptedLlmProvider(notesAnswer),
    harness,
    pipeline: {
      concurrency: 1,
      chunk: { targetMs: 30_000, overlapMinMs: 3_000, overlapMaxMs: 6_000 },
      onStage: (event: Parameters<ScriptedTranscriptionProvider["observe"]>[0]) => transcription.observe(event),
    },
  };
}

const recordingOf = (lectureId: string) =>
  db.query(`SELECT status, failure_code FROM recording WHERE id = ?`).get(lectureRecordingId(lectureId)) as { status: string; failure_code: string | null };
const pdfStageRuns = (jobId: string) => count(`SELECT COUNT(*) AS n FROM stage_run WHERE job_id = ? AND stage = 'pdf_ingest'`, jobId);

describe.skipIf(!isFfmpegAvailable())("process job with lecture PDFs", () => {
  test("process job: pdf failure makes recording partial", async () => {
    setPdf(true);
    process.env.LECTERN_PIPELINE = "v2";
    resetConfigForTests();
    const { audio, script } = await talk();
    const lecture = lectureFor(alice, audio);
    const recordingId = lectureRecordingId(lecture.id);
    const assetId = insertAsset(recordingId, personalWorkspaceId(alice.id), "pdf", fakePdf());
    const job = processJob(lecture);
    const outcome = await runProcessJob(job, scriptedDeps(script));
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({ status: "partial" });
    expect(recordingOf(lecture.id)).toEqual({ status: "partial", failure_code: "pdf_failed" });
    expect(count(`SELECT COUNT(*) AS n FROM transcript_segment WHERE recording_id = ?`, recordingId)).toBeGreaterThan(0);
    expect(["corrupt", "unreadable"]).toContain(JSON.parse(assetRow(assetId).meta_json).pdf_error);
    expect(pdfStageRuns(job.id)).toBe(1);
  }, 120_000);

  test("process job without pdf skips the step", async () => {
    setPdf(true);
    process.env.LECTERN_PIPELINE = "v2";
    resetConfigForTests();
    const { audio, script } = await talk();
    const lecture = lectureFor(alice, audio);
    const job = processJob(lecture);
    const outcome = await runProcessJob(job, scriptedDeps(script));
    expect(outcome).toMatchObject({ ok: true, result: { status: "ready" } });
    expect(recordingOf(lecture.id).status).toBe("ready");
    expect(pdfStageRuns(job.id)).toBe(0);
  }, 120_000);
});
