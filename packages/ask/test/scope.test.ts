import { describe, expect, test } from "bun:test";
import type { AskScope } from "@lectern/domain";
import type { z } from "zod";
import { assertInScope, folderSubtree, type MembershipRole, resolveAccessScope } from "../src/scope.ts";
import { FOLDERS, ME, REC, RECORDINGS, scopeOf, TEAMMATE, WS, WS_OTHER } from "./fixtures.ts";

function resolve(scope: z.input<typeof AskScope>, opts: { user?: string; role?: MembershipRole | null; workspaceId?: string } = {}) {
  return resolveAccessScope({
    workspaceId: opts.workspaceId ?? WS,
    caller: { userId: opts.user ?? ME, role: opts.role === undefined ? "member" : opts.role },
    scope: scopeOf(scope),
    recordings: RECORDINGS,
    folders: FOLDERS,
  });
}

const ids = (r: ReturnType<typeof resolve>): string | string[] => ("code" in r ? r.code : [...r.recordingIds]);

describe("access scope", () => {
  // [caller, scope, expected recording ids or error]
  const table: Array<[string, { user?: string; role?: MembershipRole | null }, z.input<typeof AskScope>, string[] | string]> = [
    ["me, whole workspace: own private + shared, not teammate's private", {}, { kind: "workspace" }, [REC.long, REC.crypto, REC.meeting].sort()],
    ["teammate, whole workspace: never my private note", { user: TEAMMATE }, { kind: "workspace" }, [REC.long, REC.meeting, REC.privateTeammate].sort()],
    ["owner role does not open private notes", { user: TEAMMATE, role: "owner" }, { kind: "workspace" }, [REC.long, REC.meeting, REC.privateTeammate].sort()],
    ["viewer cannot ask", { role: "viewer" }, { kind: "workspace" }, "forbidden"],
    ["non-member cannot ask", { role: null }, { kind: "workspace" }, "forbidden"],
    ["my note", {}, { kind: "recording", recording_id: REC.crypto }, [REC.crypto]],
    ["someone's private note is not found, not forbidden", {}, { kind: "recording", recording_id: REC.privateTeammate }, "not_found"],
    ["a note of another workspace is not found", {}, { kind: "recording", recording_id: REC.otherWorkspace }, "not_found"],
    ["folder without subfolders", {}, { kind: "folder", folder_id: "fld_school", include_subfolders: false }, [REC.long]],
    ["folder with subfolders", {}, { kind: "folder", folder_id: "fld_school", include_subfolders: true }, [REC.long, REC.crypto].sort()],
    ["folder of the work: teammate's private note excluded", {}, { kind: "folder", folder_id: "fld_work", include_subfolders: true }, [REC.meeting]],
    ["unknown folder", {}, { kind: "folder", folder_id: "fld_nope", include_subfolders: true }, "not_found"],
  ];
  for (const [name, caller, scope, expected] of table) {
    test(name, () => expect(ids(resolve(scope, caller))).toEqual(expected));
  }

  test("a folder id from another workspace is not found", () => {
    expect(ids(resolve({ kind: "folder", folder_id: "fld_school", include_subfolders: true }, {}))).not.toBe("not_found");
    const r = resolveAccessScope({
      workspaceId: WS_OTHER,
      caller: { userId: ME, role: "owner" },
      scope: scopeOf({ kind: "folder", folder_id: "fld_school", include_subfolders: true }),
      recordings: RECORDINGS,
      folders: FOLDERS,
    });
    expect(ids(r)).toBe("not_found");
  });

  test("recordings that are not ready are skipped", () => {
    const r = resolveAccessScope({
      workspaceId: WS,
      caller: { userId: ME, role: "owner" },
      scope: scopeOf({ kind: "workspace" }),
      recordings: RECORDINGS.map((x) => (x.id === REC.long ? { ...x, status: "processing" } : x)),
      folders: FOLDERS,
    });
    expect(ids(r)).not.toContain(REC.long);
  });

  test("folder subtree survives a cycle", () => {
    const cyclic = [
      { id: "a", workspace_id: WS, parent_id: "c" },
      { id: "b", workspace_id: WS, parent_id: "a" },
      { id: "c", workspace_id: WS, parent_id: "b" },
    ];
    expect([...folderSubtree(cyclic, "a", true)].sort()).toEqual(["a", "b", "c"]);
  });

  test("assertInScope rejects a chunk from outside", () => {
    const access = resolve({ kind: "recording", recording_id: REC.crypto });
    if ("code" in access) throw new Error("unexpected");
    expect(() => assertInScope(access, { id: "x", workspaceId: WS, recordingId: REC.crypto })).not.toThrow();
    expect(() => assertInScope(access, { id: "x", workspaceId: WS, recordingId: REC.meeting })).toThrow();
    expect(() => assertInScope(access, { id: "x", workspaceId: WS_OTHER, recordingId: REC.crypto })).toThrow();
  });
});
