// `bun run tokens:build`: regenerates dist/ and the generated sections of DESIGN.md from
// tokens.json, then fails if any declared contrast pair is below its threshold.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { buildOutputs, DESIGN_MD_PATH, loadTokenSet, PACKAGE_DIR, renderDesignMd } from "../src/build.ts";
import { evaluateContrast, unclassifiedColors } from "../src/contrast.ts";
import { ratio } from "../src/emit-markdown.ts";

const set = loadTokenSet();
const results = evaluateContrast(set);

for (const [file, content] of Object.entries(buildOutputs(set))) {
  const path = join(PACKAGE_DIR, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote ${relative(process.cwd(), path)}`);
}
writeFileSync(DESIGN_MD_PATH, renderDesignMd(readFileSync(DESIGN_MD_PATH, "utf8"), set, results));
console.log(`updated ${relative(process.cwd(), DESIGN_MD_PATH)}`);

const failed = results.filter((r) => !r.pass);
for (const r of failed) {
  console.error(`contrast ${ratio(r.ratio)} < ${r.min} (${r.mode}): ${r.fg} on ${r.surface}`);
}
const loose = unclassifiedColors(set);
for (const name of loose) console.error(`${name}: not checked as a foreground, not a surface, and not exempt`);
console.log(`${results.length} contrast pairs checked, ${failed.length} below threshold`);
if (failed.length > 0 || loose.length > 0) process.exit(1);
