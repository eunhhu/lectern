// "No hand-written colours" for apps/web (DESIGN.md §2.1): every colour comes from a
// design token, and every CSS variable used is defined by the tokens or locally.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../src");
const TOKENS = readFileSync(join(import.meta.dir, "../../../packages/design-tokens/dist/tokens.css"), "utf8");

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, ext) : path.endsWith(ext) ? [path] : [];
  });
}

const css = files(SRC, ".css").map((path) => ({ path, text: readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));

describe("apps/web styles", () => {
  test("no colour literals in stylesheets", () => {
    for (const { path, text } of css) {
      const literals = text.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/g) ?? [];
      expect(literals, path).toEqual([]);
    }
  });

  test("every var() is a token or defined in the app", () => {
    const defined = new Set([...TOKENS.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (const { text } of css) for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    // Set from code (CSSOM) or by React Aria.
    for (const name of ["--progress", "--trigger-width"]) defined.add(name);
    for (const { path, text } of css) {
      const used = [...text.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!);
      expect(used.filter((name) => !defined.has(name)), path).toEqual([]);
    }
  });

  test("components never set colours or inline style strings", () => {
    for (const path of files(SRC, ".tsx")) {
      const text = readFileSync(path, "utf8");
      expect(text.match(/#[0-9a-fA-F]{6}\b|\brgba?\(|\bhsla?\(/g) ?? [], path).toEqual([]);
      expect(text.match(/setAttribute\(\s*["']style["']/g) ?? [], path).toEqual([]);
      expect(text.match(/dangerouslySetInnerHTML/g) ?? [], path).toEqual([]);
    }
  });
});
