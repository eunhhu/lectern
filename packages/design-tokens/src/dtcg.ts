// A small reader for the W3C Design Tokens Community Group format (2025.10): groups,
// inherited $type, curly-brace aliases, and the types tokens.json uses. Modes (light/dark)
// are a Lectern extension: `$value` holds the first mode and
// `$extensions["com.qucord.lectern"].modes` holds the others.

import { parseHex, type Rgba } from "./color.ts";

export const EXTENSION = "com.qucord.lectern";

export type TokenType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "duration"
  | "cubicBezier"
  | "number"
  | "shadow"
  | "typography";

const TOKEN_TYPES = new Set<TokenType>([
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "cubicBezier",
  "number",
  "shadow",
  "typography",
]);

export interface Dimension {
  value: number;
  unit: "px" | "rem";
}

export interface Duration {
  value: number;
  unit: "ms" | "s";
}

export interface ShadowLayer {
  color: Rgba;
  offsetX: Dimension;
  offsetY: Dimension;
  blur: Dimension;
  spread: Dimension;
  inset: boolean;
}

export interface Typography {
  fontFamily: string[];
  fontSize: Dimension;
  fontWeight: number;
  letterSpacing: Dimension;
  lineHeight: number;
}

export type TokenValue =
  | { type: "color"; value: Rgba }
  | { type: "dimension"; value: Dimension }
  | { type: "fontFamily"; value: string[] }
  | { type: "fontWeight"; value: number }
  | { type: "duration"; value: Duration }
  | { type: "cubicBezier"; value: [number, number, number, number] }
  | { type: "number"; value: number }
  | { type: "shadow"; value: ShadowLayer[] }
  | { type: "typography"; value: Typography };

/** The resolved JS value for each token type. */
export interface ValueByType {
  color: Rgba;
  dimension: Dimension;
  fontFamily: string[];
  fontWeight: number;
  duration: Duration;
  cubicBezier: [number, number, number, number];
  number: number;
  shadow: ShadowLayer[];
  typography: Typography;
}

export interface Token {
  /** Dot path, e.g. `color.text.primary`. */
  name: string;
  path: string[];
  type: TokenType;
  description: string;
  /** False for tokens under a group marked `export: false` (the raw palette). */
  exported: boolean;
  /** Resolved value per mode, in the order of `modes`. */
  values: Record<string, TokenValue>;
  /** True when the modes resolve to different values. */
  themed: boolean;
}

export interface ContrastSpec {
  surfaces: Record<string, string[][]>;
  pairs: { role: "text" | "ui"; min: number; fg: string[]; on: string[] }[];
  exempt: Record<string, string>;
}

