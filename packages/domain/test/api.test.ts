import { describe, expect, test } from "bun:test";
import {
  ApiError,
  namedIdOf,
  PageQuery,
  parseVersionETag,
  partCount,
  ROUTES,
  ROUTES_BY_OPERATION,
  toHonoPath,
  versionETag,
} from "../src/index.ts";
import { API_CASES } from "./fixtures.ts";
import { expectInvalid, expectRequiredKeysEnforced, expectValid } from "./helpers.ts";

describe("API DTO fixtures", () => {
  for (const [id, { schema, valid, invalid }] of Object.entries(API_CASES)) {
    test(id, () => {
      expect(namedIdOf(schema), `${id} is published under that name`).toBe(id);
      expect(valid.length).toBeGreaterThan(0);
      expect(invalid.length).toBeGreaterThan(0);
      valid.forEach((value, i) => expectValid(schema, value, `${id} valid[${i}]`));
      invalid.forEach((value, i) => expectInvalid(schema, value, `${id} invalid[${i}]`));
      expectRequiredKeysEnforced(schema, valid[0], id);
      expectInvalid(schema, null, `${id} null`);
    });
  }

  test("every request and response body in the route table has fixtures", () => {
    const bodies = new Set<string>();
    for (const route of ROUTES) {
      if (route.body && "schema" in route.body) bodies.add(namedIdOf(route.body.schema)!);
      for (const response of Object.values(route.responses)) {
        if (response.schema) bodies.add(namedIdOf(response.schema)!);
      }
    }
    bodies.add(namedIdOf(ApiError)!);
    const missing = [...bodies].filter((id) => !(id in API_CASES)).sort();
    expect(missing).toEqual([]);
  });
});

describe("conventions", () => {
  test("cursor pagination query coerces strings and bounds the limit", () => {
    expect(PageQuery.parse({ limit: "25", cursor: "abc" })).toEqual({ limit: 25, cursor: "abc" });
    expect(PageQuery.parse({})).toEqual({});
    expect(PageQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: "201" }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: "2.5" }).success).toBe(false);
  });

  test("document version ETags round-trip", () => {
    expect(versionETag(3)).toBe('"3"');
    expect(parseVersionETag('"3"')).toBe(3);
    expect(parseVersionETag("W/\"3\"")).toBeNull();
    expect(parseVersionETag("3")).toBeNull();
  });

  test("upload part plan", () => {
    expect(partCount(1, 8)).toBe(1);
    expect(partCount(8, 8)).toBe(1);
    expect(partCount(9, 8)).toBe(2);
  });

  test("route paths convert to Hono syntax", () => {
    expect(toHonoPath("/recordings/{recording_id}/speakers/{speaker_id}")).toBe(
      "/recordings/:recording_id/speakers/:speaker_id",
    );
  });

  test("every resource family from ARCHITECTURE §6 has routes", () => {
    const prefixes = new Set(ROUTES.map((route) => route.path.split("/")[1]));
    for (const resource of [
      "workspaces",
      "folders",
      "tags",
      "recordings",
      "uploads",
      "search",
      "calendar",
      "integrations",
      "me",
      "share-links",
      "admin",
      "events",
      "ask",
    ]) {
      expect(prefixes.has(resource), resource).toBe(true);
    }
    const recordingSubresources = ROUTES.filter((r) => r.path.startsWith("/recordings/{recording_id}/")).map(
      (r) => r.path.split("/")[3],
    );
    for (const sub of ["transcript", "documents", "questions", "events", "action-items", "reprocess"]) {
      expect(recordingSubresources, sub).toContain(sub);
    }
  });
});

describe("D-P2-4 routes", () => {
  test("audio delete, Markdown export and ask suggestions are in the table", () => {
    const at = (id: string) => {
      const route = ROUTES_BY_OPERATION[id];
      return route ? `${route.method} ${route.path}` : undefined;
    };
    expect(at("deleteRecordingAudio")).toBe("delete /recordings/{recording_id}/audio");
    expect(at("exportDocument")).toBe("get /documents/{document_id}/export");
    expect(at("listAskSuggestions")).toBe("get /ask/suggestions");
    const exportQuery = ROUTES_BY_OPERATION.exportDocument!.query!;
    expect(exportQuery.safeParse({ format: "md" }).success).toBe(true);
    expect(exportQuery.safeParse({ format: "pdf" }).success).toBe(false);
  });
});
