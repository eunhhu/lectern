import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PRICING, priceFor } from "../src/ledger.ts";
import { loadRouting, ROUTING_PATH } from "../src/routing.ts";

const dir = mkdtempSync(join(tmpdir(), "lectern-routing-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function variant(edit: (routing: Record<string, any>) => void): string {
  const routing = JSON.parse(readFileSync(ROUTING_PATH, "utf8"));
  edit(routing);
  const path = join(dir, `routing-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(routing));
  return path;
}

describe("routing.json", () => {
  test("loads the shipped routing", () => {
    const routing = loadRouting();
    expect(Object.keys(routing).sort()).toEqual(["classify", "extract", "ocr", "repair", "structure"]);
    expect(routing.classify.model).toBe("gemini-3.5-flash-lite");
    expect(routing.structure.maxOutputTokens).toBe(16384);
    for (const stage of ["structure", "extract", "repair", "ocr"] as const) {
      expect(routing[stage].model).toBe("gemini-3.8-flash");
    }
  });

  test("rejects a model outside the allowlist", () => {
    const path = variant((r) => (r.structure.model = "gemini-9-pro"));
    expect(() => loadRouting(path)).toThrow("routing.structure");
  });

  test("rejects a -latest alias", () => {
    const path = variant((r) => (r.extract.model = "gemini-flash-latest"));
    expect(() => loadRouting(path)).toThrow();
  });

  test("rejects a missing stage", () => {
    const path = variant((r) => delete r.ocr);
    expect(() => loadRouting(path)).toThrow();
  });

  test("both models have a price", () => {
    const routing = loadRouting();
    const models = new Set(Object.values(routing).map((r) => r.model));
    expect(models.size).toBe(2);
    for (const model of models) {
      expect(priceFor(DEFAULT_PRICING, "gemini", model, Date.parse("2026-11-01"))).not.toBeNull();
    }
  });
});
