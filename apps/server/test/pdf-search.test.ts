import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resetConfigForTests } from "@lectern/config";
import { FakeEmbedder, type AskModel } from "@lectern/ask";
import { lectureRecordingId } from "@lectern/db";
import { SearchHit } from "@lectern/domain";
import { createApiV2App } from "../src/api/v2/index.ts";
import { markdownParagraphs } from "../src/api/v2/search.ts";
import { uuidv7 } from "../src/api/v2/store.ts";
import { indexLecture, reconcileAskIndex } from "../src/ask/index-job.ts";
import { lectureDocumentId, personalWorkspaceId } from "../src/ask/legacy.ts";
import { createAskService, type AskService } from "../src/ask/service.ts";
import {
  completeLectureRecord,
  createPendingLecture,
  createUser,
  db,
  generateId,
  syncPendingLectures,
  type LectureRecord,
  type UserRecord,
} from "../src/db.ts";
import { savePdfPages } from "../src/pdf-publish.ts";
import { publishTranscript } from "../src/transcript-publish.ts";

// GET /search over the hybrid index (P3-06, D-P3-5): transcript, document and lecture PDF
// page hits from packages/ask, title matches first, the kind and recording filters, scope,
// and the P2 substring search while LECTERN_ASK is off. FakeEmbedder or none; no provider.

const LECTURE_MD = `# 정보보호 7주차

## 운영 모드
[12:03] ECB는 같은 평문 블록을 같은 암호문으로 바꿔 패턴이 드러나서 위험하다.

[14:40] CBC는 IV가 필요하고 IV는 예측할 수 없어야 한다.
`;

const MEETING_MD = `# 주간 회의

## 결정
- 출시일은 11월 3일로 확정했다.
`;

const TRANSCRIPT = ["오늘은 블록 체이닝 방식을 칠판에 그려 보겠습니다.", "카운터 모드는 병렬로 암호화할 수 있습니다."];
const SLIDES = ["운영 모드 비교표 ECB CBC CTR 슬라이드", "키 확장 서브키 스케줄 AES-256은 14라운드를 쓴다"];

const unusedModel: AskModel = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  async *stream() {
    throw new Error("search never calls the answer model");
  },
};

const embedder = new FakeEmbedder(64);
const withVectors = createAskService({ model: unusedModel, embedder, monthlyLimitMicrousd: 1_000_000 });
const lexicalOnly = createAskService({ model: unusedModel, monthlyLimitMicrousd: 1_000_000 });

let me: UserRecord;
let other: UserRecord;
let lecture: LectureRecord;
let meeting: LectureRecord;
let slidesId = "";
const ws = () => personalWorkspaceId(me.id);

function user(): UserRecord {
  return createUser({ email: `${generateId("srch")}@test.local`, displayName: "search", password: "correct_password_1", role: "member" });
}

function makeLecture(owner: UserRecord, title: string, course: string, markdown: string): LectureRecord {
  const id = generateId("lec");
  createPendingLecture({
    id,
    ownerId: owner.id,
    title,
    course,
    audioPath: "/nonexistent.m4a",
    audioMime: "audio/mp4",
    audioSize: 0,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "web",
  });
  const done = completeLectureRecord(id, { title, courseName: course, markdown, excerpt: "", modelUsed: "gemini-3.8-flash", durationSec: 3600 });
  syncPendingLectures();
  return done;
}

/** One PDF asset with `pages` on the lecture's recording. */
function attachPdf(l: LectureRecord, pages: string[]): string {
  const recordingId = lectureRecordingId(l.id);
  const workspaceId = personalWorkspaceId(l.owner_id);
  const assetId = uuidv7(Date.now());
  db.query(
    `INSERT INTO asset (id, workspace_id, recording_id, kind, part_index, blob_key, sha256, bytes, mime, duration_ms, page_count, meta_json, created_at)
     VALUES (?, ?, ?, 'pdf', 0, 'file:/nonexistent.pdf', NULL, 10, 'application/pdf', NULL, NULL, '{}', ?)`
  ).run(assetId, workspaceId, recordingId, Date.now());
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
  return assetId;
}

const setPdf = (on: boolean) => {
  process.env.LECTERN_PDF = on ? "1" : "0";
  resetConfigForTests();
};

async function search(svc: AskService | null, u: UserRecord, params: Record<string, string>) {
  const query = new URLSearchParams({ workspace_id: ws(), ...params });
  const res = await createApiV2App({ askService: () => svc }).request(`/search?${query}`, { headers: { "X-Lectern-Token": u.api_token } });
  const body = (await res.json()) as any;
  return { status: res.status, items: (body.items ?? []) as Array<Record<string, any>>, body };
}

beforeAll(async () => {
  setPdf(true);
  me = user();
  other = user();
  lecture = makeLecture(me, "정보보호 7주차", "정보보호", LECTURE_MD);
  meeting = makeLecture(me, "주간 회의", "업무", MEETING_MD);
  publishTranscript({
    recordingId: lectureRecordingId(lecture.id),
    workspaceId: ws(),
    transcript: {
      version: 1,
      duration_ms: 20_000,
      failed_chunks: [],
      gaps: [],
      speakers: [{ label: "S1", confidence: 1, basis: "single_chunk", segments: 2, chars: 40, members: [{ chunk: 0, label: "S1" }] }],
      segments: TRANSCRIPT.map((text, idx) => ({ idx, start_ms: idx * 10_000, end_ms: idx * 10_000 + 8_000, speaker: "S1", source_chunk: 0, text })),
    },
  });
  slidesId = attachPdf(lecture, SLIDES);
  for (const l of [lecture, meeting]) await indexLecture(l.id, { jobId: `job_${l.id}`, embedder });
});

