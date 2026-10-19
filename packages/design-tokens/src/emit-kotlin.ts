// Tokens.kt for Jetpack Compose. Themed groups (colours, elevation) become an @Immutable
// data class with one instance per mode, meant to be provided through a CompositionLocal;
// everything else is a constant on the LecternTokens object.

import type { Rgba } from "./color.ts";
import { toRgbInt } from "./color.ts";
import type { ShadowLayer, Token, TokenSet, TokenValue } from "./dtcg.ts";
import { float, GENERATED_NOTICE, hex6, memberName, num } from "./format.ts";

const OBJECTS: Record<string, string> = {
  space: "Space",
  size: "Size",
  radius: "Radius",
  font: "Fonts",
  typography: "TextStyles",
  motion: "Motion",
  z: "ZIndex",
};

/** Themed groups → the data class that holds one mode's values. */
const THEMED: Record<string, { cls: string; instance: (mode: string) => string; doc: string }> = {
  color: {
    cls: "LecternColors",
    instance: (mode) => `Lectern${cap(mode)}Colors`,
    doc: "테마에 따라 바뀌는 색. 모드별 인스턴스 중 하나를 CompositionLocal로 내려준다.",
  },
  shadow: {
    cls: "LecternElevation",
    instance: (mode) => `Lectern${cap(mode)}Elevation`,
    doc: "테마에 따라 바뀌는 그림자(겹 목록). Compose 기본 shadow는 색을 받지 않으므로 직접 그릴 때 쓴다.",
  },
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function color(c: Rgba): string {
  if (c.a >= 1) return `Color(0xFF${hex6(toRgbInt(c))})`;
  const ch = (v: number) => `${float(Math.round(v * 255) / 255)}f`;
  return `Color(red = ${ch(c.r)}, green = ${ch(c.g)}, blue = ${ch(c.b)}, alpha = ${float(c.a)}f)`;
}

function dp(d: { value: number; unit: string }): string {
  const v = d.unit === "rem" ? d.value * 16 : d.value;
  return v < 0 ? `(${num(v)}).dp` : `${num(v)}.dp`;
}

function sp(d: { value: number; unit: string }): string {
  const v = d.unit === "rem" ? d.value * 16 : d.value;
  return v < 0 ? `(${num(v)}).sp` : `${num(v)}.sp`;
}

function shadow(layers: ShadowLayer[]): string {
  return `listOf(${layers
    .map((l) => {
      if (l.inset) throw new Error("Kotlin: inset shadows are not supported");
      return `LecternShadow(${color(l.color)}, ${dp(l.offsetX)}, ${dp(l.offsetY)}, ${dp(l.blur)}, ${dp(l.spread)})`;
    })
    .join(", ")})`;
}

function constant(token: Token, value: TokenValue, monoFamily: string): string {
  const name = memberName(token);
  switch (value.type) {
    case "dimension":
      return token.path[0] === "font" ? `val ${name} = ${sp(value.value)}` : `val ${name} = ${dp(value.value)}`;
    case "duration":
      return `const val ${name}: Int = ${num(value.value.unit === "s" ? value.value.value * 1000 : value.value.value)}`;
    case "fontFamily":
      return `val ${name}: List<String> = listOf(${value.value.map((f) => JSON.stringify(f)).join(", ")})`;
    case "fontWeight":
      return `val ${name} = FontWeight(${num(value.value)})`;
    case "number":
      return `const val ${name}: Float = ${float(value.value)}f`;
    case "cubicBezier":
      return `val ${name} = CubicBezierEasing(${value.value.map((v) => `${float(v)}f`).join(", ")})`;
    case "typography": {
      const t = value.value;
      const family = t.fontFamily[0] === monoFamily ? "FontFamily.Monospace" : "FontFamily.Default";
      return `val ${name} = TextStyle(fontFamily = ${family}, fontSize = ${sp(t.fontSize)}, fontWeight = FontWeight(${num(t.fontWeight)}), lineHeight = ${float(t.lineHeight)}.em, letterSpacing = ${sp(t.letterSpacing)})`;
    }
    case "color":
    case "shadow":
      throw new Error(`Kotlin: ${token.name} belongs in a themed class`);
  }
}

function kdoc(text: string, indent: string): string[] {
  return text ? [`${indent}/** ${text} */`] : [];
}

export function emitKotlin(set: TokenSet): string {
  const exported = set.tokens.filter((t) => t.exported);
  const monoToken = set.byName.get("font.family.mono")?.values[set.modes[0]!];
  const monoFamily = monoToken?.type === "fontFamily" ? monoToken.value[0]! : "";
  const lines = [
    `// ${GENERATED_NOTICE}`,
    "",
    "package com.qucord.lectern.design",
    "",
    "import androidx.compose.animation.core.CubicBezierEasing",
    "import androidx.compose.runtime.Immutable",
    "import androidx.compose.ui.graphics.Color",
    "import androidx.compose.ui.text.TextStyle",
    "import androidx.compose.ui.text.font.FontFamily",
    "import androidx.compose.ui.text.font.FontWeight",
    "import androidx.compose.ui.unit.Dp",
    "import androidx.compose.ui.unit.dp",
    "import androidx.compose.ui.unit.em",
    "import androidx.compose.ui.unit.sp",
    "",
    "/** 그림자 한 겹. Compose 기본 shadow 대신 직접 그릴 때 쓴다. */",
    "@Immutable",
    "data class LecternShadow(val color: Color, val offsetX: Dp, val offsetY: Dp, val blur: Dp, val spread: Dp)",
  ];

  for (const [group, spec] of Object.entries(THEMED)) {
    const tokens = exported.filter((t) => t.path[0] === group);
    if (tokens.length === 0) continue;
    const type = group === "color" ? "Color" : "List<LecternShadow>";
    lines.push("", `/** ${spec.doc} */`, "@Immutable", `data class ${spec.cls}(`);
    for (const t of tokens) {
      lines.push(...kdoc(t.description, "    "));
      lines.push(`    val ${memberName(t)}: ${type},`);
    }
    lines.push(")");
    for (const mode of set.modes) {
      lines.push("", `val ${spec.instance(mode)} = ${spec.cls}(`);
      for (const t of tokens) {
        const v = t.values[mode]!;
        const expr = v.type === "color" ? color(v.value) : v.type === "shadow" ? shadow(v.value) : "";
        if (!expr) throw new Error(`Kotlin: ${t.name} is neither a color nor a shadow`);
        lines.push(`    ${memberName(t)} = ${expr},`);
      }
      lines.push(")");
    }
  }

  lines.push("", "/** Lectern 디자인 토큰 중 테마와 무관한 값. 규칙과 사용법은 저장소 루트의 DESIGN.md를 본다. */", "object LecternTokens {");
  let first = true;
  for (const [group, obj] of Object.entries(OBJECTS)) {
    const tokens = exported.filter((t) => t.path[0] === group);
    if (tokens.length === 0) continue;
    if (!first) lines.push("");
    first = false;
    lines.push(`    object ${obj} {`);
    for (const t of tokens) {
      if (t.themed) throw new Error(`Kotlin: ${t.name} is themed but its group is not`);
      lines.push(...kdoc(t.description, "        "));
      lines.push(`        ${constant(t, t.values[set.modes[0]!]!, monoFamily)}`);
    }
    lines.push("    }");
  }
  lines.push("}");

  const known = new Set([...Object.keys(OBJECTS), ...Object.keys(THEMED)]);
  for (const t of exported) if (!known.has(t.path[0]!)) throw new Error(`Kotlin: no home for token group ${t.path[0]}`);
  return lines.join("\n") + "\n";
}