export interface TokenSet {
  modes: string[];
  tokens: Token[];
  byName: Map<string, Token>;
  contrast: ContrastSpec;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface RawToken {
  name: string;
  path: string[];
  type: TokenType;
  description: string;
  exported: boolean;
  raw: Record<string, Json>;
}

function isObject(v: Json | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function lecternExtension(node: JsonObject): JsonObject | undefined {
  const ext = node.$extensions;
  if (!isObject(ext)) return undefined;
  const ours = ext[EXTENSION];
  return isObject(ours) ? ours : undefined;
}

const ALIAS = /^\{([^{}]+)\}$/;

export function parseTokens(doc: unknown): TokenSet {
  if (!isObject(doc as Json)) throw new Error("tokens.json must be an object");
  const root = doc as JsonObject;
  const rootExt = lecternExtension(root);
  const modes = rootExt?.modes;
  if (!Array.isArray(modes) || modes.length === 0 || !modes.every((m) => typeof m === "string")) {
    throw new Error(`$extensions["${EXTENSION}"].modes must list the modes, default first`);
  }
  const modeNames = modes as string[];

  const raws: RawToken[] = [];
  const walk = (node: JsonObject, path: string[], inheritedType: TokenType | undefined, exported: boolean) => {
    const ownType = node.$type;
    if (ownType !== undefined && (typeof ownType !== "string" || !TOKEN_TYPES.has(ownType as TokenType))) {
      throw new Error(`${path.join(".") || "(root)"}: unsupported $type ${JSON.stringify(ownType)}`);
    }
    const type = (ownType as TokenType | undefined) ?? inheritedType;
    const ext = lecternExtension(node);
    const isExported = ext?.export === false ? false : exported;
    if ("$value" in node) {
      if (!type) throw new Error(`${path.join(".")}: token has no $type (own or inherited)`);
      const extModes = ext?.modes;
      if (extModes !== undefined) {
        if (!isObject(extModes)) throw new Error(`${path.join(".")}: modes must be an object`);
        for (const m of Object.keys(extModes)) {
          if (!modeNames.slice(1).includes(m)) throw new Error(`${path.join(".")}: unknown mode ${m}`);
        }
      }
      raws.push({
        name: path.join("."),
        path,
        type,
        description: typeof node.$description === "string" ? node.$description : "",
        exported: isExported,
        raw: { [modeNames[0]!]: node.$value!, ...(isObject(extModes) ? extModes : {}) },
      });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (/[{}.]/.test(key)) throw new Error(`${path.join(".")}: invalid name ${JSON.stringify(key)}`);
      if (!isObject(child)) throw new Error(`${[...path, key].join(".")}: expected a token or group`);
      walk(child, [...path, key], type, isExported);
    }
  };
  walk(root, [], undefined, true);

  const rawByName = new Map(raws.map((t) => [t.name, t]));

  // Resolves one token in one mode. An alias follows the referenced token in the same
  // mode, falling back to that token's default value when it has no value for the mode.
  const resolving = new Set<string>();
  const resolveAlias = (ref: string, mode: string, expected: TokenType, from: string): TokenValue => {
    const target = rawByName.get(ref);
    if (!target) throw new Error(`${from}: alias {${ref}} points at no token`);
    if (target.type !== expected) throw new Error(`${from}: alias {${ref}} is ${target.type}, expected ${expected}`);
    return resolveToken(target, mode);
  };
  const resolveToken = (token: RawToken, mode: string): TokenValue => {
    const key = `${token.name}@${mode}`;
    if (resolving.has(key)) throw new Error(`${token.name}: alias cycle`);
    resolving.add(key);
    try {
      const raw = token.raw[mode] ?? token.raw[modeNames[0]!]!;
      return resolveValue(raw, token.type, mode, token.name);
    } finally {
      resolving.delete(key);
    }
  };
  const resolveValue = (raw: Json, type: TokenType, mode: string, from: string): TokenValue => {
    if (typeof raw === "string") {
      const alias = ALIAS.exec(raw);
      if (alias) return resolveAlias(alias[1]!, mode, type, from);
    }
    const sub = <T extends TokenType>(v: Json | undefined, t: T, what: string): ValueByType[T] => {
      if (v === undefined) throw new Error(`${from}: missing ${what}`);
      return resolveValue(v, t, mode, `${from}.${what}`).value as ValueByType[T];
    };
    switch (type) {
      case "color":
        return { type, value: parseColor(raw, from) };
      case "dimension":
        return { type, value: parseUnitValue(raw, ["px", "rem"], from) as Dimension };
      case "duration":
        return { type, value: parseUnitValue(raw, ["ms", "s"], from) as Duration };
      case "fontFamily": {
        const list = typeof raw === "string" ? [raw] : raw;
        if (!Array.isArray(list) || list.length === 0 || !list.every((f) => typeof f === "string")) {
          throw new Error(`${from}: fontFamily must be a string or a list of strings`);
        }
        return { type, value: list as string[] };
      }
      case "fontWeight":
        if (typeof raw !== "number" || raw < 1 || raw > 1000) throw new Error(`${from}: fontWeight must be 1–1000`);
        return { type, value: raw };
      case "number":
        if (typeof raw !== "number") throw new Error(`${from}: expected a number`);
        return { type, value: raw };
      case "cubicBezier": {
        if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((n) => typeof n === "number")) {
          throw new Error(`${from}: cubicBezier must be four numbers`);
        }
        const [x1, y1, x2, y2] = raw as number[];
        if (x1! < 0 || x1! > 1 || x2! < 0 || x2! > 1) throw new Error(`${from}: cubicBezier x values must be 0–1`);
        return { type, value: [x1!, y1!, x2!, y2!] };
      }
      case "shadow": {
        const layers = Array.isArray(raw) ? raw : [raw];
        return {
          type,
          value: layers.map((layer, i) => {
            if (!isObject(layer)) throw new Error(`${from}: shadow layer ${i} must be an object`);
            return {
              color: sub(layer.color, "color", "color"),
              offsetX: sub(layer.offsetX, "dimension", "offsetX"),
              offsetY: sub(layer.offsetY, "dimension", "offsetY"),
              blur: sub(layer.blur, "dimension", "blur"),
              spread: sub(layer.spread, "dimension", "spread"),
              inset: layer.inset === true,
            };
          }),
        };
      }
      case "typography": {
        if (!isObject(raw)) throw new Error(`${from}: typography must be an object`);
        return {
          type,
          value: {
            fontFamily: sub(raw.fontFamily, "fontFamily", "fontFamily"),
            fontSize: sub(raw.fontSize, "dimension", "fontSize"),
            fontWeight: sub(raw.fontWeight, "fontWeight", "fontWeight"),
            letterSpacing: sub(raw.letterSpacing, "dimension", "letterSpacing"),
            lineHeight: sub(raw.lineHeight, "number", "lineHeight"),
          },
        };
      }
    }
  };

  const tokens: Token[] = raws.map((raw) => {
    const values: Record<string, TokenValue> = {};
    for (const mode of modeNames) values[mode] = resolveToken(raw, mode);
    const first = JSON.stringify(values[modeNames[0]!]);
    return {
      name: raw.name,
      path: raw.path,
      type: raw.type,
      description: raw.description,
      exported: raw.exported,
      values,
      themed: modeNames.some((m) => JSON.stringify(values[m]) !== first),
    };
  });

  return {
    modes: modeNames,
    tokens,
    byName: new Map(tokens.map((t) => [t.name, t])),
    contrast: parseContrastSpec(rootExt?.contrast),
  };
}

function parseColor(raw: Json, from: string): Rgba {
  if (!isObject(raw)) throw new Error(`${from}: a color $value must be a DTCG color object`);
  if (raw.colorSpace !== "srgb") throw new Error(`${from}: only the srgb colorSpace is supported`);
  const comps = raw.components;
  if (!Array.isArray(comps) || comps.length !== 3 || !comps.every((n) => typeof n === "number" && n >= 0 && n <= 1)) {
    throw new Error(`${from}: components must be three numbers in 0–1`);
  }
  const alpha = raw.alpha ?? 1;
  if (typeof alpha !== "number" || alpha < 0 || alpha > 1) throw new Error(`${from}: alpha must be 0–1`);
  const [r, g, b] = comps as number[];
  const color = { r: r!, g: g!, b: b!, a: alpha };
  if (raw.hex !== undefined) {
    // The hex member is a fallback for readers; it must say the same thing as components.
    if (typeof raw.hex !== "string") throw new Error(`${from}: hex must be a string`);
    const hex = parseHex(raw.hex);
    const off = Math.max(Math.abs(hex.r - color.r), Math.abs(hex.g - color.g), Math.abs(hex.b - color.b));
    if (off > 0.5 / 255) throw new Error(`${from}: hex ${raw.hex} does not match components ${JSON.stringify(comps)}`);
  }
  return color;
}

function parseUnitValue(raw: Json, units: string[], from: string): { value: number; unit: string } {
  if (!isObject(raw) || typeof raw.value !== "number" || typeof raw.unit !== "string" || !units.includes(raw.unit)) {
    throw new Error(`${from}: expected { value: number, unit: ${units.join(" | ")} }`);
  }
  return { value: raw.value, unit: raw.unit };
}

function parseContrastSpec(raw: Json | undefined): ContrastSpec {
  if (!isObject(raw)) throw new Error(`$extensions["${EXTENSION}"].contrast is missing`);
  const { surfaces, pairs, exempt } = raw;
  if (!isObject(surfaces) || !Array.isArray(pairs) || !isObject(exempt)) {
    throw new Error("contrast needs surfaces, pairs and exempt");
  }
  return raw as unknown as ContrastSpec;
}

/** Expands `color.status.*.fg` style patterns (`*` = one path segment) against token names. */
export function expandPattern(pattern: string, names: Iterable<string>): string[] {
  if (!pattern.includes("*")) return [pattern];
  const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.\\^$+?()[\]{}|]/g, "\\$&")).join("[^.]+") + "$");
  const out = [...names].filter((n) => re.test(n));
  if (out.length === 0) throw new Error(`pattern ${pattern} matches no token`);
  return out;
}
