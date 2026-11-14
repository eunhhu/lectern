import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeAll, describe, expect, test } from "bun:test";
import { AskStreamEvent, AskThread, AskThreadDetail } from "@lectern/domain";
import { FakeEmbedder } from "@lectern/ask";
import { functionCallPart, GeminiAskModel, scriptedGeminiFetch, type ScriptedGeminiStep, type SeenGeminiRequest, textPart } from "@lectern/harness";
import { createApiV2App } from "../src/api/v2/index.ts";
import { indexLecture } from "../src/ask/index-job.ts";
import { personalWorkspaceId } from "../src/ask/legacy.ts";
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

// The 물어보기 tool loop over HTTP (P3-07, D-P3-6): the ask route, the runner and the real
// Gemini adapter against scriptedGeminiFetch. The thought signature of a function-call turn
// goes back verbatim, the round cap holds, the cost of each round lands in ai_call, and an
// upstream failure ends the turn. No request leaves the process.

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

const MODEL = "gemini-3.5-flash-lite";
const SIGNATURE = "c2lnbmF0dXJl";
const embedder = new FakeEmbedder(64);

let me: UserRecord;
let lecture: LectureRecord;
let meeting: LectureRecord;
const ws = () => personalWorkspaceId(me.id);

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

function service(steps: ScriptedGeminiStep[], seen: SeenGeminiRequest[]): AskService {
  const model = new GeminiAskModel(MODEL, { apiKey: () => "test-key", fetch: scriptedGeminiFetch(steps, seen) });
  return createAskService({ model, embedder, monthlyLimitMicrousd: 2_000_000 });
}

