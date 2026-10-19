// The generated sections of DESIGN.md: the token reference and the contrast report.
// They live between <!-- tokens:NAME:start --> and <!-- tokens:NAME:end --> markers so the
// numbers in the document are always the ones the test enforces.

import type { PairResult } from "./contrast.ts";
import { cssColor } from "./emit-css.ts";
import type { Token, TokenSet, TokenValue } from "./dtcg.ts";
import { cssVar, num } from "./format.ts";

/** Ratios are truncated, never rounded up, so a printed 4.50 really is ≥ 4.5. */
export function ratio(r: number): string {
  return (Math.floor(r * 100) / 100).toFixed(2);
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function valueText(v: TokenValue): string {
  switch (v.type) {
    case "color":
      return `\`${cssColor(v.value)}\``;
    case "dimension":
    case "duration":
      return `${num(v.value.value)}${v.value.unit}`;
    case "fontFamily":
      return v.value.join(", ");
    case "fontWeight":
    case "number":
      return num(v.value);
    case "cubicBezier":
      return `cubic-bezier(${v.value.map(num).join(", ")})`;
    case "shadow":
      return v.value
        .map((l) => `${[l.offsetX, l.offsetY, l.blur, l.spread].map((d) => num(d.value) + d.unit).join(" ")} ${cssColor(l.color)}`)
        .join(", ");
    case "typography": {
      const t = v.value;
      return `${num(t.fontWeight)} ${num(t.fontSize.value)}${t.fontSize.unit}/${num(t.lineHeight)}, 자간 ${num(t.letterSpacing.value)}${t.letterSpacing.unit}, ${t.fontFamily[0]}`;
    }
  }
}

const GROUP_TITLES: Record<string, string> = {
  color: "색",
  space: "간격",
  size: "크기",
  radius: "반경",
  font: "글꼴",
  typography: "글자 조합",
  shadow: "그림자(elevation)",
  motion: "모션",
  z: "z-index",
};

export function referenceBlock(set: TokenSet): string {
  const exported = set.tokens.filter((t) => t.exported);
  const groups = new Map<string, Token[]>();
  for (const t of exported) {
    const g = t.path[0]!;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  const out: string[] = [];
  for (const [group, tokens] of groups) {
    out.push(`#### ${GROUP_TITLES[group] ?? group}`, "");
    const themed = tokens.some((t) => t.themed);
    if (themed) {
      out.push(`| CSS 변수 | ${set.modes.map((m) => (m === "light" ? "라이트" : m === "dark" ? "다크" : m)).join(" | ")} | 용도 |`);
      out.push(`|---|${set.modes.map(() => "---").join("|")}|---|`);
      for (const t of tokens) {
        out.push(`| \`${cssVar(t)}\` | ${set.modes.map((m) => cell(valueText(t.values[m]!))).join(" | ")} | ${cell(t.description)} |`);
      }
    } else {
      out.push("| CSS 변수 | 값 | 용도 |", "|---|---|---|");
      for (const t of tokens) out.push(`| \`${cssVar(t)}\` | ${cell(valueText(t.values[set.modes[0]!]!))} | ${cell(t.description)} |`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}

export function contrastBlock(set: TokenSet, results: PairResult[]): string {
  const modeLabel = (m: string) => (m === "light" ? "라이트" : m === "dark" ? "다크" : m);
  const failed = results.filter((r) => !r.pass);
  const out: string[] = [];
  out.push(
    `검사한 조합 ${results.length}개 중 ${failed.length === 0 ? "모두 통과" : `${failed.length}개 미달`}. ` +
      "아래 값은 각 전경 토큰이 허용된 표면 전체에서 낸 **최저** 대비이고, 괄호 안이 그 표면이다(`+`는 반투명 층을 겹친 결과).",
    "",
  );
  out.push(`| 전경 토큰 | 역할 | 기준 | ${set.modes.map((m) => `${modeLabel(m)} 최저`).join(" | ")} |`);
  out.push(`|---|---|---|${set.modes.map(() => "---").join("|")}|`);
  const keys: string[] = [];
  const byKey = new Map<string, PairResult[]>();
  for (const r of results) {
    const key = `${r.fg}|${r.role}|${r.min}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      keys.push(key);
    }
    byKey.get(key)!.push(r);
  }
  for (const key of keys) {
    const rs = byKey.get(key)!;
    const { fg, role, min } = rs[0]!;
    const worst = set.modes.map((m) => {
      const w = rs.filter((r) => r.mode === m).reduce((a, b) => (b.ratio < a.ratio ? b : a));
      return `${w.pass ? "" : "❌ "}${ratio(w.ratio)} (\`${w.surface.replace(/color\.bg\.|color\./g, "")}\`)`;
    });
    out.push(`| \`${fg.replace(/^color\./, "")}\` | ${role === "text" ? "글자" : "UI"} | ${num(min)}:1 | ${worst.join(" | ")} |`);
  }
  out.push("", "<details>", "<summary>전체 조합</summary>", "");
  out.push(`| 전경 | 표면 | ${set.modes.map(modeLabel).join(" | ")} |`);
  out.push(`|---|---|${set.modes.map(() => "---").join("|")}|`);
  const rows = new Map<string, Map<string, PairResult>>();
  for (const r of results) {
    const key = `${r.fg}|${r.surface}|${r.min}`;
    if (!rows.has(key)) rows.set(key, new Map());
    rows.get(key)!.set(r.mode, r);
  }
  for (const [key, perMode] of rows) {
    const [fg, surface] = key.split("|");
    const cells = set.modes.map((m) => {
      const r = perMode.get(m)!;
      return `${r.pass ? "" : "❌ "}${ratio(r.ratio)}`;
    });
    out.push(`| \`${fg!.replace(/^color\./, "")}\` | \`${surface!.replace(/color\.bg\.|color\./g, "")}\` | ${cells.join(" | ")} |`);
  }
  out.push("", "</details>");
  return out.join("\n");
}

/** Replaces each <!-- tokens:NAME:start --> … <!-- tokens:NAME:end --> section. */
export function applyBlocks(markdown: string, blocks: Record<string, string>): string {
  let out = markdown;
  for (const [name, body] of Object.entries(blocks)) {
    const start = `<!-- tokens:${name}:start -->`;
    const end = `<!-- tokens:${name}:end -->`;
    const i = out.indexOf(start);
    const j = out.indexOf(end);
    if (i < 0 || j < i) throw new Error(`DESIGN.md is missing the ${start} … ${end} markers`);
    out = out.slice(0, i + start.length) + "\n" + body + "\n" + out.slice(j);
  }
  return out;
}
