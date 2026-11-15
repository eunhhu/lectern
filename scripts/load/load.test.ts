// Pure tests of the load scripts' pieces (no server is started here).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { wavBytes, writeWav } from "./lib/audio.ts";
import { partPlan, type UploadOutcome } from "./lib/client.ts";
import { assertSandboxDir, REPO_ROOT } from "./lib/guard.ts";
import { ArgsError, parseArgsOrThrow, percentile, uploadsOk } from "./lib/summary.ts";
import { plainEnv } from "./lib/server.ts";

const NO_ENV = {};
const temp = () => mkdtempSync(join(tmpdir(), "lectern-load-test-"));

describe("assertSandboxDir", () => {
  test("refuses the repository data dir", () => {
    expect(() => assertSandboxDir(join(REPO_ROOT, "data"), NO_ENV)).toThrow("load: refused");
    expect(() => assertSandboxDir(join(REPO_ROOT, "data", "x"), NO_ENV)).toThrow("load: refused");
  });

  test("refuses the configured data dir", () => {
    const root = temp();
    const configured = join(root, "a", "b");
    const env = { LECTERN_DATA_DIR: configured };
    for (const dir of [configured, join(configured, "c"), join(root, "a")]) {
      expect(() => assertSandboxDir(dir, env)).toThrow("load: refused");
    }
    expect(() => assertSandboxDir(join(root, "elsewhere"), { LECTERN_LECTURES_DIR: join(root, "elsewhere", "lectures") })).toThrow("load: refused");
    rmSync(root, { recursive: true, force: true });
  });

  test("refuses a dir with a database", () => {
    const root = temp();
    writeFileSync(join(root, "lectern.sqlite"), "");
    expect(() => assertSandboxDir(root, NO_ENV)).toThrow("lectern.sqlite");
    // Inside a data directory too.
    expect(() => assertSandboxDir(join(root, "inner"), NO_ENV)).toThrow("lectern.sqlite");
    rmSync(root, { recursive: true, force: true });
  });

  test("refuses a non-empty dir", () => {
    const root = temp();
    writeFileSync(join(root, ".DS_Store"), "");
    mkdirSync(join(root, "lost+found"));
    expect(() => assertSandboxDir(root, NO_ENV)).not.toThrow();
    writeFileSync(join(root, "something.txt"), "x");
    expect(() => assertSandboxDir(root, NO_ENV)).toThrow("not empty");
    rmSync(root, { recursive: true, force: true });
  });

  test("refuses home and root", () => {
    expect(() => assertSandboxDir("/", NO_ENV)).toThrow("load: refused");
    expect(() => assertSandboxDir(homedir(), NO_ENV)).toThrow("load: refused");
    expect(() => assertSandboxDir(REPO_ROOT, NO_ENV)).toThrow("load: refused");
  });

  test("refuses the configured data dir through a symlink", () => {
    const root = temp();
    const real = join(root, "real-data");
    mkdirSync(real);
    symlinkSync(real, join(root, "link"));
    expect(() => assertSandboxDir(join(root, "link", "x"), { LECTERN_DATA_DIR: real })).toThrow("load: refused");
    rmSync(root, { recursive: true, force: true });
  });

  test("accepts a fresh temp dir", () => {
    const root = temp();
    const dir = assertSandboxDir(join(root, "fresh"), NO_ENV);
    expect(dir.startsWith("/")).toBe(true);
    expect(dir.endsWith("/fresh")).toBe(true);
    expect(statSync(dir).isDirectory()).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("partPlan", () => {
  test("part plan covers the file", () => {
    const plan = partPlan(20_000_000, 8 * 1024 * 1024);
    expect(plan.length).toBe(3);
    expect(plan.reduce((sum, p) => sum + p.length, 0)).toBe(20_000_000);
    expect(plan.map((p) => p.part)).toEqual([1, 2, 3]);
    expect(plan[2]!.length).toBeLessThan(plan[0]!.length);
    expect(plan[1]!.offset).toBe(8 * 1024 * 1024);
  });

  test("part plan for a tiny file", () => {
    expect(partPlan(10, 8 * 1024 * 1024)).toEqual([{ part: 1, offset: 0, length: 10 }]);
  });
});

test("wav writer without ffmpeg", async () => {
  const root = temp();
  const a = join(root, "a.wav");
  const b = join(root, "b.wav");
  await writeWav(a, 2, 1);
  await writeWav(b, 2, 2);
  const bytesA = readFileSync(a);
  expect(bytesA.byteLength).toBe(wavBytes(2));
  expect(bytesA.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(bytesA.subarray(8, 12).toString("latin1")).toBe("WAVE");
  expect(Buffer.compare(bytesA, readFileSync(b))).not.toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("percentile", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  expect(percentile(values, 95)).toBe(95);
  expect(percentile(values, 50)).toBe(50);
  expect(percentile([], 95)).toBe(0);
});

test("parseArgs", () => {
  const spec = { n: { default: 3 }, minutes: { default: 10 }, "no-processing": { default: false }, out: { default: "" } };
  expect(parseArgsOrThrow(["--n", "5", "--no-processing"], spec)).toEqual({ n: 5, minutes: 10, "no-processing": true, out: "" });
  expect(() => parseArgsOrThrow(["--bogus"], spec)).toThrow(ArgsError);
  expect(() => parseArgsOrThrow(["--n", "five"], spec)).toThrow(ArgsError);
  expect(() => parseArgsOrThrow(["--n"], spec)).toThrow(ArgsError);
});

test("parseArgs exits 2 on an unknown argument", () => {
  const run = Bun.spawnSync(["bun", join(import.meta.dir, "uploads.ts"), "--bogus"], { stdout: "pipe", stderr: "pipe" });
  expect(run.exitCode).toBe(2);
  expect(new TextDecoder().decode(run.stderr)).toContain("unknown option: --bogus");
});

describe("summary ok rules", () => {
  const good: UploadOutcome = { ok: true, recordingId: "rec_1", bytes: 10, parts: 1, uploadMs: 5, status: 200, error: null };
  const server = { mode: "e2e", processing: "on", max_rss_bytes: 0, alive_at_end: true };

  test("one failed upload is not ok", () => {
    const bad: UploadOutcome = { ...good, ok: false, recordingId: null, status: 500, error: "boom" };
    expect(uploadsOk({ uploads: [good, bad], processing: [], server })).toBe(false);
  });

  test("all uploaded and processed is ok; a timeout or a dead server is not", () => {
    expect(uploadsOk({ uploads: [good], processing: [{ recording_id: "rec_1", status: "ready", ms: 1 }], server })).toBe(true);
    expect(uploadsOk({ uploads: [good], processing: [{ recording_id: "rec_1", status: "timeout", ms: 1 }], server })).toBe(false);
    expect(uploadsOk({ uploads: [good], processing: [], server: { ...server, alive_at_end: false } })).toBe(false);
  });
});

test("the plain server environment carries no secret from the parent", () => {
  const env = plainEnv("/tmp/lectern-load-x", 4999);
  for (const key of ["GEMINI_API_KEY", "RESEND_API_KEY", "LECTERN_DEPLOY_TOKEN", "LECTERN_OWNER_API_TOKEN"]) expect(env[key]).toBe("");
  expect(env.LECTERN_WORKER_MODE).toBe("external");
  expect(env.LECTERN_DATA_DIR).toBe("/tmp/lectern-load-x/data");
  expect(Object.keys(env).filter((k) => !k.startsWith("LECTERN_")).sort()).toEqual(
    ["GEMINI_API_KEY", "HOME", "PATH", "PORT", "RESEND_API_KEY"].sort(),
  );
});
