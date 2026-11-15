// P7-04: the keyboard journey acts on the page with the keyboard only, and the accessibility
// audit lists every route of the app.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");
const JOURNEY = readFileSync(join(WEB, "e2e/server/zzz-keyboard-journey.e2e.ts"), "utf8");
/** The journey's helpers press the keys for it, so their code (not their comments: "Never uses locator.fill()") is held to the same rule. */
const HELPERS = readFileSync(join(WEB, "e2e/keyboard-only.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const AUDIT = readFileSync(join(WEB, "../../docs/v2/pipeline/A11Y-AUDIT.md"), "utf8");
const ROUTER = readFileSync(join(WEB, "src/app/router.tsx"), "utf8");

const FORBIDDEN = [
  ".click(",
  ".dblclick(",
  ".tap(",
  ".hover(",
  ".dragTo(",
  ".mouse.",
  ".fill(",
  ".check(",
  ".uncheck(",
  ".selectOption(",
  ".focus(",
  ".setInputFiles(",
  ".dispatchEvent(",
  "waitForTimeout(",
];

const count = (text: string, needle: string) => text.split(needle).length - 1;

/** Every route's full path ("/app" + its parents' paths), read from the createRoute calls. */
function routePaths(source: string): string[] {
  const routes = new Map<string, { parent: string; path: string | null }>();
  for (const match of source.matchAll(/const (\w+) = createRoute\(\{([\s\S]*?)\}\);/g)) {
    const body = match[2]!;
    const parent = /getParentRoute: \(\) => (\w+)/.exec(body)?.[1] ?? "";
    const path = /path: "([^"]+)"/.exec(body)?.[1] ?? null; // a pathless layout route has an id instead
    routes.set(match[1]!, { parent, path });
  }
  // An index route ("/") and a pathless layout add nothing to their parent's path.
  const full = (name: string): string => {
    const route = routes.get(name);
    if (!route) return ""; // rootRoute
    return full(route.parent) + (route.path && route.path !== "/" ? route.path : "");
  };
  const paths = [...routes.entries()].filter(([, r]) => r.path !== null).map(([name]) => `/app${full(name)}`);
  // The home page is written "/app/" (the basepath's index); a nested index is its parent's path.
  return [...new Set(paths.map((path) => (path === "/app" ? "/app/" : path)))];
}

describe("keyboard journey", () => {
  test("journey uses the keyboard only", () => {
    for (const call of FORBIDDEN) {
      expect(JOURNEY.includes(call), `the journey calls ${call}`).toBe(false);
      expect(HELPERS.includes(call), `keyboard-only.ts calls ${call}`).toBe(false);
    }
    expect(count(JOURNEY, "keyboard.press(")).toBeGreaterThanOrEqual(20);
    expect(count(JOURNEY, "axe(page")).toBeGreaterThanOrEqual(8);
  });

  test("audit lists every route", () => {
    const paths = routePaths(ROUTER);
    expect(paths).toContain("/app/");
    expect(paths).toContain("/app/admin");
    expect(paths).toContain("/app/admin/users/$userId");
    expect(paths.length).toBeGreaterThanOrEqual(23);
    const table = AUDIT.slice(AUDIT.indexOf("## 2."), AUDIT.indexOf("## 3."));
    for (const path of paths) expect(table, `A11Y-AUDIT.md §2 lists ${path}`).toContain(`| \`${path}\` |`);
  });

  test("the manual checklist is left for a person to fill", () => {
    const checklist = AUDIT.slice(AUDIT.indexOf("## 4."));
    // Every row of the §4 and §5 tables ends with two empty cells: 결과 and 확인한 날.
    const rows = checklist.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| 확인 항목") && !line.startsWith("|---"));
    expect(rows.length).toBeGreaterThan(50);
    for (const row of rows) expect(row.endsWith("| | |"), row).toBe(true);
  });
});
