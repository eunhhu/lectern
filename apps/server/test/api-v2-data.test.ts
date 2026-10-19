import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { courseFolderId, lectureDocumentId, personalWorkspaceId, verifyLegacy } from "@lectern/db";
import { API_BASE_PATH, ServerEvent, versionETag } from "@lectern/domain";
import { PART_SIZE } from "../src/api/v2/uploads.ts";
import {
  completeLectureRecord,
  createPendingLecture,
  createUser,
  DATA_DIR,
  db,
  generateId,
  getLectureById,
  type UserRecord,
} from "../src/db.ts";
import { handleRequest } from "../src/index.ts";

// /api/v2 over real rows: v1 lectures migrated to v2 (packages/db legacy.ts), then read and
// changed through the API, with every change visible to v1 clients as well.

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

interface Res {
  status: number;
  body: any;
  res: Response;
}

async function api(
  method: string,
  path: string,
  user: UserRecord,
  init: { body?: unknown; headers?: Record<string, string>; raw?: Uint8Array } = {}
): Promise<Res> {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token, ...init.headers };
  let body: BodyInit | undefined = init.raw ? new Blob([init.raw as Uint8Array<ArrayBuffer>]) : undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body }));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null, res };
}

async function v1(method: string, path: string, user: UserRecord, body?: unknown): Promise<Res> {
  const res = await handleRequest(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "X-Lectern-Token": user.api_token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
  return { status: res.status, body: await res.json(), res };
}

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

/** A finished v1 lecture with an audio file, as the v1 pipeline leaves it. */
function seedLecture(owner: UserRecord, fields: { title: string; course: string; markdown?: string; done?: boolean }): string {
  const id = generateId("lec");
  const audioPath = join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`);
  writeFileSync(audioPath, `audio of ${fields.title}`);
  createPendingLecture({
    id,
    ownerId: owner.id,
    title: fields.title,
    course: fields.course,
    audioPath,
    audioMime: "audio/mp4",
    audioSize: `audio of ${fields.title}`.length,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "macos-native-menubar",
  });
  if (fields.done !== false) {
    completeLectureRecord(id, {
      title: fields.title,
      courseName: fields.course,
      markdown: fields.markdown ?? `# ${fields.title}\n\n## 핵심\n- [10:15] FCFS 대기 시간\n\n라운드 로빈은 시간 할당량을 쓴다.`,
      excerpt: "FCFS 대기 시간",
      modelUsed: "gemini-3.8-flash",
      durationSec: 3600,
    });
  }
  return id;
}

async function readEvents(res: Response, until: (events: ServerEvent[]) => boolean, timeoutMs = 4_000): Promise<ServerEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: ServerEvent[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline && !until(events)) {
      const chunk = await Promise.race([reader.read(), Bun.sleep(deadline - Date.now()).then(() => null)]);
      if (!chunk || chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const fields = Object.fromEntries(
          block
            .split("\n")
            .filter((line) => line && !line.startsWith(":"))
            .map((line) => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)])
        );
        if (!fields.data) continue;
        const event = ServerEvent.parse(JSON.parse(fields.data));
        expect(fields.id).toBe(event.id);
        expect(fields.event).toBe(event.type);
        events.push(event);
      }
    }
  } finally {
    await reader.cancel();
  }
  return events;
}

let alice: UserRecord;
let bob: UserRecord;
let ws: string;
let osLecture: string;
let processingLecture: string;
let dsLecture: string;

beforeAll(() => {
  alice = makeUser("alice");
  bob = makeUser("bob");
  ws = personalWorkspaceId(alice.id);
  osLecture = seedLecture(alice, { title: "스케줄링", course: "운영체제" });
  processingLecture = seedLecture(alice, { title: "교착 상태", course: "운영체제", done: false });
  dsLecture = seedLecture(alice, { title: "힙 정렬", course: "자료구조", markdown: "# 힙\n\n힙 정렬은 O(n log n)이다." });
  seedLecture(bob, { title: "밥의 강의", course: "운영체제" });
});

