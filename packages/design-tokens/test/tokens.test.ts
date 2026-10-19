import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOutputs, DESIGN_MD_PATH, loadTokenSet, PACKAGE_DIR, renderDesignMd, TOKENS_PATH } from "../src/build.ts";
import { composite, contrast, parseHex } from "../src/color.ts";
import { evaluateContrast, unclassifiedColors } from "../src/contrast.ts";
import { parseTokens } from "../src/dtcg.ts";
import { ratio } from "../src/emit-markdown.ts";

const set = loadTokenSet();

describe("generated files", () => {
  test.each(Object.entries(buildOutputs(set)))("%s matches tokens.json (run `bun run tokens:build`)", (file, expected) => {
    expect(readFileSync(join(PACKAGE_DIR, file), "utf8")).toBe(expected);
  });

  test("DESIGN.md token and contrast sections match tokens.json (run `bun run tokens:build`)", () => {
    const current = readFileSync(DESIGN_MD_PATH, "utf8");
    expect(renderDesignMd(current, set)).toBe(current);
  });
});

describe("contrast", () => {
  const results = evaluateContrast(set);

  test("every declared pair meets its threshold in every mode", () => {
    const failures = results.filter((r) => !r.pass).map((r) => `${r.mode}: ${r.fg} on ${r.surface} = ${ratio(r.ratio)} < ${r.min}`);
    expect(failures).toEqual([]);
    // Guard against the declarations silently shrinking to nothing.
    expect(results.length).toBeGreaterThan(500);
    expect(new Set(results.map((r) => r.mode))).toEqual(new Set(["light", "dark"]));
  });

  test("every exported colour is checked as a foreground, used as a surface, or exempt with a reason", () => {
    expect(unclassifiedColors(set)).toEqual([]);
  });

  test("text roles use the 4.5:1 threshold and UI roles at least 3:1", () => {
    for (const pair of set.contrast.pairs) expect(pair.min).toBeGreaterThanOrEqual(pair.role === "text" ? 4.5 : 3);
  });

  test("the maths matches WCAG reference values", () => {
    const white = parseHex("#ffffff");
    expect(contrast(parseHex("#000000"), white)).toBeCloseTo(21, 5);
    expect(contrast(parseHex("#777777"), white)).toBeCloseTo(4.48, 2);
    expect(contrast(parseHex("#767676"), white)).toBeCloseTo(4.54, 2);
    // 50% black over white renders as #808080 (well, 127.5/255).
    const half = composite({ r: 0, g: 0, b: 0, a: 0.5 }, white);
    expect(half.r).toBeCloseTo(0.5, 6);
    expect(contrast({ r: 0, g: 0, b: 0, a: 0.5 }, white)).toBeCloseTo(contrast(half, white), 9);
  });

  test("a translucent foreground is composited before measuring", () => {
    // 10% white over near-black is nowhere near 21:1.
    expect(contrast({ r: 1, g: 1, b: 1, a: 0.1 }, parseHex("#000000"))).toBeLessThan(1.5);
  });
});

describe("tokens.json", () => {
  test("every palette primitive is referenced by a semantic token", () => {
    const text = readFileSync(TOKENS_PATH, "utf8");
    const referenced = new Set([...text.matchAll(/\{(palette\.[^}]+)\}/g)].map((m) => m[1]));
    const unused = set.tokens.filter((t) => t.path[0] === "palette" && !referenced.has(t.name)).map((t) => t.name);
    expect(unused).toEqual([]);
  });

  test("the palette is not exported; semantic tokens are", () => {
    expect(set.tokens.filter((t) => t.path[0] === "palette").every((t) => !t.exported)).toBe(true);
    expect(set.tokens.filter((t) => t.path[0] !== "palette").every((t) => t.exported)).toBe(true);
    expect(buildOutputs(set)["dist/tokens.css"]).not.toContain("--palette-");
  });

  test("space tokens sit on the 4px grid, with 2px half steps only below 8px", () => {
    for (const t of set.tokens.filter((t) => t.path[0] === "space")) {
      const v = t.values.light!;
      if (v.type !== "dimension") throw new Error(`${t.name} is not a dimension`);
      const px = v.value.value;
      expect(px % 4 === 0 || (px < 8 && px % 2 === 0)).toBe(true);
    }
  });
});

