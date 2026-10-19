// Test sandbox: loaded via bunfig.toml [test] preload (and imported first by
// the server tests as a fallback) so no test ever touches the real database,
// the lecture archive, the ~/local.env Gemini key, or outbound email.
import { afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.LECTERN_TEST_SANDBOX) {
  const root = mkdtempSync(join(tmpdir(), "lectern-test-"));
  const dataDir = join(root, "data");
  const lecturesDir = join(root, "lectures");
  const homeDir = join(root, "home");
  for (const dir of [dataDir, lecturesDir, homeDir]) {
    mkdirSync(dir, { recursive: true });
  }

  process.env.LECTERN_TEST_SANDBOX = root;
  process.env.LECTERN_DATA_DIR = dataDir;
  process.env.LECTERN_LECTURES_DIR = lecturesDir;
  process.env.HOME = homeDir;
  // The server falls back to a host credentials file for the Resend key; never read it.
  process.env.LECTERN_RESEND_CREDENTIALS_FILE = join(root, "no-credentials.json");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  for (const key of [
    "GEMINI_API_KEY",
    "RESEND_API_KEY",
    "LECTERN_DEPLOY_TOKEN",
    "LECTERN_OWNER_EMAIL",
    "LECTERN_OWNER_ALIASES",
    "LECTERN_OWNER_API_TOKEN",
    "LECTERN_FORCE_RESET_OWNER_PASSWORD",
    "LECTERN_BASE_URL",
  ]) {
    delete process.env[key];
  }
}
