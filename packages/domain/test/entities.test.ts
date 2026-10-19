import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { ENTITY_SCHEMAS, WORKSPACE_SCOPE_EXCEPTIONS, WorkspaceId, type EntityName } from "../src/index.ts";
import { ENTITY_FIXTURES, ENTITY_INVALID } from "./fixtures.ts";
import { expectInvalid, expectRequiredKeysEnforced, expectValid } from "./helpers.ts";

// The task list from ARCHITECTURE §5.2 / AI_HARNESS §4.1, plus recording_tag.
const EXPECTED_ENTITIES = [
  "workspace",
  "membership",
  "folder",
  "tag",
  "recording_tag",
  "recording",
  "asset",
  "transcript_segment",
  "speaker",
  "document",
  "document_version",
  "question",
  "event_candidate",
  "action_item",
  "share_link",
  "job",
  "stage_run",
  "artifact",
  "ai_call",
  "auth_session",
  "access_token",
  "integration",
  "usage_ledger",
  "saved_view",
].sort();

const entityNames = Object.keys(ENTITY_SCHEMAS) as EntityName[];
const shapeOf = (name: EntityName) => (ENTITY_SCHEMAS[name] as unknown as z.ZodObject).shape;

describe("v2 entities", () => {
  test("cover every table in the design", () => {
    expect(([...entityNames] as string[]).sort()).toEqual(EXPECTED_ENTITIES);
  });

  test("the v1 login table name is not reused for recordings", () => {
    expect(entityNames).not.toContain("session" as EntityName);
    expect(entityNames).toContain("recording");
  });

  describe("every entity carries workspace_id", () => {
    const selfScoped: readonly string[] = WORKSPACE_SCOPE_EXCEPTIONS.selfScoped;
    const nullable: readonly string[] = WORKSPACE_SCOPE_EXCEPTIONS.nullableWorkspace;

    for (const name of entityNames) {
      test(name, () => {
        const shape = shapeOf(name);
        if (selfScoped.includes(name)) {
          expect(shape.id).toBe(WorkspaceId);
          return;
        }
        const field = shape.workspace_id;
        expect(field, `${name}.workspace_id`).toBeDefined();
        const fixture = ENTITY_FIXTURES[name][0] as Record<string, unknown>;
        // Required, and typed as a WorkspaceId (an arbitrary string is rejected).
        expect(field!.safeParse(undefined).success).toBe(false);
        expect(field!.safeParse(fixture.workspace_id).success).toBe(true);
        expect(field!.safeParse("not a workspace id").success).toBe(false);
        expect(field!.safeParse(null).success).toBe(nullable.includes(name));
      });
    }
  });

  describe("fixtures", () => {
    for (const name of entityNames) {
      const schema = ENTITY_SCHEMAS[name];
      test(name, () => {
        const valid = ENTITY_FIXTURES[name];
        const invalid = ENTITY_INVALID[name];
        expect(valid.length).toBeGreaterThan(0);
        expect(invalid.length).toBeGreaterThan(0);
        valid.forEach((value, i) => expectValid(schema, value, `${name} valid[${i}]`));
        invalid.forEach((value, i) => expectInvalid(schema, value, `${name} invalid[${i}]`));
        expect(expectRequiredKeysEnforced(schema, valid[0], name)).toBeGreaterThan(0);
        expectInvalid(schema, null, `${name} null`);
      });
    }
  });

  test("unknown fields are stripped, not rejected (additive changes stay compatible)", () => {
    const recording = ENTITY_FIXTURES.recording[0] as Record<string, unknown>;
    const parsed = ENTITY_SCHEMAS.recording.parse({ ...recording, added_in_v2_1: true });
    expect(parsed).not.toHaveProperty("added_in_v2_1");
  });
});