afterAll(() => {
  delete process.env.LECTERN_PDF;
  resetConfigForTests();
});

describe("GET /search over the index", () => {
  for (const [name, svc] of [
    ["vectors", withVectors],
    ["lexical only", lexicalOnly],
  ] as const) {
    test(`search returns hits of three kinds (${name})`, async () => {
      const expectations: Array<[string, string]> = [
        ["체이닝", "transcript"],
        ["드러나서", "document"],
        ["서브키 스케줄", "pdf_page"],
      ];
      for (const [q, kind] of expectations) {
        const res = await search(svc, me, { q });
        expect(res.status).toBe(200);
        expect(res.items.some((h) => h.kind === kind), `${q} → ${kind}`).toBe(true);
        for (const hit of res.items) expect(SearchHit.safeParse(hit).success, JSON.stringify(hit)).toBe(true);
      }
    });
  }

  test("pdf hit shape", async () => {
    const { items } = await search(lexicalOnly, me, { q: "서브키 스케줄" });
    const hit = items.find((h) => h.kind === "pdf_page")!;
    expect(hit).toMatchObject({ kind: "pdf_page", asset_id: slidesId, page: 2, recording_id: lectureRecordingId(lecture.id), recording_title: "정보보호 7주차" });
    expect(hit.snippet.some((r: { highlight: boolean }) => r.highlight)).toBe(true);
    expect(hit.snippet.map((r: { text: string }) => r.text).join("")).toBe(SLIDES[1]);
  });

  test("kind filter", async () => {
    const { items } = await search(withVectors, me, { q: "ECB", kind: "pdf_page" });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((h) => h.kind === "pdf_page")).toBe(true);
    const transcriptOnly = await search(withVectors, me, { q: "서브키 스케줄", kind: "transcript" });
    expect(transcriptOnly.items.some((h) => h.kind === "pdf_page")).toBe(false);
  });

  test("recording filter", async () => {
    const { status, items } = await search(lexicalOnly, me, { q: "서브키 스케줄", recording_id: lectureRecordingId(meeting.id) });
    expect(status).toBe(200);
    expect(items).toEqual([]);
  });

  test("other users see nothing", async () => {
    expect((await search(withVectors, other, { q: "서브키" })).status).toBe(403);
  });

  test("title match", async () => {
    const { items } = await search(lexicalOnly, me, { q: "회의" });
    expect(items[0]).toMatchObject({ kind: "recording", recording_id: lectureRecordingId(meeting.id), recording_title: "주간 회의" });
    const recordingsOnly = await search(withVectors, me, { q: "회의", kind: "recording" });
    expect(recordingsOnly.items.map((h) => h.kind)).toEqual(["recording"]);
  });

  test("0 hits", async () => {
    expect((await search(lexicalOnly, me, { q: "zzzqqq" })).items).toEqual([]);
  });

  test("legacy document block id", async () => {
    const { items } = await search(lexicalOnly, me, { q: "드러나서", kind: "document" });
    const hit = items[0]!;
    expect(hit.block_id).toMatch(/^md-\d+$/);
    expect(hit.document_id).toBe(lectureDocumentId(lecture.id));
    const md = (
      db
        .query(`SELECT v.rendered_md FROM document d JOIN document_version v ON v.document_id = d.id AND v.version = d.current_version WHERE d.id = ?`)
        .get(hit.document_id) as { rendered_md: string }
    ).rendered_md;
    expect(markdownParagraphs(md)[Number(hit.block_id.slice(3))]).toContain("드러나서");
  });

  test("ASK off falls back", async () => {
    const { status, items } = await search(null, me, { q: "체이닝" });
    expect(status).toBe(200);
    expect(items.map((h) => h.kind)).toEqual(["transcript"]);
    const doc = await search(null, me, { q: "드러나서" });
    expect(doc.items.some((h) => h.kind === "document")).toBe(true);
    expect((await search(null, me, { q: "서브키" })).items.some((h) => h.kind === "pdf_page")).toBe(false);
  });

  test("reconcile does not requeue pdf chunks", () => {
    reconcileAskIndex(withVectors);
    const queued = db.query(`SELECT COUNT(*) AS n FROM job WHERE kind = 'index' AND subject_id IN (?, ?) AND state = 'queued'`).get(lecture.id, meeting.id) as {
      n: number;
    };
    expect(queued.n).toBe(0);
    setPdf(false);
    try {
      reconcileAskIndex(withVectors);
      const again = db.query(`SELECT COUNT(*) AS n FROM job WHERE kind = 'index' AND subject_id = ? AND state = 'queued'`).get(lecture.id) as { n: number };
      expect(again.n).toBe(0);
    } finally {
      setPdf(true);
    }
  });

  test("index includes pdf only when flag on", async () => {
    const third = makeLecture(me, "네트워크 3주차", "네트워크", "# 네트워크 3주차\n\nTCP 혼잡 제어를 다룬다.\n");
    attachPdf(third, ["슬로 스타트와 혼잡 회피 그래프 슬라이드 설명"]);
    const pdfChunks = () => (db.query(`SELECT COUNT(*) AS n FROM search_chunk WHERE recording_id = ? AND kind = 'pdf_page'`).get(third.id) as { n: number }).n;
    setPdf(false);
    try {
      await indexLecture(third.id, { jobId: `job_off_${third.id}` });
      expect(pdfChunks()).toBe(0);
    } finally {
      setPdf(true);
    }
    await indexLecture(third.id, { jobId: `job_on_${third.id}` });
    expect(pdfChunks()).toBe(1);
  });
});
