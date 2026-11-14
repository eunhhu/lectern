import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeAll, describe, expect, test } from "bun:test";
import {
  type AccessScope,
  type AskModel,
  type AskModelEvent,
  type AskModelRequest,
  FakeEmbedder,
  isScopeError,
  resolveAccessScope,
} from "@lectern/ask";
import { AskStreamEvent } from "@lectern/domain";
import { roleIn } from "../src/api/v2/access.ts";
import { createApiV2App } from "../src/api/v2/index.ts";
import { indexLecture } from "../src/ask/index-job.ts";
import { folderRows, personalWorkspaceId, recordingRows } from "../src/ask/legacy.ts";
import { listItemsSource } from "../src/ask/list-items.ts";
import { createAskService } from "../src/ask/service.ts";
import { completeLectureRecord, createPendingLecture, createUser, db, generateId, type UserRecord } from "../src/db.ts";

// The ask `list_items` tool's data (P4-06, D-P4-8): events and action items by period, only
// from recordings the thread may read.

const at = (iso: string) => Date.parse(iso);

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

function seedRecording(workspaceId: string, owner: UserRecord, opts: { title?: string; visibility?: "private" | "workspace" } = {}): string {
  const id = generateId("rec");
  const now = Date.now();
  db.query(
    `INSERT INTO recording (id, workspace_id, folder_id, title, recorded_at, recorded_at_source, status, created_by, visibility, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, 'upload', 'ready', ?, ?, ?, ?)`,
  ).run(id, workspaceId, opts.title ?? "자료구조 7주차", now, owner.id, opts.visibility ?? "private", now, now);
  return id;
}

function insertEvent(workspaceId: string, recordingId: string, opts: { startAt: number; status?: string; title?: string; allDay?: boolean }): string {
  const id = generateId("evc");
  const now = Date.now();
  db.query(
    `INSERT INTO event_candidate (id, workspace_id, recording_id, kind, title, start_at, end_at, all_day, tz, raw_expression,
       resolution_json, confidence, evidence_json, flags_json, status, created_at, updated_at)
     VALUES (?, ?, ?, 'exam', ?, ?, NULL, ?, 'Asia/Seoul', '다음 주', '{"method":"parser","rule":"x"}', 0.9, '{}', '[]', ?, ?, ?)`,
  ).run(id, workspaceId, recordingId, opts.title ?? "중간고사", opts.startAt, opts.allDay ? 1 : 0, opts.status ?? "accepted", now, now);
  return id;
}

function insertItem(workspaceId: string, recordingId: string, opts: { text: string; dueAt: number | null; status?: string }): string {
  const id = generateId("act");
  const now = Date.now();
  db.query(
    `INSERT INTO action_item (id, workspace_id, recording_id, text, owner_name, due_at, due_raw, status, evidence_json, flags_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, '{}', '[]', ?, ?)`,
  ).run(id, workspaceId, recordingId, opts.text, opts.dueAt, opts.status ?? "open", now, now);
  return id;
}

/** The AccessScope ask resolves for `user` (ask.ts accessFor, any workspace). */
function accessFor(user: UserRecord, workspaceId: string, scope: unknown = { kind: "workspace" }): AccessScope {
  const access = resolveAccessScope({
    workspaceId,
    caller: { userId: user.id, role: roleIn(user.id, workspaceId) },
    scope: scope as never,
    recordings: recordingRows(workspaceId),
    folders: folderRows(workspaceId),
  });
  if (isScopeError(access)) throw new Error(access.message);
  return access;
}

/** A user with a personal workspace holding one recording. */
function setup() {
  const user = makeUser("items");
  const workspaceId = personalWorkspaceId(user.id);
  const recordingId = seedRecording(workspaceId, user);
  return { user, workspaceId, recordingId };
}

const lines = (out: string) => out.split("\n");

