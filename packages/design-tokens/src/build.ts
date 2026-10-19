// One generation pass: tokens.json → every file under dist/ plus the generated sections
// of DESIGN.md. The CLI (scripts/build.ts) writes them; the test regenerates them in memory
// and compares byte for byte.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateContrast, type PairResult } from "./contrast.ts";
import { parseTokens, type TokenSet } from "./dtcg.ts";
import { emitCss } from "./emit-css.ts";
import { emitKotlin } from "./emit-kotlin.ts";
import { applyBlocks, contrastBlock, referenceBlock } from "./emit-markdown.ts";
import { emitSwift } from "./emit-swift.ts";
import { GENERATED_NOTICE } from "./format.ts";

export const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
export const TOKENS_PATH = fileURLToPath(new URL("../tokens.json", import.meta.url));
export const DESIGN_MD_PATH = fileURLToPath(new URL("../../../DESIGN.md", import.meta.url));

export function loadTokenSet(path = TOKENS_PATH): TokenSet {
  return parseTokens(JSON.parse(readFileSync(path, "utf8")));
}

function emitCssModule(css: string): string {
  const literal = css.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return [
    `// ${GENERATED_NOTICE}`,
    "",
    "/** dist/tokens.css의 내용. 서버가 렌더링하는 페이지에 <style>로 인라인할 때 쓴다. */",
    `export const tokensCss: string = \`${literal}\`;`,
    "",
  ].join("\n");
}

/** Generated files, keyed by path relative to the package directory. */
export function buildOutputs(set: TokenSet): Record<string, string> {
  const css = emitCss(set);
  return {
    "dist/tokens.css": css,
    "dist/tokens-css.ts": emitCssModule(css),
    "dist/Tokens.swift": emitSwift(set),
    "dist/Tokens.kt": emitKotlin(set),
  };
}

export function designMdBlocks(set: TokenSet, results: PairResult[] = evaluateContrast(set)): Record<string, string> {
  return { reference: referenceBlock(set), contrast: contrastBlock(set, results) };
}

export function renderDesignMd(current: string, set: TokenSet, results?: PairResult[]): string {
  return applyBlocks(current, designMdBlocks(set, results));
}
