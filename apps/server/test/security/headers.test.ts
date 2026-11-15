import "../preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, spyOn, test } from "bun:test";
import { personalWorkspaceId } from "@lectern/db";
import { db } from "../../src/db.ts";
import { call, createShareLink, makeUser, seedLecture, signIn, tokenAuth, v2, type Res } from "./helpers.ts";

// P5-15 · Security headers on what the real app answers (index.ts applySecurityHeaders, the
// share router, the v2 app): HTML pages, API responses, and a forced 500.
//
// `/app` (the web shell) is off in the test process (LECTERN_WEB_SHELL and apps/web/dist), so
// the HTML pages here are the ones the same entry serves without it: the old app page `/`,
// the old admin console `/admin`, the policy page `/privacy`, a share page and its password
// form. Every text/html answer goes through the same applySecurityHeaders.

async function htmlPages(): Promise<[string, Res][]> {
  const owner = makeUser();
  const { recordingId } = seedLecture(owner);
  const open = await createShareLink(owner, recordingId);
  const locked = await createShareLink(owner, recordingId, { password: "correct-horse-1" });
  const pages: [string, Res][] = [];
  for (const path of ["/?legacy=1", "/admin", "/privacy", `/s/${open.token}`, `/s/${locked.token}`]) {
    const res = await call("GET", path);
    expect(res.status, path).toBe(200);
    expect(res.res.headers.get("content-type") ?? "", path).toStartWith("text/html");
    pages.push([path, res]);
  }
  return pages;
}

const directives = (csp: string) =>
  new Map(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name!.toLowerCase(), values])
  );

describe("security: headers", () => {
  test("html responses carry a CSP without unsafe-inline scripts", async () => {
    for (const [path, { res }] of await htmlPages()) {
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      const d = directives(csp);
      const scripts = d.get("script-src") ?? d.get("default-src");
      expect(d.has("script-src"), path).toBe(true);
      expect(scripts, path).not.toContain("'unsafe-inline'");
      expect(scripts, path).not.toContain("'unsafe-eval'");
      expect(d.get("object-src"), path).toEqual(["'none'"]);
    }
  });

  test("frame and sniff protections", async () => {
    for (const [path, { res }] of await htmlPages()) {
      expect(res.headers.get("X-Content-Type-Options"), path).toBe("nosniff");
      const frameAncestors = directives(res.headers.get("Content-Security-Policy") ?? "").get("frame-ancestors");
      const framed = frameAncestors?.join(" ") === "'none'" || res.headers.get("X-Frame-Options")?.toUpperCase() === "DENY";
      expect(framed, path).toBe(true);
      expect(res.headers.get("Referrer-Policy"), path).toBeTruthy();
    }
    // API answers too: JSON must not be sniffed into something else.
    const user = makeUser();
    for (const res of [await v2("GET", "/me", { headers: tokenAuth(user) }), await call("GET", "/api/auth/me", { headers: tokenAuth(user) })]) {
      expect(res.res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.res.headers.get("Referrer-Policy")).toBeTruthy();
    }
  });

  test("api responses are not cached", async () => {
    const user = makeUser();
    const session = await signIn(user.email);
    const ws = personalWorkspaceId(user.id);
    const { recordingId } = seedLecture(user);
    const reads: [string, Res][] = [
      ["/me", await v2("GET", "/me", { cookie: session })],
      ["/workspaces", await v2("GET", "/workspaces", { cookie: session })],
      ["/recordings", await v2("GET", `/recordings?workspace_id=${ws}`, { cookie: session })],
      ["/recordings/{id}", await v2("GET", `/recordings/${recordingId}`, { cookie: session })],
      ["/me/devices", await v2("GET", "/me/devices", { headers: tokenAuth(user) })],
    ];
    for (const [path, res] of reads) {
      expect(res.status, path).toBe(200);
      const cache = (res.res.headers.get("Cache-Control") ?? "").toLowerCase();
      expect(cache.includes("no-store") || cache.includes("private"), `${path}: ${cache}`).toBe(true);
    }
  });

  test("errors do not leak internals", async () => {
    const user = makeUser();
    const created = await v2("POST", "/uploads", {
      headers: tokenAuth(user),
      body: { workspace_id: personalWorkspaceId(user.id), files: [{ kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes: 1024 }] },
    });
    expect(created.status).toBe(201);
    // A row the code cannot read: the handler throws, and the app answers 500.
    db.query(`UPDATE upload SET files_json = ? WHERE id = ?`).run("{not json", created.body.id);
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const quietLog = spyOn(console, "log").mockImplementation(() => {});
    let res: Res;
    try {
      res = await v2("PUT", `/uploads/${created.body.id}/parts/1`, {
        headers: { ...tokenAuth(user), "Content-Type": "application/octet-stream" },
        raw: new Uint8Array(1024),
      });
    } finally {
      quiet.mockRestore();
      quietLog.mockRestore();
    }
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal");
    for (const leak of [/\bat\s+\S+\s+\(/, /\/(src|test|node_modules)\//, /\.ts\b/, /\bSELECT\b|\bINSERT\b|\bUPDATE\b|sqlite/i, /JSON Parse error|SyntaxError/]) {
      expect(res.text, String(leak)).not.toMatch(leak);
    }
  });
});
