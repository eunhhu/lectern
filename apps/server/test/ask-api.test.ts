import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeAll, describe, expect, test } from "bun:test";
import { ApiError, AskStreamEvent, AskThread, AskThreadDetail, AskThreadPage, AskUsage } from "@lectern/domain";
import { type AskModel, type AskModelEvent, type AskModelRequest, FakeEmbedder, syncRecordingChunks } from "@lectern/ask";
import { createApiV2App } from "../src/api/v2/index.ts";
import { indexLecture, reconcileAskIndex, runAskUpkeep } from "../src/ask/index-job.ts";
import { lectureDocumentId, personalWorkspaceId } from "../src/ask/legacy.ts";
import { createAskService, type AskService } from "../src/ask/service.ts";
import {
  completeLectureRecord,
  createPendingLecture,
  createSession,
  createUser,
  db,
  deleteLectureById,
  generateId,
  onLectureContentChanged,
  updateLectureMarkdown,
  type LectureRecord,
  type UserRecord,
} from "../src/db.ts";

// /api/v2/ask enabled, over real v1 lectures, with a scripted model and the deterministic
// fake embedder from @lectern/ask. No provider is called.

const LECTURE_MD = `# 정보보호 7주차

## 운영 모드
[12:03] ECB는 같은 평문 블록을 같은 암호문으로 바꿔 패턴이 드러나서 위험하다.
[14:40] CBC는 IV가 필요하고 IV는 예측할 수 없어야 한다.

## 시험
[1:02:40] 시험 범위는 운영 모드까지이고 CBC 복호화 그림이 꼭 나온다.
`;

const MEETING_MD = `# 주간 회의

## 결정
- 출시일은 11월 3일로 확정했다.
- QA를 일주일 당기기로 했다.
`;

/** Answers by citing the passage that contains `needle`. */
class CitingModel implements AskModel {
  readonly provider = "gemini";
  readonly model = "gemini-3.5-flash-lite";
  calls = 0;
  constructor(private needle: string, private sentence: string) {}
  async *stream(req: AskModelRequest): AsyncIterable<AskModelEvent> {
    this.calls++;
    const block = req.context.split("\n\n").find((b) => b.startsWith("[c") && b.includes(this.needle));
    const label = block ? /^\[(c\d+)\]/.exec(block)![1] : null;
    yield { type: "text", text: label ? `${this.sentence} [${label}].` : "[[모름]] 노트에 없습니다." };
    yield { type: "done", usage: { inputTokens: 2_000, cachedTokens: 0, outputTokens: 100 }, finish: "stop", requestId: "r1" };
  }
}

let me: UserRecord;
let other: UserRecord;
let lecture: LectureRecord;
let meeting: LectureRecord;
const embedder = new FakeEmbedder(64);

function user(): UserRecord {
  return createUser({ email: `${generateId("ask")}@test.local`, displayName: "ask", password: "correct_password_1", role: "member" });
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
  return completeLectureRecord(id, { title, courseName: course, markdown, excerpt: "", modelUsed: "gemini-3.8-flash", durationSec: 3600 });
}

function service(model: AskModel, monthlyLimitMicrousd = 2_000_000): AskService {
  return createAskService({ model, embedder, monthlyLimitMicrousd });
}

function app(svc: AskService | null) {
  return createApiV2App({ askService: () => svc });
}

const auth = (u: UserRecord) => ({ "X-Lectern-Token": u.api_token });

async function call(svc: AskService | null, u: UserRecord, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...auth(u), ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return app(svc).request(path, init);
}

function parseSse(text: string): AskStreamEvent[] {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("event: "))
    .map((block) => {
      const [eventLine, dataLine] = block.split("\n");
      const event = AskStreamEvent.parse(JSON.parse(dataLine!.slice("data: ".length)));
      expect(eventLine).toBe(`event: ${event.type}`);
      return event;
    });
}

async function newThread(svc: AskService, u: UserRecord, scope: unknown, workspaceId = personalWorkspaceId(u.id)) {
  const res = await call(svc, u, "POST", "/ask/threads", { workspace_id: workspaceId, scope });
  expect(res.status).toBe(201);
  return AskThread.parse(await res.json());
}

async function ask(svc: AskService, u: UserRecord, threadId: string, question: string, headers: Record<string, string> = {}) {
  const res = await call(svc, u, "POST", `/ask/threads/${threadId}/turns`, { question }, headers);
  return { res, events: res.status === 200 ? parseSse(await res.text()) : [] };
}

beforeAll(async () => {
  me = user();
  other = user();
  lecture = makeLecture(me, "정보보호 7주차", "정보보호", LECTURE_MD);
  meeting = makeLecture(me, "주간 회의", "업무", MEETING_MD);
  for (const l of [lecture, meeting]) await indexLecture(l.id, { jobId: `job_${l.id}`, embedder });
});

