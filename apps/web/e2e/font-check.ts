// Shared check for self-hosted Pretendard (D-P2-7), used by the fixture and server specs:
// no request leaves the app's origin, the font loads from /app/assets as font/woff2, and
// the body uses it.

import type { Page, Response } from "@playwright/test";
import { expect } from "./fixtures.ts";

export async function checkFonts(page: Page, path: string, ready: (page: Page) => Promise<void>) {
  const urls: string[] = [];
  const fonts: Response[] = [];
  page.on("request", (req) => urls.push(req.url()));
  page.on("response", (res) => {
    if (res.url().endsWith(".woff2")) fonts.push(res);
  });
  await page.goto(path);
  await ready(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  const origin = new URL(page.url()).origin;
  const outside = urls.filter((u) => !u.startsWith("data:") && !u.startsWith("blob:") && new URL(u).origin !== origin);
  expect(outside, "requests to other origins").toEqual([]);

  const loaded = await page.evaluate(
    () => [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Pretendard Variable" && f.status === "loaded").length,
  );
  expect(loaded).toBeGreaterThanOrEqual(1);
  expect(fonts.length).toBeGreaterThanOrEqual(1);
  for (const res of fonts) {
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("font/woff2");
    expect(new URL(res.url()).pathname.startsWith("/app/assets/PretendardVariable.subset.")).toBe(true);
  }
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Pretendard Variable"?/);
}
