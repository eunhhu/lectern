// Builds apps/web into apps/web/dist with the Bun bundler (`bun run web:build`).
//
//   dist/index.html            references the entry CSS and JS by absolute /app/assets URLs
//   dist/assets/*-[hash].js    entry + split chunks (publicPath /app/assets/)
//   dist/assets/*-[hash].css   bundled CSS: design tokens + global styles + CSS Modules
//   dist/assets/pretendard-[hash].css + PretendardVariable.subset.N-[hash].woff2
//                              self-hosted Pretendard (D-P2-7), see emitFonts
//
// The server serves this directory at /app (apps/server/src/web-shell.ts).
//
// `--api http|fixture` picks the ApiClient (src/api/index.ts). Production builds use the
// real /api/v2 (`http`, the default); `--dev` builds default to the fixtures. `--out`
// writes elsewhere (the fixture e2e build goes to dist-fixture/).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ASSET_PATH, renderIndexHtml } from "./html.ts";

export const WEB_ROOT = join(import.meta.dir, "..");
export const DIST_DIR = join(WEB_ROOT, "dist");

export const FIXTURE_DIST_DIR = join(WEB_ROOT, "dist-fixture");

export const FONT_DIR = join(WEB_ROOT, "src/styles/fonts/pretendard");

export type ApiMode = "http" | "fixture";

export interface BuildOptions {
  outDir?: string;
  /** Development builds keep names readable and add linked source maps. */
  dev?: boolean;
  /** Which ApiClient the bundle uses (default: `fixture` for dev builds, `http` otherwise). */
  api?: ApiMode;
}

/** `--name value` from argv, or undefined. */
export function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
}

export function apiArg(): ApiMode | undefined {
  const value = argValue("api");
  if (value === undefined) return undefined;
  if (value !== "http" && value !== "fixture") throw new Error(`--api must be http or fixture, not ${value}`);
  return value;
}

export async function buildWeb({ outDir = DIST_DIR, dev = false, api = dev ? "fixture" : "http" }: BuildOptions = {}) {
  const started = performance.now();
  rmSync(outDir, { recursive: true, force: true });
  const assetsDir = join(outDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const result = await Bun.build({
    entrypoints: [join(WEB_ROOT, "src/main.tsx")],
    outdir: assetsDir,
    publicPath: ASSET_PATH,
    target: "browser",
    format: "esm",
    splitting: true,
    minify: !dev,
    sourcemap: dev ? "linked" : "none",
    naming: { entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    define: {
      "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
      "process.env.LECTERN_WEB_API": JSON.stringify(api),
    },
  });
  if (!result.success) {
    for (const message of result.logs) console.error(message);
    throw new Error("web build failed");
  }

  const url = (path: string) => ASSET_PATH + relative(assetsDir, path).split("\\").join("/");
  const scripts = result.outputs.filter((o) => o.kind === "entry-point" && o.path.endsWith(".js")).map((o) => url(o.path));
  // Bun emits the CSS imported by the entry as an asset next to it. The app stylesheet stays
  // first (it carries REACT_ARIA_STYLE_ID); the font faces follow.
  const styles = [...result.outputs.filter((o) => o.path.endsWith(".css")).map((o) => url(o.path)), emitFonts(assetsDir)];
  writeFileSync(join(outDir, "index.html"), renderIndexHtml({ styles, scripts }));

  const bytes = result.outputs.reduce((sum, o) => sum + o.size, 0);
  console.log(
    `web: built ${result.outputs.length} files (api: ${api}) (${(bytes / 1024).toFixed(0)} KiB) into ${relative(process.cwd(), outDir) || "."} in ${Math.round(performance.now() - started)} ms`,
  );
  return { scripts, styles, outputs: result.outputs.map((o) => o.path) };
}

const shortHash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex").slice(0, 10);

/**
 * Self-hosted Pretendard (D-P2-7): copies each woff2 subset into assets under a content
 * hash, writes a small stylesheet whose @font-face rules point at those files, and returns
 * its URL. The fonts stay out of the CSS bundle, which would inline every subset as a
 * data: URL (about 4 MB); as files the browser fetches only the unicode-range subsets a
 * page uses. The SIL OFL licence ships next to them.
 */
export function emitFonts(assetsDir: string): string {
  let css = readFileSync(join(FONT_DIR, "pretendard.css"), "utf8").replace(
    /url\(\.\/woff2-dynamic-subset\/([\w.-]+)\.woff2\)/g,
    (_, name: string) => {
      const bytes = readFileSync(join(FONT_DIR, "woff2-dynamic-subset", `${name}.woff2`));
      const file = `${name}-${shortHash(bytes)}.woff2`;
      writeFileSync(join(assetsDir, file), bytes);
      return `url(${ASSET_PATH}${file})`;
    },
  );
  if (css.includes("./woff2")) throw new Error("pretendard.css has a font URL emitFonts does not understand");
  const licence = readFileSync(join(FONT_DIR, "LICENSE.txt"));
  const licenceFile = `pretendard-LICENSE-${shortHash(licence)}.txt`;
  writeFileSync(join(assetsDir, licenceFile), licence);
  // Drop comments (the licence text ships as its own file) and collapse whitespace.
  css = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};:,])\s*/g, "$1")
    .trim();
  css = `/* Pretendard, SIL Open Font License 1.1: ${licenceFile} */\n${css}\n`;
  const file = `pretendard-${shortHash(css)}.css`;
  writeFileSync(join(assetsDir, file), css);
  return ASSET_PATH + file;
}

if (import.meta.main) {
  const out = argValue("out");
  await buildWeb({ dev: process.argv.includes("--dev"), api: apiArg(), ...(out ? { outDir: resolve(process.cwd(), out) } : {}) });
}
