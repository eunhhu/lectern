import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { lectureRecordingId, personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import {
  Harness,
  ScriptedLlmProvider,
  ScriptedTranscriptionProvider,
  synthesizeSpeechTone,
  type JobRun,
  type ScriptLine,
  type Transcript,
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
  getLectureById,
  getSystemSettings,
  HARNESS_BLOB_DIR,
  syncPendingLectures,
  updateSystemSettings,
  type LectureRecord,
  type UserRecord,
} from "../src/db.ts";
import { handleRequest } from "../src/index.ts";
import { alignmentPath, alignRecording } from "../src/pdf-align.ts";
import { savePdfPages } from "../src/pdf-publish.ts";
import { PROCESS_JOB_KIND, runProcessJob } from "../src/process-job.ts";
import { embeddedWorker, type JobWorker, type LeasedJob } from "../src/queue.ts";
import { publishTranscript } from "../src/transcript-publish.ts";
import { chunkRecording } from "@lectern/ask";
import { lectureSources } from "../src/ask/legacy.ts";
import { notesAnswer, notesCallOf } from "./fixtures/process-answers.ts";

// The transcript–PDF alignment (P3-04, D-P3-4): alignRecording runs the model-free `align`
// stage over the published transcript and the stored PDF pages, keeps the result for
// GET /recordings/{id}/alignment, and its PDF context reaches the structure prompt of a
// process run. Scripted providers; nothing calls a model.

const harness = new Harness({ db, blobDir: HARNESS_BLOB_DIR, sleep: async () => {} });

const setPdf = (on: boolean) => {
  process.env.LECTERN_PDF = on ? "1" : "0";
  resetConfigForTests();
};

let alice: UserRecord;
let bob: UserRecord;

// This file runs a process job itself: the embedded worker (shared by every test file in this
// process) must not lease it, and with LECTERN_WORKER_MODE=external no new one starts.
const originalSettings = getSystemSettings();
let paused: JobWorker | null = null;
const directJobs: string[] = [];

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
  for (const id of directJobs) {
    db.query(`UPDATE job SET state = 'failed', finished_at = ? WHERE id = ? AND state IN ('queued', 'running')`).run(Date.now(), id);
  }
  updateSystemSettings(originalSettings);
  for (const name of ["LECTERN_PDF", "LECTERN_WORKER_MODE", "LECTERN_PIPELINE"]) delete process.env[name];
  resetConfigForTests();
  paused?.start();
});

const SEGMENT_TEXTS: Array<[number, number, string]> = [
  [0, 60_000, "대칭키 암호의 운영 모드 ECB와 CBC를 설명합니다"],
  [130_000, 190_000, "해시 함수 SHA와 충돌 저항성을 봅니다"],
  [250_000, 300_000, "공개키 RSA 암호와 소인수분해 어려움"],
];
const PAGE_TEXTS = [
  "운영 모드 ECB CBC 블록 암호 대칭키",
  "해시 함수 SHA 충돌 저항성 무결성",
  "공개키 RSA 소인수분해 암호",
  "점심 메뉴 김밥 라면 학생식당 안내",
];

function uploadPath(ext: string): string {
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  return join(DATA_DIR, "uploads", `${generateId("aln")}.${ext}`);
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

function insertPdfAsset(recordingId: string, workspaceId: string, path: string, partIndex: number): string {
  const id = uuidv7(Date.now());
  db.query(
    `INSERT INTO asset (id, workspace_id, recording_id, kind, part_index, blob_key, sha256, bytes, mime, duration_ms, page_count, meta_json, created_at)
     VALUES (?, ?, ?, 'pdf', ?, ?, NULL, 10, 'application/pdf', NULL, NULL, ?, ?)`
  ).run(id, workspaceId, recordingId, partIndex, `file:${path}`, JSON.stringify({ filename: `slides-${partIndex}.pdf`, path }), Date.now());
  return id;
}

function transcriptOf(texts: Array<[number, number, string]>): Transcript {
  return {
    version: 1,
    duration_ms: 300_000,
    failed_chunks: [],
    gaps: [],
    speakers: [{ label: "S1", confidence: 1, basis: "single_chunk", segments: texts.length, chars: 60, members: [{ chunk: 0, label: "S1" }] }],
    segments: texts.map(([start_ms, end_ms, text], idx) => ({ idx, start_ms, end_ms, speaker: "S1", source_chunk: 0, text })),
  };
}

/** A recording of `owner` with the synthetic transcript and, unless `pages` is empty, one PDF asset with those pages. */
function alignedRecording(owner: UserRecord, pages: string[] = PAGE_TEXTS) {
  const audio = uploadPath("m4a");
  writeFileSync(audio, "audio");
  const lecture = lectureFor(owner, audio);
  const recordingId = lectureRecordingId(lecture.id);
  const workspaceId = personalWorkspaceId(owner.id);
  publishTranscript({ recordingId, workspaceId, transcript: transcriptOf(SEGMENT_TEXTS) });
  let assetId: string | null = null;
  if (pages.length) {
    const path = uploadPath("pdf");
    writeFileSync(path, "%PDF-fake");
    assetId = insertPdfAsset(recordingId, workspaceId, path, 0);
    savePdfPages({
      assetId,
      recordingId,
      workspaceId,
      out: {
        page_count: pages.length,
        scanned: false,
        pages: pages.map((text, i) => ({ page_no: i + 1, text, char_count: [...text.replace(/\s/g, "")].length, has_text_layer: true })),
      },
    });
  }
  return { lecture, recordingId, workspaceId, assetId };
}

function jobRun(owner: UserRecord, workspaceId: string): JobRun {
  const id = `job_${crypto.randomUUID()}`;
  const now = Date.now();
  db.query(`INSERT INTO job (id, owner_id, kind, state, run_after, created_at, finished_at) VALUES (?, ?, 'align-test', 'succeeded', 0, ?, ?)`).run(
    id,
    owner.id,
    now,
    now
  );
  return harness.job({ jobId: id, scope: workspaceId, workspaceId });
}

async function api(method: string, path: string, user: UserRecord) {
  const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers: { "X-Lectern-Token": user.api_token } }));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? ((await res.json()) as any) : null };
}

