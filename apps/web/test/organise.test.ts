// Folder and tag editing through the fixture ApiClient, plus the calendar, avatar and
// naming helpers the library, calendar and user menu rely on.

import { describe, expect, test } from "bun:test";
import * as D from "@lectern/domain";
import { createFixtureClient } from "../src/api/fixture/client.ts";
import { asId } from "../src/api/types.ts";
import type { Tag } from "../src/api/types.ts";
import { PERSONAL_WS, TEAM_WS } from "../src/fixtures/index.ts";
import { progressLabel } from "../src/app/labels.ts";
import { addDays, dayKey, groupByDay, weekOf, type CalendarItem } from "../src/lib/calendar.ts";
import { nextTagColor, uniqueName } from "../src/routes/library/organise.ts";
import { avatarHue, initials } from "../src/ui/Avatar.tsx";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const client = () => createFixtureClient({ now: NOW, latencyMs: 0, processingMs: 50 });

describe("folders through the ApiClient", () => {
  test("create, rename and nest folders; responses match the domain schema", async () => {
    const api = client();
    const parent = await api.createFolder({ workspace_id: PERSONAL_WS, name: "  2027년 1학기 " });
    D.Folder.parse(parent);
    expect(parent.name).toBe("2027년 1학기");
    const child = await api.createFolder({ workspace_id: PERSONAL_WS, name: "알고리즘", parent_id: parent.id });
    expect(child.parent_id).toBe(parent.id);
    const renamed = await api.updateFolder(child.id, { name: "알고리즘 설계" });
    expect(renamed.name).toBe("알고리즘 설계");
    const moved = await api.updateFolder("fld_os", { parent_id: parent.id });
    expect(moved.parent_id).toBe(parent.id);
    // Siblings stay ordered: a new folder sorts after the existing ones.
    const siblings = (await api.listFolders(PERSONAL_WS)).items.filter((f) => f.parent_id === parent.id);
    expect(siblings.map((f) => f.name)).toEqual(["알고리즘 설계", "운영체제"]);
  });

  test("rejects empty names, duplicate siblings and cycles with domain error codes", async () => {
    const api = client();
    await expect(api.createFolder({ workspace_id: PERSONAL_WS, name: "   " })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(api.createFolder({ workspace_id: PERSONAL_WS, name: "운영체제", parent_id: asId("fld_semester") })).rejects.toMatchObject({ code: "conflict" });
    await expect(api.updateFolder("fld_semester", { parent_id: asId("fld_os") })).rejects.toMatchObject({ status: 409, code: "conflict" });
    await expect(api.updateFolder("fld_os", { parent_id: asId("fld_os") })).rejects.toMatchObject({ code: "conflict" });
    await expect(api.updateFolder("fld_missing", { name: "x" })).rejects.toMatchObject({ code: "not_found" });
  });

  test("deleting a folder moves its recordings and subfolders to the parent", async () => {
    const api = client();
    await api.deleteFolder("fld_semester");
    const folders = (await api.listFolders(PERSONAL_WS)).items;
    expect(folders.some((f) => f.id === "fld_semester")).toBe(false);
    expect(folders.find((f) => f.id === "fld_os")?.parent_id).toBeNull();
    await api.deleteFolder("fld_os");
    const os07 = await api.getRecording("rec_os07");
    expect(os07.recording.folder_id).toBeNull();
  });
});

describe("tags through the ApiClient", () => {
  test("create, rename, recolour and delete; deleting detaches it from recordings", async () => {
    const api = client();
    const tag = await api.createTag({ workspace_id: PERSONAL_WS, name: "기말 범위", color: "green" });
    D.Tag.parse(tag);
    await expect(api.createTag({ workspace_id: PERSONAL_WS, name: "기말 범위", color: "red" })).rejects.toMatchObject({ code: "conflict" });
    await expect(api.createTag({ workspace_id: PERSONAL_WS, name: "시험 범위 ".toUpperCase(), color: "red" })).rejects.toMatchObject({ code: "conflict" });
    expect((await api.updateTag(tag.id, { name: "기말고사 범위", color: "indigo" })).color).toBe("indigo");
    await api.updateRecording("rec_os07", { tag_ids: [tag.id] });
    expect((await api.getRecording("rec_os07")).tags.map((t) => t.tag_id)).toEqual([tag.id]);
    await api.deleteTag(tag.id);
    expect((await api.getRecording("rec_os07")).tags).toEqual([]);
    expect((await api.listTags(PERSONAL_WS)).items.some((t) => t.id === tag.id)).toBe(false);
  });
});

describe("account through the ApiClient", () => {
  test("profile updates, members and devices match the domain schemas", async () => {
    const api = client();
    const me = await api.updateMe({ display_name: "김지우", timezone: "Asia/Tokyo" });
    D.Me.parse(me);
    expect(me.display_name).toBe("김지우");
    await expect(api.updateMe({ display_name: " " })).rejects.toMatchObject({ code: "validation_failed" });
    const members = D.WorkspaceMemberPage.parse(await api.listMembers(TEAM_WS));
    expect(members.items.length).toBe(5);
    expect((await api.listMembers(TEAM_WS)).items.find((m) => m.user_id === me.id)?.display_name).toBe("김지우");
    const devices = await api.listDevices();
    D.DevicePage.parse(devices);
    const current = devices.items.find((d) => d.current)!;
    await expect(api.revokeDevice(current.id)).rejects.toMatchObject({ code: "conflict" });
    const other = devices.items.find((d) => !d.current)!;
    await api.revokeDevice(other.id);
    expect((await api.listDevices()).items.some((d) => d.id === other.id)).toBe(false);
  });

  test("action items can be completed", async () => {
    const api = client();
    const [item] = (await api.listActionItems("rec_os07")).items;
    const done = await api.updateActionItem(item!.id, { status: "done" });
    D.ActionItem.parse(done);
    expect(done.status).toBe("done");
  });
});

describe("fixture calendar data", () => {
  const api = client();

  test("confirmed events, suggestions and dated to-dos are spread over several weeks", () => {
    const confirmed = api.data.events.filter((e) => e.status === "accepted" || e.status === "synced");
    const suggested = api.data.events.filter((e) => e.status === "suggested");
    expect(confirmed.length).toBeGreaterThanOrEqual(6);
    expect(suggested.length).toBeGreaterThanOrEqual(3);
    const days = new Set([...confirmed, ...suggested].map((e) => dayKey(e.start_at)));
    expect(days.size).toBeGreaterThanOrEqual(7);
    expect(api.data.actionItems.filter((a) => a.due_at).length).toBeGreaterThanOrEqual(6);
  });
});

describe("helpers", () => {
  test("calendar days are local (Asia/Seoul) and weeks start on Sunday", () => {
    expect(dayKey("2026-10-19T15:30:00Z")).toBe("2026-10-20"); // 00:30 KST
    expect(dayKey("2026-10-19T14:59:00Z")).toBe("2026-10-19");
    expect(weekOf("2026-10-21")).toEqual(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    const item = (id: string, at: string, allDay = false): CalendarItem => ({
      id,
      kind: "event",
      title: id,
      at,
      end: null,
      allDay,
      label: "일정",
      recordingId: "r",
      recordingTitle: "r",
    });
    const days = groupByDay([item("b", "2026-10-21T05:00:00Z"), item("all", "2026-10-20T15:00:00Z", true), item("a", "2026-10-21T01:00:00Z")]);
    expect(days.get("2026-10-21")!.map((i) => i.id)).toEqual(["all", "a", "b"]);
  });

  test("new names and tag colours avoid what exists", () => {
    expect(uniqueName("새 폴더", [])).toBe("새 폴더");
    expect(uniqueName("새 폴더", ["새 폴더", "새 폴더 2"])).toBe("새 폴더 3");
    const tag = (color: string) => ({ color }) as Tag;
    expect(nextTagColor([tag("red"), tag("orange")])).toBe("yellow");
  });

  test("avatars use initials and a stable hue", () => {
    expect(initials("미리보기 사용자")).toBe("미");
    expect(initials("Workspace Owner")).toBe("WO");
    expect(initials("")).toBe("?");
    expect(avatarHue("usr_fixture_me")).toBe(avatarHue("usr_fixture_me"));
    expect(avatarHue("usr_a")).toBeGreaterThanOrEqual(0);
    expect(avatarHue("usr_a")).toBeLessThan(360);
  });
});

describe("P2 additions in the fixture client", () => {
  test("POST /recordings/batch moves, tags, untags and deletes with a result per recording", async () => {
    const api = client();
    const ids = [asId<D.RecordingId>("rec_os07"), asId<D.RecordingId>("rec_memo")];
    const moved = D.BatchRecordingsResponse.parse(await api.batchRecordings({ action: "move", recording_ids: ids, folder_id: asId("fld_research") }));
    expect(moved.results.map((r) => r.ok)).toEqual([true, true]);
    expect(api.data.recordings.filter((r) => ids.includes(r.id)).map((r) => String(r.folder_id))).toEqual(["fld_research", "fld_research"]);

    await api.batchRecordings({ action: "add_tags", recording_ids: ids, tag_ids: [asId("tag_exam")] });
    const tagged = (await api.listRecordings({ workspace_id: PERSONAL_WS, limit: 200 })).items.filter((r) => ids.includes(r.id));
    for (const r of tagged) expect(r.tag_ids.map(String)).toContain("tag_exam");
    await api.batchRecordings({ action: "remove_tags", recording_ids: ids, tag_ids: [asId("tag_exam")] });
    const untagged = (await api.listRecordings({ workspace_id: PERSONAL_WS, limit: 200 })).items.filter((r) => ids.includes(r.id));
    for (const r of untagged) expect(r.tag_ids.map(String)).not.toContain("tag_exam");

    // A member cannot delete a teammate's recording: that one fails, the rest go through.
    const mixed = await api.batchRecordings({ action: "delete", recording_ids: [asId("rec_tw42"), asId("rec_test")] });
    expect(mixed.results.map((r) => [String(r.recording_id), r.ok, r.error?.code ?? null])).toEqual([
      ["rec_tw42", false, "forbidden"],
      ["rec_test", true, null],
    ]);
  });

  test("workspace action items, calendar status lists, progress and failure", async () => {
    const api = client();
    const items = D.ActionItemPage.parse(await api.listWorkspaceActionItems({ workspace_id: TEAM_WS, limit: 200 })).items;
    expect(items.length).toBe(api.data.actionItems.filter((a) => a.workspace_id === TEAM_WS).length);
    const due = items.filter((a) => a.due_at).map((a) => a.due_at!);
    expect(due).toEqual([...due].sort());
    expect(items.findIndex((a) => !a.due_at)).toBeGreaterThanOrEqual(due.length);
    const open = (await api.listWorkspaceActionItems({ workspace_id: TEAM_WS, status: "open" })).items;
    expect(open.every((a) => a.status === "open")).toBe(true);

    const confirmed = (await api.listCalendarSuggestions({ workspace_id: PERSONAL_WS, statuses: "accepted,synced", limit: 200 })).items;
    expect(new Set(confirmed.map((e) => e.status))).toEqual(new Set(["accepted", "synced"]));

    const list = D.RecordingPage.parse(await api.listRecordings({ workspace_id: PERSONAL_WS, limit: 200 })).items;
    const busy = list.filter((r) => r.status === "processing" || r.status === "queued");
    expect(busy.length).toBeGreaterThan(0);
    for (const r of busy) expect(r.progress?.job_id).toBeTruthy();
    const failed = D.RecordingDetail.parse(await api.getRecording("rec_test"));
    expect(failed.failure?.message).toContain("말소리");
  });

  test("progress lines", () => {
    expect(progressLabel("queued", { stage: "ingest", progress: null, message: null, queuePosition: 2 })).toBe("처리 대기 중 · 2번째");
    expect(progressLabel("processing", { stage: "legacy_distill", progress: 0.4, message: null, queuePosition: null })).toBe("문서 만드는 중 · 40%");
    expect(progressLabel("processing", { stage: "legacy_distill", progress: null, message: "노트 정리 중...", queuePosition: null })).toBe("노트 정리 중...");
    expect(progressLabel("uploading", null)).toBe("올리는 중…");
  });
});
