import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { can, type Action, type WorkspaceRole } from "../src/api/v2/access.ts";

// The policy table (ARCHITECTURE §6, §10). Rows: caller role and how the recording relates
// to them; columns: actions. `true` = allowed.

type Relation = "own private" | "own shared" | "other's private" | "other's shared";

const ME = "usr_me";
const recordingFor = (relation: Relation) => ({
  created_by: relation.startsWith("own") ? ME : "usr_other",
  visibility: relation.endsWith("private") ? ("private" as const) : ("workspace" as const),
});

const WORKSPACE_ACTIONS: Action[] = ["workspace:read", "workspace:update", "folder:write", "tag:write", "recording:create"];
const WORKSPACE_TABLE: Record<WorkspaceRole | "none", boolean[]> = {
  //       read   update  folders tags   create
  owner: [true, true, true, true, true],
  admin: [true, true, true, true, true],
  member: [true, false, true, true, true],
  viewer: [true, false, false, false, false],
  none: [false, false, false, false, false],
};

const RECORDING_ACTIONS: Action[] = ["recording:read", "recording:update", "recording:delete"];
const RECORDING_TABLE: Record<WorkspaceRole | "none", Record<Relation, boolean[]>> = {
  owner: {
    "own private": [true, true, true],
    "own shared": [true, true, true],
    "other's private": [false, false, false], // private means the creator only, even for the owner
    "other's shared": [true, true, true],
  },
  admin: {
    "own private": [true, true, true],
    "own shared": [true, true, true],
    "other's private": [false, false, false],
    "other's shared": [true, true, true],
  },
  member: {
    "own private": [true, true, true],
    "own shared": [true, true, true],
    "other's private": [false, false, false],
    "other's shared": [true, false, false],
  },
  viewer: {
    "own private": [true, false, false],
    "own shared": [true, false, false],
    "other's private": [false, false, false],
    "other's shared": [true, false, false],
  },
  none: {
    "own private": [false, false, false],
    "own shared": [false, false, false],
    "other's private": [false, false, false],
    "other's shared": [false, false, false],
  },
};

describe("API v2 policy", () => {
  for (const [role, expected] of Object.entries(WORKSPACE_TABLE)) {
    test(`workspace actions for ${role}`, () => {
      const caller = { userId: ME, role: role === "none" ? null : (role as WorkspaceRole) };
      expect(WORKSPACE_ACTIONS.map((a) => can(caller, a))).toEqual(expected);
    });
  }

  for (const [role, relations] of Object.entries(RECORDING_TABLE)) {
    for (const [relation, expected] of Object.entries(relations)) {
      test(`recording actions for ${role}, ${relation}`, () => {
        const caller = { userId: ME, role: role === "none" ? null : (role as WorkspaceRole) };
        expect(RECORDING_ACTIONS.map((a) => can(caller, a, recordingFor(relation as Relation)))).toEqual(expected);
      });
    }
  }

  test("recording actions need a recording", () => {
    for (const action of RECORDING_ACTIONS) expect(can({ userId: ME, role: "owner" }, action)).toBe(false);
  });
});
