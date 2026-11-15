// Keyboard-only helpers for the journey e2e (P7-04): every step reaches its control with Tab
// or arrow keys and acts with Enter, Space or typing. Reading the page is free.

import { expect, type Page } from "@playwright/test";
import { tabTo } from "./fixtures.ts";

export { tabTo };

/** The focused element's accessible name, read the way `tabTo` reads it ("" on <body>). */
export function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "";
    const labelled = el.getAttribute("aria-labelledby");
    const byIds = labelled
      ?.split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    const byLabel = (el as HTMLInputElement).labels?.[0]?.textContent;
    return (el.getAttribute("aria-label") ?? byIds ?? (el.textContent || byLabel) ?? "").trim();
  });
}

const matches = (focused: string, name: string | RegExp) => (typeof name === "string" ? focused.includes(name) : name.test(focused));

/** Types into the focused field (the caller reached it with Tab). Never uses locator.fill(). */
export async function typeInto(page: Page, text: string): Promise<void> {
  const hasValue = await page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    return Boolean(el && "value" in el && el.value);
  });
  if (hasValue) await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}

/** Presses `key` until the focused element's accessible name matches; fails after `max` presses. */
export async function pressUntil(page: Page, key: string, name: string | RegExp, max = 40): Promise<void> {
  for (let i = 0; i <= max; i++) {
    if (matches(await focusedName(page), name)) return;
    if (i < max) await page.keyboard.press(key);
  }
  throw new Error(`could not reach "${name}" with ${key} (focused: "${await focusedName(page)}")`);
}

/** The focused element is visible and matches :focus-visible. */
export async function expectFocusVisible(page: Page): Promise<void> {
  const state = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { focused: false, visible: false, focusVisible: false };
    const box = el.getBoundingClientRect();
    return { focused: true, visible: box.width > 0 && box.height > 0, focusVisible: el.matches(":focus-visible") };
  });
  expect(state, "the focused element shows a keyboard focus ring").toEqual({ focused: true, visible: true, focusVisible: true });
}

/** Activates the focused control with Enter (or Space when `space` is true). */
export async function activate(page: Page, space = false): Promise<void> {
  await page.keyboard.press(space ? "Space" : "Enter");
}

/** Presses Tab until the focus is inside `selector` (a grid whose rows take arrow keys, say). */
export async function tabInto(page: Page, selector: string, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((sel) => Boolean(document.activeElement?.closest(sel)), selector)) return;
  }
  throw new Error(`could not reach ${selector} with Tab`);
}

/**
 * Tabs into `selector` (the first match) and out again: no keyboard trap. A table without a
 * focusable cell is passed over, which is fine too; what matters is that Tab leaves it.
 */
export async function tabThrough(page: Page, selector: string, max = 400): Promise<void> {
  const where = () =>
    page.evaluate((sel) => {
      const box = document.querySelector(sel);
      const el = document.activeElement;
      if (!box || !el || el === document.body) return "outside";
      if (box.contains(el)) return "inside";
      return box.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING ? "after" : "before";
    }, selector);
  const focusable = await page.evaluate(
    (sel) => Boolean(document.querySelector(sel)?.querySelector("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex='0']")),
    selector,
  );
  let entered = false;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const at = await where();
    if (at === "inside") entered = true;
    // Out again: past it, or (nothing focusable after it) round to the page's start.
    else if (entered) return;
    else if (!focusable && at === "after") return;
  }
  throw new Error(`Tab did not ${entered || !focusable ? "leave" : "enter"} ${selector} within ${max} presses`);
}
