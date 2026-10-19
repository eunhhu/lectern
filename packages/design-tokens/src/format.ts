// Naming and number formatting shared by the emitters.

import type { Token } from "./dtcg.ts";

export const GENERATED_NOTICE = "Generated from packages/design-tokens/tokens.json by `bun run tokens:build`. Do not edit.";

/** `color.text.primary` → `--color-text-primary`. */
export function cssVar(token: Token): string {
  return "--" + token.path.join("-");
}

/**
 * Member name inside the token's top-level group: `color.bg.raised-hover` → `bgRaisedHover`,
 * `space.4` → `s4` (identifiers cannot start with a digit, so the group's initial leads).
 */
export function memberName(token: Token): string {
  const parts = token.path.slice(1).flatMap((p) => p.split("-"));
  const camel = parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join("");
  return /^[0-9]/.test(camel) ? token.path[0]!.charAt(0) + camel : camel;
}

/** Shortest decimal for a value, without float noise (0.1 + 0.2 → 0.3). */
export function num(n: number): string {
  return String(Number(n.toFixed(4)));
}

/** Swift/Kotlin float literal: always has a decimal point. */
export function float(n: number): string {
  const s = num(n);
  return s.includes(".") || s.includes("e") ? s : s + ".0";
}

export function hex6(n: number): string {
  return n.toString(16).toUpperCase().padStart(6, "0");
}