async function call(svc: AskService, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "X-Lectern-Token": me.api_token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return createApiV2App({ askService: () => svc }).request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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

async function ask(svc: AskService, scope: unknown, question: string) {
  const created = await call(svc, "POST", "/ask/threads", { workspace_id: ws(), scope });
  expect(created.status).toBe(201);
  const thread = AskThread.parse(await created.json());
  const res = await call(svc, "POST", `/ask/threads/${thread.id}/turns`, { question });
  return { thread, status: res.status, events: res.status === 200 ? parseSse(await res.text()) : [] };
}

/** The label of the `[cN]` block containing `needle` in `text`, if any. */
function labelIn(text: string, needle: string): string | null {
  const block = text.split("\n\n").find((b) => b.startsWith("[c") && b.includes(needle));
  return block ? /^\[(c\d+)\]/.exec(block)![1]! : null;
}

/** The passages the request carries: the context, then every tool result, newest last. */
function passagesOf(body: any): string[] {
  const out: string[] = [body.contents[0].parts[0].text];
  for (const content of body.contents.slice(1)) {
    for (const part of content.parts) if (part.functionResponse) out.push(String(part.functionResponse.response.result));
  }
  return out;
}

/**
 * Cites the newest passage containing `needle` (the last tool result first). The
 * two-lecture workspace is small enough that the first context holds every chunk, so a
 * search adds nothing new ("결과 없음") and the label comes from the context; the runner
 * tests cover passages a tool adds.
 */
function citing(body: any, needle: string, sentence: string): string {
  for (const text of passagesOf(body).reverse()) {
    const label = labelIn(text, needle);
    if (label) return `${sentence} [${label}].`;
  }
  throw new Error(`no passage with ${needle}`);
}

const searchQa: ScriptedGeminiStep = () => ({
  parts: [functionCallPart("search_notes", { query: "QA 일정 결정" }, { id: "fc1", thoughtSignature: SIGNATURE })],
});
const answerQa: ScriptedGeminiStep = (body) => ({ parts: [textPart(citing(body, "QA를", "QA를 일주일 당기기로 했습니다"))] });
const answerEcb: ScriptedGeminiStep = (body) => ({ parts: [textPart(citing(body, "패턴이", "패턴이 드러나서 위험합니다"))] });

const toolStates = (events: AskStreamEvent[]) => events.filter((e) => e.type === "tool").map((e) => (e.type === "tool" ? e.state : null));
const askCalls = () =>
  (db.query(`SELECT COUNT(*) AS n FROM ai_call WHERE workspace_id = ? AND model = ? AND job_id IS NULL`).get(ws(), MODEL) as { n: number }).n;

/** One workspace question that searches once and answers from the tool result, run once for the tests below. */
let flow: Promise<{ seen: SeenGeminiRequest[]; status: number; events: AskStreamEvent[]; ledgerRows: number }> | null = null;
function workspaceFlow() {
  flow ??= (async () => {
    const seen: SeenGeminiRequest[] = [];
    const before = askCalls();
    const { status, events } = await ask(service([searchQa, answerQa], seen), { kind: "workspace" }, "ECB가 위험한 이유는 패턴 때문이야?");
    return { seen, status, events, ledgerRows: askCalls() - before };
  })();
  return flow;
}

beforeAll(async () => {
  me = createUser({ email: `${generateId("tools")}@test.local`, displayName: "tools", password: "correct_password_1", role: "member" });
  lecture = makeLecture(me, "정보보호 7주차", "정보보호", LECTURE_MD);
  meeting = makeLecture(me, "주간 회의", "업무", MEETING_MD);
  for (const l of [lecture, meeting]) await indexLecture(l.id, { jobId: `job_${l.id}`, embedder });
});

describe("ask tool loop over HTTP", () => {
  test("workspace question uses tool end to end", async () => {
    const { status, events } = await workspaceFlow();
    expect(status).toBe(200);
    expect(toolStates(events)).toEqual(["started", "finished"]);
    const done = events.at(-1)!;
    if (done.type !== "turn.completed") throw new Error(`no completion: ${JSON.stringify(done)}`);
    expect(done.turn.outcome).toBe("answered");
    expect(done.turn.citations.some((c) => (c.recording_id as string) === meeting.id)).toBe(true);
  });

  test("signature is resent verbatim", async () => {
    const { seen } = await workspaceFlow();
    const contents = seen[1]!.body.contents;
    const modelAt = contents.findIndex((c: { role: string }) => c.role === "model");
    expect(contents[modelAt].parts).toEqual([
      { functionCall: { id: "fc1", name: "search_notes", args: { query: "QA 일정 결정" } }, thoughtSignature: SIGNATURE },
    ]);
    expect(contents[modelAt + 1].role).toBe("user");
    expect(contents[modelAt + 1].parts[0].functionResponse).toMatchObject({ id: "fc1", name: "search_notes" });
  });

  test("exactly two upstream requests", async () => {
    const { seen } = await workspaceFlow();
    expect(seen.length).toBe(2);
    for (const req of seen) {
      expect(req.url).not.toContain("test-key");
      expect(req.headers["x-goog-api-key"]).toBe("test-key");
    }
  });

  test("cost lands in ai_call", async () => {
    const { ledgerRows } = await workspaceFlow();
    expect(ledgerRows).toBe(2);
  });

  test("folder question uses tools", async () => {
    const folder = db.query(`SELECT folder_id FROM recording WHERE id = ?`).get(lecture.id) as { folder_id: string | null };
    expect(folder.folder_id).not.toBeNull();
    const seen: SeenGeminiRequest[] = [];
    const { events } = await ask(service([answerEcb], seen), { kind: "folder", folder_id: folder.folder_id, include_subfolders: true }, "ECB가 왜 위험해?");
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", turn: { outcome: "answered" } });
    expect(seen[0]!.body.tools[0].functionDeclarations.map((d: { name: string }) => d.name)).toEqual(["search_notes", "read_more"]);
  });

  test("note question has no tools", async () => {
    const seen: SeenGeminiRequest[] = [];
    const { events } = await ask(service([answerEcb], seen), { kind: "recording", recording_id: lecture.id }, "ECB가 왜 위험해?");
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", turn: { outcome: "answered" } });
    expect(seen.length).toBe(1);
    expect(seen[0]!.body.tools).toBeUndefined();
    expect(seen[0]!.body.toolConfig).toBeUndefined();
  });

  test("upstream failure ends the turn", async () => {
    const seen: SeenGeminiRequest[] = [];
    const svc = service([() => new Response("overloaded", { status: 503 })], seen);
    const { thread, status, events } = await ask(svc, { kind: "workspace" }, "ECB 모드는 왜 쓰면 안 돼?");
    expect(status).toBe(200);
    expect(seen.length).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "unavailable" } });
    const detail = AskThreadDetail.parse(await (await call(svc, "GET", `/ask/threads/${thread.id}`)).json());
    expect(detail.turns.at(-1)).toMatchObject({ status: "failed", error: { code: "unavailable" } });
  });

  test("third tool call is ignored over http", async () => {
    const seen: SeenGeminiRequest[] = [];
    const readMore: ScriptedGeminiStep = () => ({ parts: [functionCallPart("search_notes", { query: "출시일 확정" }, { id: "fc2", thoughtSignature: "c2lnMg==" })] });
    const callAndAnswer: ScriptedGeminiStep = (body) => ({
      parts: [functionCallPart("search_notes", { query: "시험 범위" }, { id: "fc3" }), textPart(citing(body, "QA를", "QA를 일주일 당기기로 했습니다"))],
    });
    const { events } = await ask(service([searchQa, readMore, callAndAnswer], seen), { kind: "workspace" }, "ECB 패턴 문제를 다시 설명해 줘");
    expect(seen.length).toBe(3);
    expect(seen[2]!.body.tools).toBeUndefined();
    expect(toolStates(events)).toEqual(["started", "finished", "started", "finished"]);
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", turn: { outcome: "answered" } });
  });
});