describe("migrated lectures through /api/v2", () => {
  test("/me and /workspaces are the caller's real personal workspace", async () => {
    const me = await api("GET", "/me", alice);
    expect(me.body).toMatchObject({ id: alice.id, email: alice.email, personal_workspace_id: ws, timezone: "Asia/Seoul" });
    const list = await api("GET", "/workspaces", alice);
    expect(list.body.items).toEqual([expect.objectContaining({ role: "owner", workspace: expect.objectContaining({ id: ws, kind: "personal" }) })]);
    const members = await api("GET", `/workspaces/${ws}/members`, alice);
    expect(members.body.items.map((m: any) => m.user_id)).toEqual([alice.id]);
    const updated = await api("PATCH", "/me", alice, { body: { timezone: "Europe/Berlin" } });
    expect(updated.body.timezone).toBe("Europe/Berlin");
  });

  test("lectures are recordings in course folders, with legacy documents and audio", async () => {
    const list = await api("GET", `/recordings?workspace_id=${ws}`, alice);
    expect(list.status).toBe(200);
    const byId = new Map(list.body.items.map((r: any) => [r.id, r]));
    expect([...byId.keys()].sort()).toEqual([osLecture, processingLecture, dsLecture].sort());
    expect(byId.get(osLecture)).toMatchObject({
      folder_id: courseFolderId(alice.id, "운영체제"),
      status: "ready",
      domain: "lecture",
      duration_ms: 3_600_000,
      excerpt: "FCFS 대기 시간",
      audio_bytes: "audio of 스케줄링".length,
      pdf_count: 0,
      progress: null,
    });
    expect((byId.get(processingLecture) as any).status).toBe("processing");

    const folders = await api("GET", `/folders?workspace_id=${ws}`, alice);
    expect(folders.body.items.map((f: any) => f.name).sort()).toEqual(["운영체제", "자료구조"]);

    const detail = await api("GET", `/recordings/${osLecture}`, alice);
    expect(detail.body.documents).toEqual([expect.objectContaining({ id: lectureDocumentId(osLecture), template_id: "legacy-markdown", current_version: 1 })]);
    expect(detail.body.assets).toHaveLength(1);
    expect(detail.body.assets[0]).toMatchObject({ kind: "audio", sha256: sha256("audio of 스케줄링"), mime: "audio/mp4" });
    expect(detail.body.assets[0]).not.toHaveProperty("blob_key");
    expect(detail.body.assets[0].meta).toEqual({}); // no storage path leaks
    expect(detail.body.failure).toBeNull();

    const transcript = await api("GET", `/recordings/${osLecture}/transcript`, alice);
    expect(transcript.body).toEqual({ recording_id: osLecture, segments: [], speakers: [], gaps: [] });
  });

  test("documents: ETag, legacy Markdown edits with If-Match, mirrored to v1", async () => {
    const docId = lectureDocumentId(osLecture);
    const doc = await api("GET", `/documents/${docId}`, alice);
    expect(doc.res.headers.get("etag")).toBe(versionETag(1));
    expect(doc.body.version).toMatchObject({ version: 1, body: null, created_by: "ai" });
    expect(doc.body.version.rendered_md).toBe(getLectureById(osLecture)!.markdown);

    const save = (ifMatch: number, body: unknown) =>
      api("POST", `/documents/${docId}/versions`, alice, { body, headers: { "If-Match": versionETag(ifMatch) } });
    expect((await save(1, { body: { sections: [] } })).status).toBe(400); // legacy documents take Markdown
    const saved = await save(1, { markdown: "# 스케줄링\n\n사용자가 고친 노트" });
    expect(saved.status).toBe(201);
    expect(saved.res.headers.get("etag")).toBe(versionETag(2));
    expect(saved.body).toMatchObject({ version: 2, base_version: 1, created_by: "user", author_id: alice.id });
    const stale = await save(1, { markdown: "늦은 수정" });
    expect(stale.status).toBe(412);
    expect(stale.body.error).toMatchObject({ code: "precondition_failed", details: { current_version: 2 } });

    const lecture = await v1("GET", `/api/lectures/${osLecture}`, alice);
    expect(lecture.body.lecture.markdown).toBe("# 스케줄링\n\n사용자가 고친 노트");
    const versions = await api("GET", `/documents/${docId}/versions`, alice);
    expect(versions.body.items.map((v: any) => v.version)).toEqual([2, 1]);
    expect((await api("GET", `/documents/${docId}/versions/1`, alice)).body.rendered_md).toContain("FCFS");
    expect((await api("GET", `/documents/${docId}`, alice)).body.document.user_edited).toBe(true);
  });

  test("search finds titles and legacy document paragraphs", async () => {
    const hits = (await api("GET", `/search?workspace_id=${ws}&q=${encodeURIComponent("힙")}`, alice)).body.items;
    expect(hits.map((h: any) => [h.kind, h.recording_id])).toEqual([
      ["recording", dsLecture],
      ["document", dsLecture],
      ["document", dsLecture],
    ]);
    expect(hits[1]).toMatchObject({ document_id: lectureDocumentId(dsLecture), block_id: "md-0" });
    for (const hit of hits) expect(hit.snippet.filter((p: any) => p.highlight).map((p: any) => p.text)).toContain("힙");
    const recordingsOnly = await api("GET", `/search?workspace_id=${ws}&q=${encodeURIComponent("힙")}&kind=recording`, alice);
    expect(recordingsOnly.body.items).toHaveLength(1);
  });
});