describe("tokens.css", () => {
  const css = buildOutputs(set)["dist/tokens.css"]!;

  function blockBody(selectorStart: string): string {
    const i = css.indexOf(selectorStart);
    if (i < 0) throw new Error(`no block starting with ${selectorStart}`);
    const open = css.indexOf("{", i);
    const close = css.indexOf("}", open);
    return css
      .slice(open + 1, close)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
  }

  test("dark values apply via [data-theme] and via prefers-color-scheme, identically", () => {
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    const media = blockBody(':root:not([data-theme="light"])');
    const attr = blockBody('[data-theme="dark"]');
    expect(media).toBe(attr);
    expect(attr).toContain("color-scheme: dark;");
    expect(attr).toContain("--color-bg-canvas: #0f1011;");
  });

  test("the light block is the default and is also selectable with data-theme", () => {
    const light = blockBody(':root,\n[data-theme="light"]');
    expect(light).toContain("color-scheme: light;");
    expect(light).toContain("--color-text-primary: #1a1b1e;");
  });

  test("every themed variable is defined in both themes", () => {
    const names = (body: string) => body.split("\n").map((l) => l.split(":")[0]).sort();
    expect(names(blockBody(':root,\n[data-theme="light"]'))).toEqual(names(blockBody('[data-theme="dark"]')));
  });
});

describe("DTCG reader", () => {
  const color = (hex: string) => {
    const c = parseHex(hex);
    return { colorSpace: "srgb", components: [c.r, c.g, c.b], hex };
  };
  const doc = (tokens: Record<string, unknown>) => ({
    $extensions: { "com.qucord.lectern": { modes: ["light", "dark"], contrast: { surfaces: {}, pairs: [], exempt: {} } } },
    ...tokens,
  });

  test("resolves aliases per mode, falling back to the default value", () => {
    const parsed = parseTokens(
      doc({
        base: { $type: "color", a: { $value: color("#ffffff"), $extensions: { "com.qucord.lectern": { modes: { dark: color("#000000") } } } } },
        semantic: { $type: "color", b: { $value: "{base.a}" } },
      }),
    );
    const b = parsed.byName.get("semantic.b")!;
    expect(b.themed).toBe(true);
    expect(b.values.dark).toEqual({ type: "color", value: { r: 0, g: 0, b: 0, a: 1 } });
  });

  test("rejects an alias to a missing token", () => {
    expect(() => parseTokens(doc({ x: { $type: "color", a: { $value: "{nope.b}" } } }))).toThrow("points at no token");
  });

  test("rejects an alias cycle", () => {
    expect(() => parseTokens(doc({ x: { $type: "color", a: { $value: "{x.b}" }, b: { $value: "{x.a}" } } }))).toThrow("cycle");
  });

  test("rejects a hex fallback that disagrees with the components", () => {
    const bad = { colorSpace: "srgb", components: [1, 1, 1], hex: "#000000" };
    expect(() => parseTokens(doc({ x: { $type: "color", a: { $value: bad } } }))).toThrow("does not match");
  });

  test("rejects an alias whose type does not match", () => {
    expect(() =>
      parseTokens(doc({ d: { $type: "dimension", a: { $value: { value: 4, unit: "px" } } }, c: { $type: "color", b: { $value: "{d.a}" } } })),
    ).toThrow("expected color");
  });

  test("rejects a token without a type", () => {
    expect(() => parseTokens(doc({ x: { a: { $value: 4 } } }))).toThrow("no $type");
  });
});
