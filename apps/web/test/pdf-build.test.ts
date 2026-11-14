// The web build ships pdf.js same-origin (D-P3-7): the worker is its own file under
// /app/assets (never a script tag of index.html, never a blob: or CDN URL), the CMaps,
// fonts and decoders are copied next to it under a versioned directory, the lazy viewer
// chunk knows both URLs, and eval stays off.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pdfjsRoot } from "../scripts/build.ts";

let out = "";
let assets = "";
let version = "";

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "lectern-web-pdf-"));
  // In its own process: Bun.build inside the test runner cannot resolve the app's imports
  // (as apps/server/test/web-build.test.ts).
  const proc = Bun.spawn(
    [
      process.execPath,
      "-e",
      `const { buildWeb } = await import(${JSON.stringify(join(import.meta.dir, "../scripts/build.ts"))});
       await buildWeb({ outDir: ${JSON.stringify(out)}, api: "fixture" });`,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
  assets = join(out, "assets");
  version = (JSON.parse(readFileSync(join(pdfjsRoot(), "package.json"), "utf8")) as { version: string }).version;
});

afterAll(() => rmSync(out, { recursive: true, force: true }));


const scripts = () => readdirSync(assets).filter((f) => f.endsWith(".js") && !f.startsWith("pdf-worker-"));

describe("pdf.js in the web build", () => {
  test("worker is bundled same-origin", () => {
    expect(readdirSync(assets).filter((f) => /^pdf-worker-[\w-]+\.js$/.test(f))).toHaveLength(1);
    for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) expect(existsSync(join(assets, "pdfjs", version, dir)), dir).toBe(true);
    expect(existsSync(join(assets, "pdfjs", version, "cmaps", "UniKS-UCS2-H.bcmap"))).toBe(true);
    expect(readFileSync(join(out, "index.html"), "utf8")).not.toContain("pdf-worker");
  });

  test("main bundle points at the worker", () => {
    const code = scripts().map((f) => readFileSync(join(assets, f), "utf8"));
    expect(code.some((c) => /\/app\/assets\/pdf-worker-[\w-]+\.js/.test(c))).toBe(true);
    expect(code.some((c) => c.includes(`/app/assets/pdfjs/${version}/`))).toBe(true);
    // pdf.js is a lazy chunk: the entry script does not carry it (a string only pdf.js has).
    const html = readFileSync(join(out, "index.html"), "utf8");
    const entries = [...html.matchAll(/src="\/app\/assets\/([^"]+)"/g)].map((m) => m[1]!);
    for (const entry of entries) expect(readFileSync(join(assets, entry), "utf8")).not.toContain("RenderingCancelledException");
    expect(code.some((c) => c.includes("RenderingCancelledException"))).toBe(true);
  });

  test("no inline script or style, no external origin", () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    const tags = html.match(/<script\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toContain("src=");
    expect(html).not.toContain("style=");
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  test("eval disabled", () => {
    const source = readFileSync(join(import.meta.dir, "../src/routes/recording/pdf/pdfjs.ts"), "utf8");
    expect(source).toContain("isEvalSupported: false");
    expect(source).toContain("enableXfa: false");
  });
});
