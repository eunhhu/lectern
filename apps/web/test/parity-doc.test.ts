// docs/v2/pipeline/PARITY.md stays honest (P2-08): every row has six cells and a status,
// every 있음 row names e2e tests that exist, every 없음 row gives a reason, the count line
// matches, and every data-action in the v1 screens (apps/server/src/ui.ts) is in the doc.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const DOC = readFileSync(join(ROOT, "docs/v2/pipeline/PARITY.md"), "utf8");
const E2E = join(ROOT, "apps/web/e2e");

interface Row {
  n: string;
  feature: string;
  v1: string;
  where: string;
  tests: string;
  status: string;
  cells: number;
}

const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const rows: Row[] = DOC.split("\n")
  .filter((l) => /^\|\s*\d+\s*\|/.test(l))
  .map((l) => {
    const c = cellsOf(l);
    return { n: c[0]!, feature: c[1]!, v1: c[2]!, where: c[3]!, tests: c[4]!, status: c[5] ?? "", cells: c.length };
  });

/**
 * `file › title` entries of a row, joined by `;`. A title may hold `;` itself, so only a
 * `;` followed by a spec file name separates entries. A file under apps/web/test is a
 * unit-test exception.
 */
const testsOf = (row: Row) =>
  row.tests
    .split(/;\s*(?=(?:server\/)?[\w.-]+\.e2e\.ts ›|apps\/web\/test\/)/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const at = t.indexOf(" › ");
      return at < 0 ? { file: t, title: "" } : { file: t.slice(0, at).trim(), title: t.slice(at + 3).trim() };
    });

describe("PARITY.md", () => {
  test("the table has rows, six cells each, and a 있음/없음 status", () => {
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      expect(row.cells, `row ${row.n}`).toBe(6);
      expect(row.status, `row ${row.n}`).toMatch(/^(있음|없음)/);
    }
  });

  test("있음 rows name tests; 없음 rows give a reason", () => {
    for (const row of rows) {
      if (row.status.startsWith("있음")) expect(row.tests, `row ${row.n}`).not.toBe("-");
      else {
        expect(row.where.startsWith("없음:"), `row ${row.n}`).toBe(true);
        expect(row.tests, `row ${row.n}`).toBe("-");
      }
    }
  });

  test("every named e2e test exists in its file", () => {
    for (const row of rows.filter((r) => r.status.startsWith("있음"))) {
      for (const { file, title } of testsOf(row)) {
        if (file.startsWith("apps/web/test/")) {
          expect(existsSync(join(ROOT, file)), `row ${row.n}: ${file}`).toBe(true);
          continue;
        }
        const path = join(E2E, file);
        expect(existsSync(path), `row ${row.n}: ${file}`).toBe(true);
        expect(title, `row ${row.n}: ${file} has no title`).not.toBe("");
        const source = readFileSync(path, "utf8");
        const found = source.includes(`test("${title}"`) || source.includes(`test(\`${title}\``);
        expect(found, `row ${row.n}: ${file} › ${title}`).toBe(true);
      }
    }
  });

  test("the 없음 count line matches the table", () => {
    const last = DOC.trim().split("\n").at(-1)!;
    const match = last.match(/^없음 행: (\d+)개$/);
    expect(match, "last line").not.toBeNull();
    expect(Number(match![1])).toBe(rows.filter((r) => r.status.startsWith("없음")).length);
  });

  test("every data-action in ui.ts appears in the doc", () => {
    const ui = readFileSync(join(ROOT, "apps/server/src/ui.ts"), "utf8");
    const actions = new Set([...ui.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]!));
    expect(actions.size).toBeGreaterThan(30);
    const missing = [...actions].filter((a) => !DOC.includes(`\`${a}\``));
    expect(missing).toEqual([]);
  });
});
