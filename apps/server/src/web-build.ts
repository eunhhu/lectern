// Release-time build of the v2 web app (apps/web). The deploy preflight runs the NEW
// release's code before the live server restarts, so it builds the app into
// apps/web/dist.next and stamps it with the release sha; the new server swaps that
// directory in as apps/web/dist when it boots. The build stays off the downtime path,
// the running server keeps serving its own /app until it is replaced, and a release
// whose web build fails never reaches the restart (the preflight fails the deploy).

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "@lectern/config";
import { logger } from "./log.ts";
import { WEB_SHELL_DIST_DIR } from "./web-shell.ts";

const WEB_DIR = join(REPO_ROOT, "apps/web");
export const WEB_STAGED_DIR = join(WEB_DIR, "dist.next");
const STAMP_FILE = ".release-sha";

/**
 * Builds the production web app into `outDir` for release `sha`. Returns false when this
 * checkout has no web app. A failed build leaves nothing behind and throws.
 */
export async function stageWebBuild(sha: string, outDir = WEB_STAGED_DIR): Promise<boolean> {
  if (!existsSync(join(WEB_DIR, "scripts/build.ts"))) return false;
  const { buildWeb } = await import("../../web/scripts/build.ts");
  rmSync(outDir, { recursive: true, force: true });
  try {
    await buildWeb({ outDir });
    writeFileSync(join(outDir, STAMP_FILE), sha);
  } catch (err) {
    rmSync(outDir, { recursive: true, force: true });
    throw err;
  }
  return true;
}

/**
 * At boot: swaps in the staged build if it was made for this exact release. A staged
 * build for another release (a deploy that failed after building, or an old one) is
 * discarded so it can never be promoted later by mistake.
 */
export function promoteStagedWebBuild(
  sha: string,
  dirs: { staged?: string; live?: string } = {}
): "promoted" | "stale" | "none" {
  const staged = dirs.staged ?? WEB_STAGED_DIR;
  const live = dirs.live ?? WEB_SHELL_DIST_DIR;
  if (!existsSync(staged)) return "none";

  let stamp = "";
  try {
    stamp = readFileSync(join(staged, STAMP_FILE), "utf8").trim();
  } catch {
    // no stamp: treated as stale
  }
  if (!stamp || stamp !== sha) {
    rmSync(staged, { recursive: true, force: true });
    logger.warn("discarded a staged web build made for another release", {
      staged_sha: stamp.slice(0, 7) || null,
      sha: sha.slice(0, 7),
    });
    return "stale";
  }

  const previous = `${live}.prev`;
  rmSync(previous, { recursive: true, force: true });
  if (existsSync(live)) renameSync(live, previous);
  renameSync(staged, live);
  rmSync(previous, { recursive: true, force: true });
  logger.info("web app build promoted", { sha: sha.slice(0, 7) });
  return "promoted";
}