describe("list_items source", () => {
  test("events inside the range", async () => {
    const { user, workspaceId, recordingId } = setup();
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-20T06:00:00Z"), title: "퀴즈" });
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-27T06:00:00Z"), title: "중간고사" });
    insertEvent(workspaceId, recordingId, { startAt: at("2026-11-05T06:00:00Z"), title: "발표" });
    const out = await listItemsSource(accessFor(user, workspaceId), { kind: "events", from: "2026-10-26", to: "2026-11-01" });
    expect(lines(out)).toHaveLength(1);
    expect(out).toContain("중간고사");
  });

  test("to is inclusive of the whole day", async () => {
    const { user, workspaceId, recordingId } = setup();
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-27T23:30:00+09:00"), title: "마감 직전" });
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-28T00:00:00+09:00"), title: "다음 날" });
    const out = await listItemsSource(accessFor(user, workspaceId), { kind: "events", from: "2026-10-27", to: "2026-10-27" });
    expect(out).toContain("마감 직전");
    expect(out).not.toContain("다음 날");
  });

  test("dismissed events are left out", async () => {
    const { user, workspaceId, recordingId } = setup();
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-27T06:00:00Z"), status: "dismissed", title: "무시함" });
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-28T06:00:00Z"), status: "suggested", title: "제안됨" });
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-29T06:00:00Z"), status: "synced", title: "등록됨" });
    const out = await listItemsSource(accessFor(user, workspaceId), { kind: "events" });
    expect(out).not.toContain("무시함");
    expect(out).toContain("상태: 제안)");
    expect(out).toContain("상태: 캘린더에 있음)");
  });

  test("action items: open only", async () => {
    const { user, workspaceId, recordingId } = setup();
    insertItem(workspaceId, recordingId, { text: "과제 제출", dueAt: at("2026-10-27T00:00:00+09:00") });
    insertItem(workspaceId, recordingId, { text: "끝낸 일", dueAt: at("2026-10-26T00:00:00+09:00"), status: "done" });
    const out = await listItemsSource(accessFor(user, workspaceId), { kind: "action_items" });
    expect(lines(out)).toEqual([`- [할 일] 마감 2026-10-27 과제 제출 (녹음: 자료구조 7주차) #rec:${recordingId}`]);
  });

  test("action items without a due date", async () => {
    const { user, workspaceId, recordingId } = setup();
    insertItem(workspaceId, recordingId, { text: "언젠가 할 일", dueAt: null });
    insertItem(workspaceId, recordingId, { text: "보고서", dueAt: at("2026-10-27T18:00:00+09:00") });
    const all = await listItemsSource(accessFor(user, workspaceId), { kind: "action_items" });
    expect(lines(all)).toEqual([
      `- [할 일] 마감 2026-10-27 18:00 보고서 (녹음: 자료구조 7주차) #rec:${recordingId}`,
      `- [할 일] 마감 없음 언젠가 할 일 (녹음: 자료구조 7주차) #rec:${recordingId}`,
    ]);
    const ranged = await listItemsSource(accessFor(user, workspaceId), { kind: "action_items", from: "2026-10-01", to: "2026-10-31" });
    expect(ranged).toContain("보고서");
    expect(ranged).not.toContain("언젠가");
  });

  test("private recordings of others", async () => {
    const a = makeUser("a");
    const b = makeUser("b");
    const workspaceId = `wsp_${generateId("team")}`;
    const now = Date.now();
    db.query(`INSERT INTO workspace (id, name, kind, plan, settings_json, personal_user_id, created_at, updated_at) VALUES (?, '팀', 'team', 'free', '{}', NULL, ?, ?)`).run(
      workspaceId,
      now,
      now,
    );
    for (const [u, role] of [[a, "owner"], [b, "member"]] as const) {
      db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(workspaceId, u.id, role, now, now);
    }
    const bPrivate = seedRecording(workspaceId, b, { title: "B 비공개" });
    const bShared = seedRecording(workspaceId, b, { title: "B 공유", visibility: "workspace" });
    insertEvent(workspaceId, bPrivate, { startAt: at("2026-10-27T06:00:00Z"), title: "비밀 일정" });
    insertItem(workspaceId, bPrivate, { text: "비밀 할 일", dueAt: null });
    insertEvent(workspaceId, bShared, { startAt: at("2026-10-28T06:00:00Z"), title: "공유 일정" });
    const events = await listItemsSource(accessFor(a, workspaceId), { kind: "events" });
    expect(events).toContain("공유 일정");
    expect(events).not.toContain("비밀");
    expect(await listItemsSource(accessFor(a, workspaceId), { kind: "action_items" })).toBe("해당 기간에 항목이 없습니다.");
    // B sees their own private recording's items.
    expect(await listItemsSource(accessFor(b, workspaceId), { kind: "events" })).toContain("비밀 일정");
  });

  test("recording-scoped access", async () => {
    const { user, workspaceId, recordingId } = setup();
    const otherRecording = seedRecording(workspaceId, user, { title: "다른 녹음" });
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-27T06:00:00Z"), title: "이 녹음" });
    insertEvent(workspaceId, otherRecording, { startAt: at("2026-10-28T06:00:00Z"), title: "저 녹음" });
    const access = accessFor(user, workspaceId, { kind: "recording", recording_id: recordingId });
    const out = await listItemsSource(access, { kind: "events" });
    expect(out).toContain("이 녹음");
    expect(out).not.toContain("저 녹음");
  });

  test("empty", async () => {
    const { user, workspaceId } = setup();
    expect(await listItemsSource(accessFor(user, workspaceId), { kind: "events", from: "2026-10-01", to: "2026-10-31" })).toBe("해당 기간에 항목이 없습니다.");
    expect(await listItemsSource(accessFor(user, workspaceId), { kind: "action_items" })).toBe("해당 기간에 항목이 없습니다.");
  });

  test("bad dates are ignored", async () => {
    const { user, workspaceId, recordingId } = setup();
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-27T06:00:00Z") });
    const out = await listItemsSource(accessFor(user, workspaceId), { kind: "events", from: "어제", to: "2026-13-45" });
    expect(lines(out)).toHaveLength(1);
  });

  test("line format", async () => {
    const { user, workspaceId, recordingId } = setup();
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-27T15:00:00+09:00") });
    insertEvent(workspaceId, recordingId, { startAt: at("2026-10-28T00:00:00+09:00"), title: "개교기념일", allDay: true });
    const out = lines(await listItemsSource(accessFor(user, workspaceId), { kind: "events" }));
    expect(out[0]!).toStartWith("- [일정] 2026-10-27 15:00 중간고사 (녹음: 자료구조 7주차, 상태: 수락됨) #rec:");
    expect(out[0]!).toBe(`- [일정] 2026-10-27 15:00 중간고사 (녹음: 자료구조 7주차, 상태: 수락됨) #rec:${recordingId}`);
    expect(out[1]!).toBe(`- [일정] 2026-10-28 개교기념일 (녹음: 자료구조 7주차, 상태: 수락됨) #rec:${recordingId}`);
  });

  test("more than 50 items are cut", async () => {
    const { user, workspaceId, recordingId } = setup();
    for (let i = 0; i < 52; i++) insertEvent(workspaceId, recordingId, { startAt: at("2026-10-01T00:00:00Z") + i * 3_600_000, title: `일정${i}` });
    const out = lines(await listItemsSource(accessFor(user, workspaceId), { kind: "events" }));
    expect(out).toHaveLength(51);
    expect(out.at(-1)).toBe("(이후 항목 생략)");
    expect(out[0]).toContain("일정0 ");
  });
});

