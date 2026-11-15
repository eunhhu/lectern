// Shared Playwright fixtures: every test fails on a CSP violation or an uncaught error,
// and `axe` runs the WCAG 2.2 AA rule set (DESIGN.md §5.3 "자동").

import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export const test = base.extend<{ problems: string[]; axe: (page: Page, label: string) => Promise<void> }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          console.error(`CSP violation: ${e.violatedDirective} ${e.sourceFile}:${e.lineNumber}`);
        });
      });
      page.on("console", (msg) => {
        if (msg.type() === "error" && /Content Security Policy|CSP violation/.test(msg.text())) problems.push(msg.text());
      });
      page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
      await use(problems);
      expect(problems, "CSP violations or uncaught errors").toEqual([]);
    },
    { auto: true },
  ],
  axe: async ({}, use) => {
    await use(async (page, label) => {
      // Let colour transitions (a theme switch, a hover) end first, or axe reads a colour
      // half-way between two themes. Endless animations (a live status dot) are skipped.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => undefined)),
        ),
      );
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
      expect(summary, `axe violations on ${label}`).toEqual([]);
    });
  },
});

export { expect };

/** Presses Tab until the focused element's accessible name matches, failing after `max` presses. */
export async function tabTo(page: Page, name: string | RegExp, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return "";
      const labelled = el.getAttribute("aria-labelledby");
      const byIds = labelled
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      // A checkbox or radio is a hidden <input> inside its <label>: its name is the label's text.
      const byLabel = (el as HTMLInputElement).labels?.[0]?.textContent;
      return (el.getAttribute("aria-label") ?? byIds ?? (el.textContent || byLabel) ?? "").trim();
    });
    if (typeof name === "string" ? focused.includes(name) : name.test(focused)) return;
  }
  throw new Error(`could not reach "${name}" with Tab`);
}
