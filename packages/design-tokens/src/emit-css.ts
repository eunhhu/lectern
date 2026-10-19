// tokens.css: custom properties on :root. Mode-independent tokens come first; themed
// tokens get a light block (the default), a prefers-color-scheme fallback, and an
// explicit [data-theme] override that also works on any subtree.

import type { Rgba } from "./color.ts";
import { toHex6 } from "./color.ts";
import type { Token, TokenSet, TokenValue } from "./dtcg.ts";
import { cssVar, GENERATED_NOTICE, num } from "./format.ts";

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
  "BlinkMacSystemFont",
]);

export function cssColor(c: Rgba): string {
  if (c.a >= 1) return toHex6(c);
  const [r, g, b] = [c.r, c.g, c.b].map((v) => Math.round(v * 255));
  return `rgb(${r} ${g} ${b} / ${num(c.a)})`;
}

function family(list: string[]): string {
  return list.map((f) => (GENERIC_FAMILIES.has(f) || /^[A-Za-z][A-Za-z0-9-]*$/.test(f) ? f : JSON.stringify(f))).join(", ");
}

/** One or more `--name: value` declarations for a token in one mode. */
function declarations(token: Token, value: TokenValue): [string, string][] {
  const name = cssVar(token);
  switch (value.type) {
    case "color":
      return [[name, cssColor(value.value)]];
    case "dimension":
    case "duration":
      return [[name, `${num(value.value.value)}${value.value.unit}`]];
    case "fontFamily":
      return [[name, family(value.value)]];
    case "fontWeight":
    case "number":
      return [[name, num(value.value)]];
    case "cubicBezier":
      return [[name, `cubic-bezier(${value.value.map(num).join(", ")})`]];
    case "shadow":
      return [
        [
          name,
          value.value
            .map((l) =>
              [l.inset ? "inset" : "", ...[l.offsetX, l.offsetY, l.blur, l.spread].map((d) => `${num(d.value)}${d.unit}`), cssColor(l.color)]
                .filter(Boolean)
                .join(" "),
            )
            .join(", "),
        ],
      ];
    case "typography": {
      // Usable as `font: var(--typography-body)`; letter-spacing is not part of the shorthand.
      const t = value.value;
      return [
        [name, `${num(t.fontWeight)} ${num(t.fontSize.value)}${t.fontSize.unit}/${num(t.lineHeight)} ${family(t.fontFamily)}`],
        [`${name}-letter-spacing`, `${num(t.letterSpacing.value)}${t.letterSpacing.unit}`],
      ];
    }
  }
}

function block(selector: string, lines: string[], indent = ""): string {
  return `${indent}${selector} {\n${lines.map((l) => `${indent}  ${l}`).join("\n")}\n${indent}}`;
}

export function emitCss(set: TokenSet): string {
  const exported = set.tokens.filter((t) => t.exported);
  const [defaultMode, ...otherModes] = set.modes;
  const decl = (t: Token, mode: string) => declarations(t, t.values[mode]!).map(([k, v]) => `${k}: ${v};`);

  const out = [`/* ${GENERATED_NOTICE} */`];
  out.push(block(":root", exported.filter((t) => !t.themed).flatMap((t) => decl(t, defaultMode!))));
  const themed = (mode: string) => [`color-scheme: ${mode};`, ...exported.filter((t) => t.themed).flatMap((t) => decl(t, mode))];
  out.push(block(`:root,\n[data-theme="${defaultMode}"]`, themed(defaultMode!)));
  for (const mode of otherModes) {
    out.push(`@media (prefers-color-scheme: ${mode}) {\n${block(`:root:not([data-theme="${defaultMode}"])`, themed(mode), "  ")}\n}`);
    out.push(block(`[data-theme="${mode}"]`, themed(mode)));
  }
  return out.join("\n\n") + "\n";
}