/** Calls list_items once, then answers; keeps every request it got. */
class ListingModel implements AskModel {
  readonly provider = "gemini";
  readonly model = "gemini-3.5-flash-lite";
  requests: AskModelRequest[] = [];
  async *stream(req: AskModelRequest): AsyncIterable<AskModelEvent> {
    this.requests.push(req);
    if (this.requests.length === 1) {
      yield { type: "tool_call", id: "t1", name: "list_items", args: { kind: "events", from: "2026-10-26", to: "2026-11-01" } };
      yield { type: "done", usage: { inputTokens: 1_000, cachedTokens: 0, outputTokens: 20 }, finish: "tool_calls", requestId: "r1" };
      return;
    }
    yield { type: "text", text: "[[모름]] 노트에 없습니다." };
    yield { type: "done", usage: { inputTokens: 1_000, cachedTokens: 0, outputTokens: 20 }, finish: "stop", requestId: "r2" };
  }
}

describe("ask service", () => {
  let me: UserRecord;
  let lectureId: string;
  const embedder = new FakeEmbedder(64);

  beforeAll(async () => {
    me = makeUser("svc");
    lectureId = generateId("lec");
    createPendingLecture({
      id: lectureId,
      ownerId: me.id,
      title: "자료구조 7주차",
      course: "자료구조",
      audioPath: "/nonexistent.m4a",
      audioMime: "audio/mp4",
      audioSize: 0,
      modelRequested: "gemini-3.8-flash",
      sourceClient: "web",
    });
    completeLectureRecord(lectureId, {
      title: "자료구조 7주차",
      courseName: "자료구조",
      markdown: "# 자료구조 7주차\n\n## 공지\n[10:00] 중간고사는 다음 주 화요일이다.\n",
      excerpt: "",
      modelUsed: "gemini-3.8-flash",
      durationSec: 3600,
    });
    await indexLecture(lectureId, { jobId: `job_${lectureId}`, embedder });
  });

  // The runner reaches the model (and so the tools) only for a question its retrieval grounds
  // in the notes (packages/ask, P3-07): the question names what the lecture says.
  test("service wires the tool", async () => {
    const workspaceId = personalWorkspaceId(me.id);
    insertEvent(workspaceId, lectureId, { startAt: at("2026-10-27T15:00:00+09:00") });
    const model = new ListingModel();
    const svc = createAskService({ model, embedder, monthlyLimitMicrousd: 2_000_000 });
    expect(svc.deps.listItems).toBe(listItemsSource);
    const app = createApiV2App({ askService: () => svc });
    const headers = { "X-Lectern-Token": me.api_token, "Content-Type": "application/json" };
    const thread = await app.request("/ask/threads", { method: "POST", headers, body: JSON.stringify({ workspace_id: workspaceId, scope: { kind: "workspace" } }) });
    expect(thread.status).toBe(201);
    const { id } = (await thread.json()) as { id: string };
    const turn = await app.request(`/ask/threads/${id}/turns`, { method: "POST", headers, body: JSON.stringify({ question: "중간고사는 언제야?" }) });
    expect(turn.status).toBe(200);
    const events = (await turn.text())
      .split("\n\n")
      .filter((b) => b.startsWith("event: "))
      .map((b) => AskStreamEvent.parse(JSON.parse(b.split("\n")[1]!.slice("data: ".length))));
    expect(events.at(-1)?.type).toBe("turn.completed");
    expect(model.requests[0]!.tools.map((t) => t.name)).toContain("list_items");
    const result = model.requests[1]!.exchanges[0]!.results[0]!;
    expect(result.name).toBe("list_items");
    expect(result.output).toBe(`- [일정] 2026-10-27 15:00 중간고사 (녹음: 자료구조 7주차, 상태: 수락됨) #rec:${lectureId}`);
  });
});