describe("ask routes", () => {
  test("answer 501 while LECTERN_ASK is off", async () => {
    const res = await call(null, me, "POST", "/ask/threads", { workspace_id: personalWorkspaceId(me.id), scope: { kind: "workspace" } });
    expect(res.status).toBe(501);
    expect(ApiError.parse(await res.json()).error.code).toBe("not_implemented");
  });

  test("a note question streams an answer citing the lecture's Markdown", async () => {
    const model = new CitingModel("시험 범위", "시험 범위는 운영 모드까지입니다");
    const svc = service(model);
    const thread = await newThread(svc, me, { kind: "recording", recording_id: lecture.id });
    expect(thread.workspace_id as string).toBe(personalWorkspaceId(me.id));
    const { res, events } = await ask(svc, me, thread.id, "시험 범위가 어디까지야?");
    expect(res.headers.get("content-type")).toStartWith("text/event-stream");
    expect(events.map((e) => e.type)).toEqual(["turn.started", "retrieval", "answer.delta", "citation", "turn.completed"]);
    expect(events[1]).toMatchObject({ mode: "full_note", recording_count: 1 });
    const done = events.at(-1)!;
    if (done.type !== "turn.completed") throw new Error("no completion");
    expect(done.turn).toMatchObject({ outcome: "answered", status: "completed" });
    expect(done.turn.cost_microusd).toBe(Math.round(2_000 * 0.3 + 100 * 2.5));
    expect(done.turn.citations[0]).toMatchObject({
      kind: "document",
      recording_id: lecture.id,
      recording_title: "정보보호 7주차",
      document_id: lectureDocumentId(lecture.id),
      block_id: null,
      section_title: "정보보호 7주차",
      start_ms: 3_760_000,
      support: "supported",
    });

    const detail = AskThreadDetail.parse(await (await call(svc, me, "GET", `/ask/threads/${thread.id}`)).json());
    expect(detail.thread.title).toBe("시험 범위가 어디까지야?");
    expect(detail.turns.map((t) => t.answer)).toEqual([done.turn.answer]);
    const listed = AskThreadPage.parse(await (await call(svc, me, "GET", `/ask/threads?workspace_id=${personalWorkspaceId(me.id)}&recording_id=${lecture.id}`)).json());
    expect(listed.items.map((t) => t.id)).toContain(thread.id);
    const usage = AskUsage.parse(await (await call(svc, me, "GET", `/ask/usage?workspace_id=${personalWorkspaceId(me.id)}`)).json());
    expect(usage.spent_microusd).toBeGreaterThanOrEqual(done.turn.cost_microusd);
    // The model call landed in the cost ledger, attributed to the workspace.
    const row = db.query(`SELECT COUNT(*) AS n FROM ai_call WHERE workspace_id = ? AND model = 'gemini-3.5-flash-lite'`).get(personalWorkspaceId(me.id)) as { n: number };
    expect(row.n).toBeGreaterThan(0);
  });

  test("a whole-workspace question searches every lecture; unanswerable ones cost nothing", async () => {
    const model = new CitingModel("11월 3일", "출시일은 11월 3일입니다");
    const svc = service(model);
    const thread = await newThread(svc, me, { kind: "workspace" });
    const { events } = await ask(svc, me, thread.id, "출시일이 언제로 확정됐어?");
    const done = events.at(-1)!;
    expect(done.type === "turn.completed" ? (done.turn.citations[0]!.recording_id as string) : null).toBe(meeting.id);
    const before = model.calls;
    const none = await ask(svc, me, thread.id, "양자역학의 불확정성 원리는?");
    expect(model.calls).toBe(before);
    expect(none.events.at(-1)).toMatchObject({ type: "turn.completed", turn: { outcome: "no_answer", cost_microusd: 0 } });
  });

  test("other users see nothing: their threads, notes and workspaces stay apart", async () => {
    const svc = service(new CitingModel("시험", "x"));
    const mine = await newThread(svc, me, { kind: "workspace" });
    expect((await call(svc, other, "GET", `/ask/threads/${mine.id}`)).status).toBe(404);
    expect((await ask(svc, other, mine.id, "시험 범위는?")).res.status).toBe(404);
    const res = await call(svc, other, "POST", "/ask/threads", { workspace_id: personalWorkspaceId(other.id), scope: { kind: "recording", recording_id: lecture.id } });
    expect(res.status).toBe(404);
    expect((await call(svc, other, "POST", "/ask/threads", { workspace_id: personalWorkspaceId(me.id), scope: { kind: "workspace" } })).status).toBe(403);
    expect((await call(svc, me, "GET", `/ask/threads?workspace_id=0199f0a0-1000-7000-8000-000000000002`)).status).toBe(403);
    // Their own workspace has no lectures: nothing to find, no model call.
    const model = new CitingModel("시험", "x");
    const theirs = await newThread(service(model), other, { kind: "workspace" });
    const { events } = await ask(service(model), other, theirs.id, "시험 범위가 어디까지야?");
    expect(events[1]).toMatchObject({ type: "retrieval", passage_count: 0 });
    expect(model.calls).toBe(0);
  });

  test("the monthly budget and a cross-site cookie stop a question before the stream", async () => {
    const svc = service(new CitingModel("시험 범위", "답"), 1);
    const thread = await newThread(svc, me, { kind: "recording", recording_id: lecture.id });
    const quota = await ask(svc, me, thread.id, "시험 범위?");
    expect(quota.res.status).toBe(429);
    expect(ApiError.parse(await quota.res.json()).error.code).toBe("quota_exceeded");

    const open = service(new CitingModel("시험 범위", "답"));
    const cookie = { Cookie: `lectern_session=${encodeURIComponent(createSession(me.id))}`, "Sec-Fetch-Site": "cross-site" };
    const res = await app(open).request(`/ask/threads/${thread.id}/turns`, {
      method: "POST",
      headers: { ...cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ question: "시험 범위?" }),
    });
    expect(res.status).toBe(403);
  });

  test("an Idempotency-Key replays the stored answer instead of asking again", async () => {
    const model = new CitingModel("CBC는 IV", "CBC는 IV가 필요합니다");
    const svc = service(model);
    const thread = await newThread(svc, me, { kind: "recording", recording_id: lecture.id });
    const first = await ask(svc, me, thread.id, "CBC에 뭐가 필요해?", { "Idempotency-Key": "k-1" });
    const second = await ask(svc, me, thread.id, "CBC에 뭐가 필요해?", { "Idempotency-Key": "k-1" });
    expect(model.calls).toBe(1);
    expect(second.events.map((e) => e.type)).toEqual(["turn.started", "turn.completed"]);
    expect(second.events.at(-1)).toEqual(first.events.at(-1)!);
  });
});

