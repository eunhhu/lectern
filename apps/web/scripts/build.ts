// Builds apps/web into apps/web/dist with the Bun bundler (`bun run web:build`).
//
//   dist/index.html            references the entry CSS and JS by absolute /app/assets URLs
//   dist/assets/*-[hash].js    entry + split chunks (publicPath /app/assets/)
//   dist/assets/*-[hash].css   bundled CSS: design tokens + global styles + CSS Modules
//
// The server serves this directory at /app (apps/server/src/web-shell.ts).
//
// `--api http|fixture` picks the ApiClient (src/api/index.ts). Production builds use the
// real /api/v2 (`http`, the default); `--dev` builds default to the fixtures. `--out`
// writes elsewhere (the fixture e2e build goes to dist-fixture/).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ASSET_PATH, renderIndexHtml } from "./html.ts";

export const WEB_ROOT = join(import.meta.dir, "..");
export const DIST_DIR = join(WEB_ROOT, "dist");

export const FIXTURE_DIST_DIR = join(WEB_ROOT, "dist-fixture");

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
  // Bun emits the CSS imported by the entry as an asset next to it.
  const styles = result.outputs.filter((o) => o.path.endsWith(".css")).map((o) => url(o.path));
  writeFileSync(join(outDir, "index.html"), renderIndexHtml({ styles, scripts }));

  const bytes = result.outputs.reduce((sum, o) => sum + o.size, 0);
  console.log(
    `web: built ${result.outputs.length} files (api: ${api}) (${(bytes / 1024).toFixed(0)} KiB) into ${relative(process.cwd(), outDir) || "."} in ${Math.round(performance.now() - started)} ms`,
  );
  return { scripts, styles, outputs: result.outputs.map((o) => o.path) };
}

if (import.meta.main) {
  const out = argValue("out");
  await buildWeb({ dev: process.argv.includes("--dev"), api: apiArg(), ...(out ? { outDir: join(process.cwd(), out) } : {}) });
}
