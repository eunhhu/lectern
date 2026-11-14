import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterEach, describe, expect, test } from "bun:test";
import { resetConfigForTests } from "@lectern/config";
import { handleRequest } from "../src/index.ts";

// /.well-known/apple-app-site-association (P6-03, D-P6-4): universal links (/app/*, /s/*) and
// saved passwords for the apps in APPLE_APP_IDS; 404 when there are none.

const IOS = "ABCDE12345.com.qucord.lectern.ios";
const MACOS = "ABCDE12345.com.qucord.lectern.macos";
const get = () => handleRequest(new Request("http://localhost/.well-known/apple-app-site-association"));

afterEach(() => {
  delete process.env.APPLE_APP_IDS;
  resetConfigForTests();
});

describe("apple-app-site-association", () => {
  test("404 without app ids", async () => {
    delete process.env.APPLE_APP_IDS;
    resetConfigForTests();
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  test("serves the document", async () => {
    process.env.APPLE_APP_IDS = `${IOS},${MACOS}`;
    resetConfigForTests();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const doc = (await res.json()) as any;
    expect(doc.applinks.details).toHaveLength(1);
    expect(doc.applinks.details[0].appIDs).toEqual([IOS, MACOS]);
    expect(doc.applinks.details[0].components).toEqual([{ "/": "/app/*" }, { "/": "/s/*" }]);
    expect(doc.webcredentials.apps).toEqual([IOS, MACOS]);
  });

  test("no redirect, no auth", async () => {
    process.env.APPLE_APP_IDS = IOS;
    resetConfigForTests();
    // No cookie, no token, an Apple CDN-like client.
    const res = await handleRequest(
      new Request("http://localhost/.well-known/apple-app-site-association", { headers: { "User-Agent": "AASA-Bot/1.0" }, redirect: "manual" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(((await res.json()) as any).webcredentials.apps).toEqual([IOS]);
  });

  test("malformed ids are left out", async () => {
    process.env.APPLE_APP_IDS = `not-an-id,${IOS}`;
    resetConfigForTests();
    expect(((await (await get()).json()) as any).applinks.details[0].appIDs).toEqual([IOS]);
  });
});
