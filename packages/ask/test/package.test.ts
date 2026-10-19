import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

const SRC = join(import.meta.dir, "..", "src");
const ALLOWED = new Set(["@lectern/domain", "zod", "bun:sqlite", "node:crypto"]);

describe("@lectern/ask package boundary", () => {
  test("runtime dependencies are domain and zod only", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@lectern/domain", "zod"]);
  });

  test("src imports no app, harness or provider code", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(SRC)) {
      const text = readFileSync(join(SRC, name), "utf8");
      for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        if (spec!.startsWith("./") || ALLOWED.has(spec!)) continue;
        offenders.push(`${name}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