const count = (sql: string, ...args: string[]) => (db.query(sql).get(...args) as { n: number }).n;

describe("alignRecording and getRecordingAlignment", () => {
  test("process aligns and the route returns windows", async () => {
    setPdf(true);
    const { recordingId, workspaceId, assetId } = alignedRecording(alice);
    const pdf = await alignRecording({ run: jobRun(alice, workspaceId), recordingId, workspaceId });
    expect(pdf).not.toBeNull();
    expect(pdf!.labels.map((l) => l.page_no)).toEqual([1, 2, 3]);
    expect(pdf!.text.startsWith("[PDF 1] (자료 1, 1쪽)\n운영 모드")).toBe(true);
    const res = await api("GET", `/recordings/${recordingId}/alignment`, alice);
    expect(res.status).toBe(200);
    expect(res.body.windows).toHaveLength(3);
    expect(res.body.windows.map((w: { start_ms: number }) => w.start_ms)).toEqual([0, 120_000, 240_000]);
    expect(res.body.windows[0].pages[0]).toMatchObject({ asset_id: assetId, page_no: 1 });
    expect(res.body.windows[0].pages[0].score).toBeGreaterThan(0);
    expect(existsSync(alignmentPath(recordingId))).toBe(true);
  });

  test("no pdf means no align stage", async () => {
    setPdf(true);
    const { recordingId, workspaceId } = alignedRecording(alice, []);
    const run = jobRun(alice, workspaceId);
    expect(await alignRecording({ run, recordingId, workspaceId })).toBeNull();
    expect(count(`SELECT COUNT(*) AS n FROM stage_run WHERE job_id = ? AND stage = 'align'`, run.context.jobId)).toBe(0);
    const res = await api("GET", `/recordings/${recordingId}/alignment`, alice);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ windows: [] });
  });

  test("other user gets 404", async () => {
    setPdf(true);
    const { recordingId, workspaceId } = alignedRecording(alice);
    await alignRecording({ run: jobRun(alice, workspaceId), recordingId, workspaceId });
    expect((await api("GET", `/recordings/${recordingId}/alignment`, bob)).status).toBe(404);
  });

  test("flag off is 501", async () => {
    setPdf(false);
    const { recordingId } = alignedRecording(alice, []);
    const res = await api("GET", `/recordings/${recordingId}/alignment`, alice);
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("not_implemented");
  });

  test("deleting the recording removes the file", async () => {
    setPdf(true);
    const { recordingId, workspaceId } = alignedRecording(alice);
    await alignRecording({ run: jobRun(alice, workspaceId), recordingId, workspaceId });
    expect(existsSync(alignmentPath(recordingId))).toBe(true);
    expect((await api("DELETE", `/recordings/${recordingId}`, alice)).status).toBe(204);
    expect(existsSync(alignmentPath(recordingId))).toBe(false);
    expect(count(`SELECT COUNT(*) AS n FROM pdf_page WHERE recording_id = ?`, recordingId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A process run with real (generated) PDFs: ingest → align → the structure prompt.
// ---------------------------------------------------------------------------

const S = 1000;

async function talk(): Promise<{ audio: string; script: ScriptLine[] }> {
  const script: ScriptLine[] = Array.from({ length: 18 }, (_, i) => ({
    start_ms: i * 5 * S,
    end_ms: i * 5 * S + 4 * S,
    speaker: "S1",
    text: `${i + 1}번째 설명: 블록 암호의 운영 모드에서 초기화 벡터는 예측할 수 없어야 합니다.`,
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
  directJobs.push(id);
  return { id, kind: PROCESS_JOB_KIND, subjectId: lecture.id, ownerId: lecture.owner_id, payload, attempts: 0, secret: () => undefined };
}

describe.skipIf(!isFfmpegAvailable())("process job with lecture PDFs", () => {
  test("context reaches structure", async () => {
    setPdf(true);
    process.env.LECTERN_PIPELINE = "v2";
    resetConfigForTests();
    const { audio, script } = await talk();
    const lecture = lectureFor(alice, audio);
    const recordingId = lectureRecordingId(lecture.id);
    const workspaceId = personalWorkspaceId(alice.id);
    const slides = uploadPath("pdf");
    writeFileSync(slides, makeKoreanPdf("블록 암호의 운영 모드에서 초기화 벡터는 예측할 수 없어야 합니다"));
    const lunch = uploadPath("pdf");
    // No bigram in common with the transcript, so it scores 0 and stays out of the context.
    writeFileSync(lunch, makeKoreanPdf("점심 메뉴 김밥 라면 학생식당 휴무 안내 공지 식단표"));
    const slidesId = insertPdfAsset(recordingId, workspaceId, slides, 0);
    insertPdfAsset(recordingId, workspaceId, lunch, 1);

    const transcription: ScriptedTranscriptionProvider = new ScriptedTranscriptionProvider(script, {});
    // The notes cite PDF label 1: once next to a segment, once alone (a page-only block).
    const llm = new ScriptedLlmProvider((req) => {
      const answer = notesAnswer(req) as { sections?: Array<{ key: string; blocks: unknown[] }> };
      if (notesCallOf(req) !== "structure") return answer;
      const sections = structuredClone(answer.sections!);
      sections.find((s) => s.key === "topics")!.blocks.push(
        { type: "paragraph", heading: null, text: "IV는 예측할 수 없어야 한다", sources: ["#2"], pdf_pages: [1] },
        { type: "paragraph", heading: null, text: "슬라이드에만 있는 정리", sources: [], pdf_pages: [1] }
      );
      return { sections };
    });
    const job = processJob(lecture);
    const outcome = await runProcessJob(job, {
      transcription,
      llm,
      harness,
      pipeline: {
        concurrency: 1,
        chunk: { targetMs: 30_000, overlapMinMs: 3_000, overlapMaxMs: 6_000 },
        onStage: (event) => transcription.observe(event),
      },
    });
    expect(outcome).toMatchObject({ ok: true, result: { status: "ready" } });

    const structure = llm.calls.map((c) => c.req).find((req) => req.instruction.startsWith("위 전사로 노트를 만든다."));
    expect(structure).toBeDefined();
    const pdfPart = structure!.context.find((part) => part.type === "text" && part.text.startsWith("자료(PDF) 관련 쪽:"));
    expect(pdfPart).toBeDefined();
    const text = pdfPart!.type === "text" ? pdfPart!.text : "";
    expect(text).toContain("[PDF 1] (자료 1, 1쪽)\n블록 암호의 운영 모드");
    expect(text).not.toContain("김밥");
    expect((text.match(/\[PDF \d+\]/g) ?? []).length).toBeLessThanOrEqual(12);
    expect(count(`SELECT COUNT(*) AS n FROM stage_run WHERE job_id = ? AND stage = 'align'`, job.id)).toBe(1);
    const alignment = await api("GET", `/recordings/${recordingId}/alignment`, alice);
    expect(alignment.body.windows).toHaveLength(1);
    expect(alignment.body.windows[0].pages.map((p: { page_no: number }) => p.page_no)).toEqual([1]);

    // The verified document carries pdf_page sources with the real asset id, and the
    // Markdown bridge and the search chunker read it (a page-only block included).
    const docId = (db.query(`SELECT id FROM document WHERE recording_id = ? AND template_id = 'lecture'`).get(recordingId) as { id: string }).id;
    const doc = await api("GET", `/documents/${docId}`, alice);
    expect(doc.status).toBe(200);
    const blocks = (doc.body.version.body.sections as Array<{ blocks: Array<{ text?: string; sources: Array<Record<string, unknown>> }> }>).flatMap(
      (s) => s.blocks
    );
    const cited = blocks.find((b) => b.text === "IV는 예측할 수 없어야 한다")!;
    expect(cited.sources[0]).toMatchObject({ kind: "transcript" });
    expect(cited.sources).toContainEqual({ kind: "pdf_page", asset_id: slidesId, page: 1 });
    expect(blocks.find((b) => b.text === "슬라이드에만 있는 정리")!.sources).toEqual([{ kind: "pdf_page", asset_id: slidesId, page: 1 }]);
    const lecture2 = getLectureById(lecture.id)!;
    expect(lecture2.markdown).toContain("슬라이드에만 있는 정리 [p.1]");
    const chunks = chunkRecording(lectureSources(lecture2));
    expect(chunks.some((c) => c.kind === "document" && c.text.includes("슬라이드에만 있는 정리"))).toBe(true);
  }, 120_000);
});