describe("folders and tags", () => {
  test("folder CRUD with the 409 rules, mirrored to the v1 course", async () => {
    const created = await api("POST", "/folders", alice, { body: { workspace_id: ws, name: "알고리즘" } });
    expect(created.status).toBe(201);
    const dup = await api("POST", "/folders", alice, { body: { workspace_id: ws, name: "  알고리즘 " } });
    expect(dup.status).toBe(409);
    const child = await api("POST", "/folders", alice, { body: { workspace_id: ws, name: "그래프", parent_id: created.body.id } });
    expect(child.status).toBe(201);
    expect(child.body.parent_id).toBe(created.body.id);
    const cycle = await api("PATCH", `/folders/${created.body.id}`, alice, { body: { parent_id: child.body.id } });
    expect(cycle.status).toBe(409);
    const self = await api("PATCH", `/folders/${created.body.id}`, alice, { body: { parent_id: created.body.id } });
    expect(self.status).toBe(409);

    // Rename a course folder: the v1 lecture's course follows.
    const osFolder = courseFolderId(alice.id, "운영체제");
    const renamed = await api("PATCH", `/folders/${osFolder}`, alice, { body: { name: "운영체제론" } });
    expect(renamed.body.name).toBe("운영체제론");
    expect(getLectureById(osLecture)!.course).toBe("운영체제론");
    const v1List = await v1("GET", "/api/lectures", alice);
    expect(v1List.body.courses).toContain("운영체제론");

    // Nest it under 알고리즘 and delete 알고리즘: recordings and subfolders move up.
    await api("PATCH", `/folders/${osFolder}`, alice, { body: { parent_id: created.body.id } });
    const inside = await api("GET", `/recordings?workspace_id=${ws}&folder_id=${created.body.id}&include_subfolders=true`, alice);
    expect(inside.body.items.map((r: any) => r.id).sort()).toEqual([osLecture, processingLecture].sort());
    expect((await api("DELETE", `/folders/${created.body.id}`, alice)).status).toBe(204);
    const after = (await api("GET", `/folders?workspace_id=${ws}`, alice)).body.items;
    expect(after.find((f: any) => f.id === osFolder).parent_id).toBeNull();
    expect(after.find((f: any) => f.id === child.body.id).parent_id).toBeNull();
    expect(getLectureById(osLecture)!.course).toBe("운영체제론"); // still in its own folder

    // Deleting a folder with recordings directly in it leaves them unfiled ("미분류" in v1).
    expect((await api("DELETE", `/folders/${osFolder}`, alice)).status).toBe(204);
    expect(getLectureById(osLecture)!.course).toBe("미분류");
    const unfiled = await api("GET", `/recordings?workspace_id=${ws}&unfiled=true`, alice);
    expect(unfiled.body.items.map((r: any) => r.id).sort()).toEqual([osLecture, processingLecture].sort());
  });

  test("tags: CRUD, 409 on names, assignment replaces every tag", async () => {
    const exam = await api("POST", "/tags", alice, { body: { workspace_id: ws, name: "시험", color: "red" } });
    expect(exam.status).toBe(201);
    expect((await api("POST", "/tags", alice, { body: { workspace_id: ws, name: " 시험", color: "blue" } })).status).toBe(409);
    const review = await api("POST", "/tags", alice, { body: { workspace_id: ws, name: "복습", color: "green" } });
    expect((await api("PATCH", `/tags/${review.body.id}`, alice, { body: { name: "시험" } })).status).toBe(409);

    const patched = await api("PATCH", `/recordings/${dsLecture}`, alice, { body: { tag_ids: [exam.body.id, review.body.id] } });
    expect(patched.status).toBe(200);
    const both = await api("GET", `/recordings?workspace_id=${ws}&tag_ids=${exam.body.id},${review.body.id}`, alice);
    expect(both.body.items.map((r: any) => r.id)).toEqual([dsLecture]);
    await api("PATCH", `/recordings/${dsLecture}`, alice, { body: { tag_ids: [review.body.id] } });
    expect((await api("GET", `/recordings/${dsLecture}`, alice)).body.tags.map((t: any) => t.tag_id)).toEqual([review.body.id]);
    expect((await api("DELETE", `/tags/${review.body.id}`, alice)).status).toBe(204);
    expect((await api("GET", `/recordings/${dsLecture}`, alice)).body.tags).toEqual([]);
  });
});

