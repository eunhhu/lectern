// Folder and tag editing through the fixture ApiClient, plus the calendar, avatar and
// naming helpers the library, calendar and user menu rely on.

import { describe, expect, test } from "bun:test";
import * as D from "@lectern/domain";
import { createFixtureClient } from "../src/api/fixture/client.ts";
import type { Tag } from "../src/api/types.ts";
import { PERSONAL_WS, TEAM_WS } from "../src/fixtures/index.ts";
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
    await expect(api.createFolder({ workspace_id: PERSONAL_WS, name: "운영체제", parent_id: "fld_semester" })).rejects.toMatchObject({ code: "conflict" });
    await expect(api.updateFolder("fld_semester", { parent_id: "fld_os" })).rejects.toMatchObject({ status: 409, code: "conflict" });
    await expect(api.updateFolder("fld_os", { parent_id: "fld_os" })).rejects.toMatchObject({ code: "conflict" });
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
