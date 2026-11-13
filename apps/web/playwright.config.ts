// End-to-end checks of the built app (`bun run web:e2e`). Specs are named *.e2e.ts so
// `bun test` (which picks up *.test.* and *.spec.*) never runs them. Three projects:
//
// - fixture (e2e/*.e2e.ts): the fixture build (dist-fixture) behind the preview server,
//   whose CSP is stricter than production's. No API server, database or HOME files.
//   axe on the core screens and keyboard-only paths.
// - server (e2e/server/*.e2e.ts): the production build (dist) served by the real Lectern
//   server on a throwaway database with LECTERN_ASK=1 and a fake Gemini
//   (e2e/server/start.ts): login → list → detail → 물어보기 over real HTTP.
// - server-v2 (e2e/server/process.e2e.ts): after `server`, the same server switched to
//   LECTERN_PIPELINE=v2 with a job worker: upload → transcript → document → source jump.

import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT } from "./e2e/server/accounts.ts";

const FIXTURE_PORT = 4174;
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  use: {
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // Serves apps/web/dist-fixture through the production /app handler.
      command: `bun scripts/serve.ts --port ${FIXTURE_PORT} --dist dist-fixture`,
      url: `http://127.0.0.1:${FIXTURE_PORT}/app/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `bun e2e/server/start.ts --port ${E2E_PORT}`,
      url: `http://127.0.0.1:${E2E_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: "fixture", testIgnore: "server/**", use: { ...desktop, baseURL: `http://127.0.0.1:${FIXTURE_PORT}` } },
    // One worker: the tests share the server's database (threads, sessions).
    {
      name: "server",
      testMatch: "server/**/*.e2e.ts",
      testIgnore: "server/process.e2e.ts",
      fullyParallel: false,
      use: { ...desktop, baseURL: `http://127.0.0.1:${E2E_PORT}` },
    },
    // The v2 pipeline flow switches the shared server to LECTERN_PIPELINE=v2 and starts a job
    // worker, so it runs only after the rest of the server suite has finished.
    {
      name: "server-v2",
      testMatch: "server/process.e2e.ts",
      dependencies: ["server"],
      use: { ...desktop, baseURL: `http://127.0.0.1:${E2E_PORT}` },
    },
  ],
});
