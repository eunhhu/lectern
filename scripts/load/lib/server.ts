// Starts the server under test in a sandbox and samples its memory. Two modes:
// - e2e: apps/web/e2e/server/start.ts (its own temp dir, a fake Gemini at the fetch boundary,
//   the v2 pipeline turned on through POST /__e2e/pipeline), so processing runs without AI;
// - plain: apps/server/src/index.ts on a checked throwaway root with a minimal environment and
//   LECTERN_WORKER_MODE=external (no job runs, so nothing calls an AI provider).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "../../../apps/web/e2e/server/accounts.ts";
import { health } from "./client.ts";
import { assertSandboxDir, REPO_ROOT } from "./guard.ts";

export interface Sandbox {
  baseUrl: string;
  mode: "e2e" | "plain";
  processing: "on" | "unavailable" | "off";
  /** null in e2e mode (start.ts owns its temp dir). */
  dataDir: string | null;
  maxRssBytes(): number;
  alive(): boolean;
  stop(): Promise<void>;
}

/** Secrets that must never reach the child, even through a .env Bun might load: blanked. */
const BLANKED = ["GEMINI_API_KEY", "RESEND_API_KEY", "LECTERN_DEPLOY_TOKEN", "LECTERN_OWNER_API_TOKEN"];

function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  return port!;
}

async function waitHealthy(baseUrl: string, child: { exitCode: number | null }, timeoutMs: number): Promise<void> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`the server exited early (code ${child.exitCode})`);
    if ((await health(baseUrl)) === 200) return;
    await Bun.sleep(250);
  }
  throw new Error(`the server did not answer /api/health within ${timeoutMs / 1000} s`);
}

/** Plain mode's environment: only what the server needs, nothing inherited but PATH. */
export function plainEnv(root: string, port: number): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LECTERN_DATA_DIR: join(root, "data"),
    LECTERN_LECTURES_DIR: join(root, "lectures"),
    HOME: join(root, "home"),
    LECTERN_RESEND_CREDENTIALS_FILE: join(root, "no-credentials.json"),
    PORT: String(port),
    LECTERN_BASE_URL: `http://127.0.0.1:${port}`,
    LECTERN_OWNER_EMAIL: E2E_OWNER_EMAIL,
    LECTERN_OWNER_PASSWORD: E2E_OWNER_PASSWORD,
    LECTERN_OWNER_NAME: "부하 시험",
    LECTERN_WORKER_MODE: "external",
    LECTERN_LOG_REQUESTS: "0",
  };
  for (const key of BLANKED) env[key] = "";
  return env;
}

export async function startSandbox(options: { processing: boolean; dataRoot?: string; port?: number }): Promise<Sandbox> {
  const port = options.port ?? freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let madeRoot: string | null = null;
  let dataDir: string | null = null;
  let child: ReturnType<typeof Bun.spawn>;
  const mode: Sandbox["mode"] = options.processing ? "e2e" : "plain";

  if (options.processing) {
    child = Bun.spawn(["bun", "apps/web/e2e/server/start.ts", "--port", String(port)], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdout: "ignore",
      stderr: "inherit",
    });
  } else {
    const root = options.dataRoot ?? (madeRoot = mkdtempSync(join(tmpdir(), "lectern-load-")));
    // mkdtemp made it empty; a given root is checked (refused when it could hold real data).
    const checked = options.dataRoot ? assertSandboxDir(root) : root;
    for (const sub of ["data", "lectures", "home"]) assertSandboxDir(join(checked, sub));
    dataDir = join(checked, "data");
    child = Bun.spawn(["bun", "apps/server/src/index.ts"], {
      cwd: REPO_ROOT,
      env: plainEnv(checked, port),
      stdout: "ignore",
      stderr: "inherit",
    });
  }

  let maxRss = 0;
  const sampler = setInterval(() => {
    try {
      const ps = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(child.pid)], { stdout: "pipe", stderr: "ignore" });
      const kib = Number(new TextDecoder().decode(ps.stdout).trim());
      if (Number.isFinite(kib) && kib * 1024 > maxRss) maxRss = kib * 1024;
    } catch {
      // ps unavailable: memory stays unknown (0)
    }
  }, 1000);

  let stopped = false;
  const killNow = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  // exit cannot wait: kill outright. A signal (Ctrl-C) stops gracefully, so start.ts removes
  // its temp dir (over 1 GB after a long run), then exits.
  const onExit = () => killNow();
  const onSignal = () => {
    void stop().finally(() => process.exit(130));
  };
  process.on("exit", onExit);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearInterval(sampler);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const ended = await Promise.race([child.exited.then(() => true), Bun.sleep(10_000).then(() => false)]);
      if (!ended) {
        child.kill("SIGKILL");
        await child.exited;
      }
    }
    process.off("exit", onExit);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (madeRoot) rmSync(madeRoot, { recursive: true, force: true });
  };

  try {
    await waitHealthy(baseUrl, child, 60_000);
  } catch (err) {
    await stop();
    throw err;
  }

  let processing: Sandbox["processing"] = "off";
  if (options.processing) {
    const res = await fetch(`${baseUrl}/__e2e/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "v2" }),
    }).catch(() => null);
    processing = res?.status === 200 ? "on" : "unavailable";
    await res?.arrayBuffer();
  }

  return {
    baseUrl,
    mode,
    processing,
    dataDir,
    maxRssBytes: () => maxRss,
    alive: () => child.exitCode === null && child.signalCode === null,
    stop,
  };
}