describe("recordings", () => {
  test("PATCH and batch changes reach the lecture; batch reports per recording", async () => {
    const title = await api("PATCH", `/recordings/${dsLecture}`, alice, { body: { title: "힙과 우선순위 큐", recorded_at: "2026-09-01T01:00:00.000Z" } });
    expect(title.body).toMatchObject({ title: "힙과 우선순위 큐", recorded_at_source: "client", recorded_at: "2026-09-01T01:00:00.000Z" });
    expect(getLectureById(dsLecture)!.title).toBe("힙과 우선순위 큐");

    const folder = (await api("POST", "/folders", alice, { body: { workspace_id: ws, name: "2학기" } })).body;
    const batch = await api("POST", "/recordings/batch", alice, {
      body: { action: "move", recording_ids: [dsLecture, "lec_missing_0000", osLecture], folder_id: folder.id },
    });
    expect(batch.body.results).toEqual([
      { recording_id: dsLecture, ok: true, error: null },
      { recording_id: "lec_missing_0000", ok: false, error: { code: "not_found", message: expect.any(String) } },
      { recording_id: osLecture, ok: true, error: null },
    ]);
    expect(getLectureById(dsLecture)!.course).toBe("2학기");
    expect((await api("POST", "/recordings/batch", alice, { body: { action: "move", recording_ids: [dsLecture], folder_id: "fld_nope" } })).status).toBe(404);

    const sorted = await api("GET", `/recordings?workspace_id=${ws}&sort=title_asc&limit=2`, alice);
    expect(sorted.body.items.map((r: any) => r.title)).toEqual(["교착 상태", "스케줄링"]);
    const next = await api("GET", `/recordings?workspace_id=${ws}&sort=title_asc&limit=2&cursor=${sorted.body.next_cursor}`, alice);
    expect(next.body.items.map((r: any) => r.title)).toEqual(["힙과 우선순위 큐"]);
    expect(next.body.next_cursor).toBeNull();
    const titled = await api("GET", `/recordings?workspace_id=${ws}&q=${encodeURIComponent("우선순위")}`, alice);
    expect(titled.body.items.map((r: any) => r.id)).toEqual([dsLecture]);
    const before = await api("GET", `/recordings?workspace_id=${ws}&recorded_before=2026-09-02T00:00:00.000Z`, alice);
    expect(before.body.items.map((r: any) => r.id)).toEqual([dsLecture]);
  });

  test("reprocess: a legacy recording only does `full`, with an estimate first", async () => {
    const dry = await api("POST", `/recordings/${osLecture}/reprocess`, alice, { body: { mode: "full", dry_run: true } });
    expect(dry.status).toBe(200);
    expect(dry.body).toEqual({ estimate: { estimated_microusd: 120_000, audio_ms: 3_600_000, within_quota: true }, job: null });
    expect((await api("POST", `/recordings/${osLecture}/reprocess`, alice, { body: { mode: "document" } })).status).toBe(409);
  });

  test("another user sees none of it", async () => {
    expect((await api("GET", `/recordings/${osLecture}`, bob)).status).toBe(404);
    expect((await api("GET", `/recordings?workspace_id=${ws}`, bob)).status).toBe(403);
    expect((await api("GET", `/folders?workspace_id=${ws}`, bob)).status).toBe(403);
    expect((await api("GET", `/documents/${lectureDocumentId(osLecture)}`, bob)).status).toBe(404);
    expect((await api("PATCH", `/recordings/${osLecture}`, bob, { body: { title: "x" } })).status).toBe(404);
    const batch = await api("POST", "/recordings/batch", bob, { body: { action: "delete", recording_ids: [osLecture] } });
    expect(batch.body.results[0]).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(getLectureById(osLecture)).not.toBeNull();
    const bobHits = await api("GET", `/search?workspace_id=${personalWorkspaceId(bob.id)}&q=${encodeURIComponent("스케줄링")}`, bob);
    expect(bobHits.body.items).toEqual([]);
  });

  test("asset bytes support Range", async () => {
    const assetId = (await api("GET", `/recordings/${osLecture}`, alice)).body.assets[0].id;
    const range = await handleRequest(
      new Request(`http://localhost${API_BASE_PATH}/assets/${assetId}/content?token=${alice.api_token}`, { headers: { Range: "bytes=0-4" } })
    );
    expect(range.status).toBe(206);
    expect(range.headers.get("content-type")).toBe("audio/mp4");
    expect(await range.text()).toBe("audio");
    expect((await api("GET", `/assets/${assetId}/content`, bob)).status).toBe(404);
  });
});

