// Self-hosted Pretendard on the fixture build (strict preview CSP, D-P2-7): no request
// leaves the app's origin, the font loads from /app/assets as font/woff2, and the body
// uses it.

import { checkFonts } from "./font-check.ts";
import { expect, test } from "./fixtures.ts";

test("Pretendard loads from the app's own assets with no outside request", async ({ page }) => {
  await checkFonts(page, "/app/library", async (p) => {
    await expect(p.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });
});