test("replaying a failed question ends with an error event, not a completion", async () => {
  const broken: AskModel = {
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error("Gemini request failed (503): overloaded");
    },
  };
  const svc = service(broken);
  const thread = await newThread(svc, me, { kind: "recording", recording_id: lecture.id });
  const first = await ask(svc, me, thread.id, "시험 범위는?", { "Idempotency-Key": "k-fail" });
  expect(first.events.at(-1)).toMatchObject({ type: "error", error: { code: "unavailable" } });
  const again = await ask(svc, me, thread.id, "시험 범위는?", { "Idempotency-Key": "k-fail" });
  expect(again.events.map((e) => e.type)).toEqual(["turn.started", "error"]);
});

describe("index upkeep and deletion", () => {
  test("a Markdown edit notifies listeners; reconciliation queues stale lectures and drops orphans", async () => {
    const seen: string[] = [];
    onLectureContentChanged((id) => seen.push(id));
    const l = makeLecture(me, "임시", "기타", "# 임시\n\n첫 내용");
    expect(seen).toContain(l.id);
    await indexLecture(l.id, { jobId: `job_${l.id}`, embedder });
    updateLectureMarkdown(l.id, "임시", "기타", "# 임시\n\n바뀐 내용");
    expect(seen.filter((id) => id === l.id).length).toBe(2);

    const ws = personalWorkspaceId(me.id);
    syncRecordingChunks(db, {
      workspaceId: ws,
      recordingId: "gone-lecture",
      kinds: ["document"],
      chunks: [],
    });
    db.query(
      `INSERT INTO search_chunk (id, workspace_id, recording_id, kind, locator, ordinal, text, content_sha256, tokens, chunker_version, created_at)
       VALUES ('chk_orphan', ?, 'gone-lecture', 'document', 'm:0', 0, '고아', 'x', 1, 1, 0)`,
    ).run(ws);
    const res = reconcileAskIndex(service(new CitingModel("x", "x")));
    expect(res.removed).toBe(1);
    const job = db.query(`SELECT kind, state FROM job WHERE kind = 'index' AND subject_id = ?`).get(l.id) as { kind: string; state: string } | null;
    expect(job).toMatchObject({ kind: "index", state: "queued" });
    expect(runAskUpkeep(null)).toEqual({ queued: 0, removed: 0, staleTurns: 0 });
  });

  test("deleting a lecture deletes its index and note threads, and hides it in other threads", async () => {
    const svc = service(new CitingModel("출시일", "출시일은 11월 3일입니다"));
    const noteThread = await newThread(svc, me, { kind: "recording", recording_id: meeting.id });
    const wideThread = await newThread(svc, me, { kind: "workspace" });
    await ask(svc, me, wideThread.id, "출시일이 언제야?");
    deleteLectureById(meeting.id);
    expect((await call(svc, me, "GET", `/ask/threads/${noteThread.id}`)).status).toBe(404);
    const detail = AskThreadDetail.parse(await (await call(svc, me, "GET", `/ask/threads/${wideThread.id}`)).json());
    expect(detail.turns[0]!.citations[0]).toMatchObject({ recording_id: meeting.id, available: false, snippet: "" });
    expect(db.query(`SELECT COUNT(*) AS n FROM search_chunk WHERE recording_id = ?`).get(meeting.id)).toEqual({ n: 0 });
  });
});
