// Self-hosted Pretendard on the real server (production CSP, D-P2-7): the login screen
// loads the font from /app/assets with no request to another origin.

import { expect, test } from "../fixtures.ts";
import { checkFonts } from "../font-check.ts";

test("Pretendard loads under the server's CSP with no outside request", async ({ page }) => {
  await checkFonts(page, "/app/login", async (p) => {
    await expect(p.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  });
});
