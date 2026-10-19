// Evaluates the contrast pairs declared in tokens.json, per mode, exactly as the colours
// render: translucent surface layers are composited bottom-up, then a translucent
// foreground is composited over the result.

import { contrast, flatten, type Rgba } from "./color.ts";
import { expandPattern, type TokenSet } from "./dtcg.ts";

export interface PairResult {
  role: "text" | "ui";
  min: number;
  fg: string;
  mode: string;
  /** Surface stack, bottom first, e.g. `color.bg.panel + color.bg.hover`. */
  surface: string;
  ratio: number;
  pass: boolean;
}

function colorOf(set: TokenSet, name: string, mode: string): Rgba {
  const token = set.byName.get(name);
  if (!token) throw new Error(`contrast: no token named ${name}`);
  const value = token.values[mode]!;
  if (value.type !== "color") throw new Error(`contrast: ${name} is not a color`);
  return value.value;
}

export function surfaceLabel(stack: string[]): string {
  return stack.join(" + ");
}

export function evaluateContrast(set: TokenSet): PairResult[] {
  const names = set.tokens.map((t) => t.name);
  const results: PairResult[] = [];
  for (const pair of set.contrast.pairs) {
    const fgs = pair.fg.flatMap((p) => expandPattern(p, names));
    const stacks = pair.on.flatMap((group) => {
      const list = set.contrast.surfaces[group];
      if (!list) throw new Error(`contrast: unknown surface group ${group}`);
      return list;
    });
    for (const mode of set.modes) {
      for (const fg of fgs) {
        const fgColor = colorOf(set, fg, mode);
        for (const stack of stacks) {
          const bg = flatten(stack.map((name) => colorOf(set, name, mode)));
          const ratio = contrast(fgColor, bg);
          results.push({ role: pair.role, min: pair.min, fg, mode, surface: surfaceLabel(stack), ratio, pass: ratio >= pair.min });
        }
      }
    }
  }
  return results;
}

/**
 * Every exported colour token must be accounted for: checked as a foreground, used as a
 * surface, or listed as exempt with a reason. Returns the names that are none of these.
 */
export function unclassifiedColors(set: TokenSet): string[] {
  const names = set.tokens.map((t) => t.name);
  const covered = new Set<string>();
  for (const pair of set.contrast.pairs) for (const p of pair.fg) for (const n of expandPattern(p, names)) covered.add(n);
  for (const stacks of Object.values(set.contrast.surfaces)) for (const stack of stacks) for (const n of stack) covered.add(n);
  for (const p of Object.keys(set.contrast.exempt)) for (const n of expandPattern(p, names)) covered.add(n);
  return set.tokens.filter((t) => t.type === "color" && t.exported && !covered.has(t.name)).map((t) => t.name);
}
