// Self-hosted Pretendard (D-P2-7): the font files and their OFL licence are in the tree,
// every @font-face swaps, and a build puts the subsets in dist/assets under hashed names
// with a stylesheet that points only at them (no CDN, no data: URLs).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FONT_DIR, WEB_ROOT } from "../scripts/build.ts";

const SUBSETS = 92;
const fontCss = () => readFileSync(join(FONT_DIR, "pretendard.css"), "utf8");

describe("Pretendard source files", () => {
  test("licence and every subset are present", () => {
    expect(readFileSync(join(FONT_DIR, "LICENSE.txt"), "utf8")).toContain("SIL Open Font License");
    const files = readdirSync(join(FONT_DIR, "woff2-dynamic-subset")).filter((f) => f.endsWith(".woff2"));
    expect(files).toHaveLength(SUBSETS);
    expect(fontCss().match(/@font-face/g)).toHaveLength(SUBSETS);
  });

  test("every @font-face uses font-display: swap", () => {
    expect(fontCss().match(/font-display:\s*swap/g)).toHaveLength(SUBSETS);
  });

  test("the token font stack starts with Pretendard Variable", () => {
    const tokens = readFileSync(join(WEB_ROOT, "../../packages/design-tokens/dist/tokens.css"), "utf8");
    expect(tokens).toMatch(/--font-family-sans:\s*"Pretendard Variable"/);
  });
});

describe("Pretendard in the build", () => {
  test("hashed woff2 files and a stylesheet that points only at them", async () => {
    const out = mkdtempSync(join(tmpdir(), "lectern-fonts-"));
    try {
      // A separate process: the bundler does not resolve the app's modules inside `bun test`.
      const build = Bun.spawnSync(["bun", "scripts/build.ts", "--api", "fixture", "--out", out], { cwd: WEB_ROOT, stdout: "pipe", stderr: "pipe" });
      expect(build.exitCode, build.stderr.toString()).toBe(0);
      const assets = readdirSync(join(out, "assets"));
      const woff2 = assets.filter((f) => f.endsWith(".woff2"));
      expect(woff2).toHaveLength(SUBSETS);
      for (const f of woff2) expect(f).toMatch(/^PretendardVariable\.subset\.\d+-[a-z0-9]+\.woff2$/);
      expect(assets.some((f) => /^pretendard-LICENSE-[a-z0-9]+\.txt$/.test(f))).toBe(true);

      const css = assets.filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(out, "assets", f), "utf8"));
      const faces = css.find((c) => c.includes("Pretendard Variable"));
      expect(faces).toBeDefined();
      expect(faces!.match(/font-display:swap/g)).toHaveLength(SUBSETS);
      for (const c of css) {
        expect(c).not.toMatch(/https?:\/\//);
        expect(c).not.toContain("data:font");
      }
      const urls = [...faces!.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]!);
      expect(urls).toHaveLength(SUBSETS);
      for (const u of urls) expect(u.startsWith("/app/assets/PretendardVariable.subset.")).toBe(true);
      for (const u of urls) expect(woff2).toContain(u.slice("/app/assets/".length));

      // index.html links both stylesheets; the app stylesheet keeps the React Aria id.
      const html = readFileSync(join(out, "index.html"), "utf8");
      const fontSheet = assets.find((f) => /^pretendard-[a-z0-9]+\.css$/.test(f));
      expect(fontSheet).toBeDefined();
      expect(html).toContain(`href="/app/assets/${fontSheet}"`);
      expect(html.indexOf("react-aria-pressable-style")).toBeLessThan(html.indexOf("/pretendard-"));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