describe("resumable uploads", () => {
  const audio = new Uint8Array(PART_SIZE + 10).map((_, i) => i % 251);

  test("parts in any order, then complete: a recording, a lecture and a queued job", async () => {
    const folder = (await api("POST", "/folders", alice, { body: { workspace_id: ws, name: "업로드" } })).body;
    const created = await api("POST", "/uploads", alice, {
      body: {
        workspace_id: ws,
        recorded_at: "2026-10-01T00:30:00.000Z",
        recording: { title: "업로드한 강의", folder_id: folder.id },
        files: [{ kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes: audio.length, sha256: sha256(audio) }],
      },
      headers: { "Idempotency-Key": "upload-1" },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "open", part_size: PART_SIZE, received_parts: [] });
    expect(created.body.files[0]).toMatchObject({ first_part: 1, part_count: 2 });
    const id = created.body.id;
    // Same key, same request: the same session.
    const again = await api("POST", "/uploads", alice, { body: { workspace_id: ws, recorded_at: "2026-10-01T00:30:00.000Z", recording: { title: "업로드한 강의", folder_id: folder.id }, files: created.body.files.map(({ index: _i, first_part: _f, part_count: _c, ...f }: any) => f) }, headers: { "Idempotency-Key": "upload-1" } });
    expect(again.body.id).toBe(id);

    const put = (part: number, bytes: Uint8Array) =>
      api("PUT", `/uploads/${id}/parts/${part}`, alice, { raw: bytes, headers: { "Content-Type": "application/octet-stream" } });
    expect((await put(2, audio.slice(0, 5))).status).toBe(400); // wrong size
    const second = await put(2, audio.slice(PART_SIZE));
    expect(second.body).toEqual({ part: 2, bytes: 10, sha256: sha256(audio.slice(PART_SIZE)) });
    expect((await api("POST", `/uploads/${id}/complete`, alice)).body.error.code).toBe("upload_incomplete");
    expect((await put(1, audio.slice(0, PART_SIZE))).status).toBe(200);
    expect((await api("GET", `/uploads/${id}`, alice)).body.received_parts).toEqual([1, 2]);

    const done = await api("POST", `/uploads/${id}/complete`, alice, { headers: { "Idempotency-Key": "complete-1" } });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      deduplicated: false,
      upload: { status: "completed" },
      recording: { title: "업로드한 강의", folder_id: folder.id, status: "processing", recorded_at: "2026-10-01T00:30:00.000Z", recorded_at_source: "client" },
      job: { kind: "process", state: "queued" },
    });
    const recordingId = done.body.recording.id;
    const lecture = getLectureById(recordingId)!;
    expect(lecture).toMatchObject({ course: "업로드", title: "업로드한 강의", audio_sha256: sha256(audio), source_client: "web-v2" });
    const detail = await api("GET", `/recordings/${recordingId}`, alice);
    expect(detail.body.assets[0]).toMatchObject({ sha256: sha256(audio), bytes: audio.length });
    // The sandbox has no Gemini key: the job may already have failed by now.
    if (detail.body.recording.status === "failed") {
      expect(detail.body.failure).toMatchObject({ code: "legacy_error", message: expect.stringContaining("GEMINI_API_KEY") });
    } else {
      expect(detail.body.progress).toMatchObject({ job_id: done.body.job.id, stage: "legacy_distill" });
    }
    expect((await api("POST", `/uploads/${id}/complete`, alice)).body.recording.id).toBe(recordingId); // idempotent
    expect(existsSync(join(DATA_DIR, "uploads", "v2", id))).toBe(false); // parts are gone

    // The same audio again: deduplicated by digest, like v1 ingest.
    const dup = await api("POST", "/uploads", alice, { body: { workspace_id: ws, files: [{ kind: "audio", filename: "again.m4a", mime: "audio/mp4", bytes: audio.length }] } });
    await api("PUT", `/uploads/${dup.body.id}/parts/1`, alice, { raw: audio.slice(0, PART_SIZE) });
    await api("PUT", `/uploads/${dup.body.id}/parts/2`, alice, { raw: audio.slice(PART_SIZE) });
    const dedup = await api("POST", `/uploads/${dup.body.id}/complete`, alice);
    // As in v1 ingest; a duplicate of a failed upload also retries it, so `job` may be set.
    expect(dedup.body).toMatchObject({ deduplicated: true, recording: { id: recordingId } });
  });

  test("refuses what v1 ingest refuses, and other people's sessions", async () => {
    const bad = await api("POST", "/uploads", alice, { body: { workspace_id: ws, files: [{ kind: "audio", filename: "x.exe", mime: "application/x-msdownload", bytes: 10 }] } });
    expect(bad.status).toBe(415);
    const two = await api("POST", "/uploads", alice, {
      body: {
        workspace_id: ws,
        files: [
          { kind: "audio", filename: "a.m4a", mime: "audio/mp4", bytes: 10 },
          { kind: "audio", filename: "b.m4a", mime: "audio/mp4", bytes: 10 },
        ],
      },
    });
    expect(two.status).toBe(400);
    const mine = await api("POST", "/uploads", alice, { body: { workspace_id: ws, files: [{ kind: "audio", filename: "a.m4a", mime: "audio/mp4", bytes: 10 }] } });
    expect((await api("GET", `/uploads/${mine.body.id}`, bob)).status).toBe(404);
    expect((await api("POST", "/uploads", bob, { body: { workspace_id: ws, files: [{ kind: "audio", filename: "a.m4a", mime: "audio/mp4", bytes: 10 }] } })).status).toBe(403);
    expect((await api("DELETE", `/uploads/${mine.body.id}`, alice)).status).toBe(204);
    expect((await api("GET", `/uploads/${mine.body.id}`, alice)).body.status).toBe("aborted");
  });
});

