// Share links in both clients (D-P2-3): the HTTP client against a fake fetch (route URLs,
// the create body, Idempotency-Key, 204 on revoke) and the fixture client's in-memory list.

import { describe, expect, test } from "bun:test";
import { createFixtureClient } from "../src/api/fixture/client.ts";
import { createHttpClient } from "../src/api/http/client.ts";
import { asId, type RecordingId, type WorkspaceId } from "../src/api/types.ts";
import { PERSONAL_WS } from "../src/fixtures/index.ts";

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function fakeFetch(respond: (req: Seen) => Response) {
  const seen: Seen[] = [];
  const fn = (async (input: string, init: RequestInit = {}) => {
    const req = { url: input, method: init.method ?? "GET", headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : null };
    seen.push(req);
    return respond(req);
  }) as unknown as typeof fetch;
  return { fn, seen };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const LINK = {
  id: "shl_1",
  workspace_id: "wsp_1",
  target_type: "recording",
  target_id: "rec_1",
  scope: { transcript: false, audio: true },
  expires_at: null,
  created_by: "usr_1",
  created_at: "2026-10-19T03:00:00.000Z",
  revoked_at: null,
  has_password: false,
};

describe("HTTP client: share links", () => {
  test("createShareLink posts the body with an Idempotency-Key and returns the url as sent", async () => {
    const { fn, seen } = fakeFetch(() => json(201, { link: LINK, url: "https://x.example/s/abc" }));
    const client = createHttpClient({ fetch: fn });
    const created = await client.createShareLink({
      target_type: "recording",
      target_id: asId<RecordingId>("rec_1"),
      scope: { transcript: false, audio: true },
      expires_at: null,
      password: null,
    });
    expect(created.url).toBe("https://x.example/s/abc");
    expect(String(created.link.id)).toBe("shl_1");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/v2/share-links");
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.headers.get("Idempotency-Key")).toBeTruthy();
    const body = JSON.parse(seen[0]!.body!);
    expect(body.target_type).toBe("recording");
    expect(body.scope).toEqual({ transcript: false, audio: true });
  });

  test("listShareLinks asks for one workspace and target", async () => {
    const { fn, seen } = fakeFetch(() => json(200, { items: [LINK], next_cursor: null }));
    const client = createHttpClient({ fetch: fn });
    const page = await client.listShareLinks("wsp_1" as WorkspaceId, "rec_1");
    expect(page.items).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/v2/share-links?workspace_id=wsp_1&target_id=rec_1&limit=200");
    expect(seen[0]!.method).toBe("GET");
  });

  test("revokeShareLink sends DELETE and resolves to undefined on 204", async () => {
    const { fn, seen } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createHttpClient({ fetch: fn });
    expect(await client.revokeShareLink("shl_1")).toBeUndefined();
    expect(seen[0]!.url).toBe("/api/v2/share-links/shl_1");
    expect(seen[0]!.method).toBe("DELETE");
  });
});

describe("fixture client: share links", () => {
  test("create lists the link, revoke removes it, has_password follows the password", async () => {
    const client = createFixtureClient({ now: new Date("2026-10-19T03:00:00.000Z"), latencyMs: 0 });
    const ws = PERSONAL_WS;
    const recordings = await client.listRecordings({ workspace_id: ws, limit: 1 });
    const rec = recordings.items[0]!;
    expect((await client.listShareLinks(ws, rec.id)).items).toHaveLength(0);

    const open = await client.createShareLink({ target_type: "recording", target_id: rec.id, scope: { transcript: true, audio: false }, password: null });
    expect(open.url).toStartWith("https://lectern.example/s/");
    expect(open.link.has_password).toBe(false);
    const locked = await client.createShareLink({ target_type: "recording", target_id: rec.id, scope: { transcript: false, audio: false }, password: "fixture-pass" });
    expect(locked.link.has_password).toBe(true);

    const listed = (await client.listShareLinks(ws, rec.id)).items;
    expect(listed.map((l) => l.id).sort()).toEqual([open.link.id, locked.link.id].sort());
    expect(JSON.stringify(listed)).not.toContain("fixture-token-");

    await client.revokeShareLink(open.link.id);
    await client.revokeShareLink(locked.link.id);
    expect((await client.listShareLinks(ws, rec.id)).items).toHaveLength(0);
    await expect(client.revokeShareLink(open.link.id)).rejects.toThrow();
  });
});
