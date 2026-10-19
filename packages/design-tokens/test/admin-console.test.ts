// The admin console is the first consumer of the generated tokens (P0 pipeline proof).
// These checks keep it on the tokens: the generated CSS is inlined as-is, no colour is
// hand-written in its stylesheet, and every variable it reads is defined.

import { describe, expect, test } from "bun:test";
import { PAGE_SCRIPTS, renderAdminPageHtml } from "../../../apps/server/src/ui.ts";
import { tokensCss } from "../dist/tokens-css.ts";
import { loadTokenSet } from "../src/build.ts";
import { contrast, oklchToRgb } from "../src/color.ts";

const html = renderAdminPageHtml();
const style = html.slice(html.indexOf("<style>") + "<style>".length, html.indexOf("</style>"));
const adminScript = PAGE_SCRIPTS.get("admin.js")!.body;

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![-\w])(?:white|black)(?![-\w])/g;

describe("admin console on design tokens", () => {
  test("inlines the generated tokens.css unchanged", () => {
    expect(style).toContain(tokensCss);
  });

  test("its stylesheet hand-writes no colours (all come from tokens)", () => {
    const own = style.replace(tokensCss, "");
    expect(own.match(COLOR_LITERAL) ?? []).toEqual([]);
  });

  test("every custom property it reads is defined", () => {
    const defined = new Set([...style.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...`${style}\n${adminScript}`.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  test("keeps dark as the default theme with the saved choice applied in <head>", () => {
    expect(html).toContain('<html lang="ko" data-theme="dark">');
    expect(html.indexOf("admin-theme.js")).toBeLessThan(html.indexOf("<style>"));
  });

  test("avatar initials stay readable on every generated avatar colour", () => {
    // Avatars are oklch(L C hue) with the hue hashed from the user id; check all 360 hues.
    const m = /oklch\((\d+(?:\.\d+)?)% (\d+(?:\.\d+)?) ' \+ hashHue/.exec(adminScript);
    expect(m).not.toBeNull();
    const [l, c] = [Number(m![1]) / 100, Number(m![2])];
    const onSolid = loadTokenSet().byName.get("color.text.on-solid")!;
    for (const mode of ["light", "dark"]) {
      const fg = onSolid.values[mode]!;
      if (fg.type !== "color") throw new Error("on-solid is not a color");
      for (let hue = 0; hue < 360; hue++) {
        const bg = oklchToRgb(l, c, hue);
        expect(bg).not.toBeNull();
        expect(contrast(fg.value, bg!)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