describe("event stream", () => {
  test("replays after Last-Event-ID and pushes new changes live", async () => {
    const before = (db.query(`SELECT MAX(id) AS id FROM job_event`).get() as { id: number }).id;
    await api("PATCH", `/recordings/${dsLecture}`, alice, { body: { title: "힙 (재방송)" } });

    const replay = await handleRequest(
      new Request(`http://localhost${API_BASE_PATH}/events?workspace_id=${ws}`, {
        headers: { "X-Lectern-Token": alice.api_token, "Last-Event-ID": String(before) },
      })
    );
    expect(replay.headers.get("content-type")).toStartWith("text/event-stream");
    const replayed = await readEvents(replay, (events) => events.some((e) => e.type === "recording.updated"));
    const updated = replayed.find((e) => e.type === "recording.updated") as any;
    expect(updated).toMatchObject({ workspace_id: ws, recording_id: dsLecture, payload: { recording: { title: "힙 (재방송)" } } });
    expect(Number(updated.id)).toBeGreaterThan(before);

    const live = await handleRequest(new Request(`http://localhost${API_BASE_PATH}/events?workspace_id=${ws}`, { headers: { "X-Lectern-Token": alice.api_token } }));
    setTimeout(() => void api("PATCH", `/recordings/${dsLecture}`, alice, { body: { title: "힙 (생방송)" } }), 200);
    const pushed = await readEvents(live, (events) => events.some((e) => e.type === "recording.updated"));
    expect((pushed.find((e) => e.type === "recording.updated") as any).payload.recording.title).toBe("힙 (생방송)");

    // Someone else's workspace: no stream at all.
    expect((await api("GET", `/events?workspace_id=${ws}`, bob)).status).toBe(403);
  });
});

