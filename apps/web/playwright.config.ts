// End-to-end checks of the built app (`bun run web:e2e`): axe on the core screens and a
// keyboard-only path from upload to the document. Specs are named *.e2e.ts so `bun test`
// (which picks up *.test.* and *.spec.*) never runs them.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4174;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  // Serves apps/web/dist through the production /app handler with a CSP stricter than
  // production's. No API server, database or HOME files are involved.
  webServer: {
    command: `bun scripts/serve.ts --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/app/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
