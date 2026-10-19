import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

const SRC = join(import.meta.dir, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
  );
}

describe("@lectern/domain package boundary", () => {
  test("zod is the only runtime dependency", () => {
    expect(Object.keys(pkg.dependencies)).toEqual(["zod"]);
    expect(pkg).not.toHaveProperty("devDependencies");
    expect(pkg).not.toHaveProperty("peerDependencies");
  });

  test("src imports nothing but zod and its own files", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const [, specifier] of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        if (specifier === "zod" || specifier.startsWith("./") || specifier.startsWith("../")) continue;
        offenders.push(`${file}: ${specifier}`);
      }
      // Relative imports must not climb out of the package.
      for (const [, specifier] of text.matchAll(/from\s*["'](\.\.\/\.\.\/[^"']*)["']/g)) {
        offenders.push(`${file}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