describe("saved views, action items, calendar", () => {
  test("views are private to the user who saved them", async () => {
    const view = await api("POST", "/views", alice, { body: { workspace_id: ws, name: "준비 중", query: { status: "processing" } } });
    expect(view.status).toBe(201);
    const second = await api("POST", "/views", alice, { body: { workspace_id: ws, name: "시험", query: {} } });
    expect(second.body.sort_key > view.body.sort_key).toBe(true);
    expect((await api("GET", `/views?workspace_id=${ws}`, alice)).body.items.map((v: any) => v.name)).toEqual(["준비 중", "시험"]);
    expect((await api("PATCH", `/views/${view.body.id}`, bob, { body: { name: "x" } })).status).toBe(404);
    expect((await api("PATCH", `/views/${view.body.id}`, alice, { body: { name: "처리 중" } })).body.name).toBe("처리 중");
    expect((await api("DELETE", `/views/${second.body.id}`, alice)).status).toBe(204);
  });

  test("workspace lists answer real (empty) data", async () => {
    expect((await api("GET", `/action-items?workspace_id=${ws}`, alice)).body).toEqual({ items: [], next_cursor: null });
    expect((await api("GET", `/calendar/suggestions?workspace_id=${ws}&statuses=accepted,synced`, alice)).body.items).toEqual([]);
    expect((await api("GET", `/integrations?workspace_id=${ws}`, alice)).body.items).toEqual([]);
    expect((await api("GET", `/share-links?workspace_id=${ws}`, alice)).body.items).toEqual([]); // every lecture is private
  });
});

describe("v1 and v2 stay in step", () => {
  test("every lecture agrees with its v2 rows after all of the above", () => {
    const report = verifyLegacy(db);
    expect(report.mismatches).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test("deleting a recording through v2 deletes the lecture", async () => {
    expect((await api("DELETE", `/recordings/${processingLecture}`, alice)).status).toBe(204);
    expect(getLectureById(processingLecture)).toBeNull();
    expect((await api("GET", `/recordings/${processingLecture}`, alice)).status).toBe(404);
    expect((await v1("GET", `/api/lectures/${processingLecture}`, alice)).status).toBe(404);
  });
});
