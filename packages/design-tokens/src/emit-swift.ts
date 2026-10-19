// Tokens.swift for SwiftUI (macOS 13+, iOS 16+). Themed colours become dynamic colours
// that follow the system appearance, so views read `LecternTokens.Colors.textPrimary`
// without knowing the current theme.

import { toRgbInt, type Rgba } from "./color.ts";
import type { Token, TokenSet, TokenValue } from "./dtcg.ts";
import { float, GENERATED_NOTICE, hex6, memberName, num } from "./format.ts";

const GROUPS: Record<string, string> = {
  color: "Colors",
  space: "Space",
  size: "Size",
  radius: "Radius",
  font: "Fonts",
  typography: "TextStyles",
  shadow: "Shadows",
  motion: "Motion",
  z: "ZIndex",
};

const WEIGHTS: Record<number, string> = {
  100: ".ultraLight",
  200: ".thin",
  300: ".light",
  400: ".regular",
  500: ".medium",
  600: ".semibold",
  700: ".bold",
  800: ".heavy",
  900: ".black",
};

function weight(w: number): string {
  const name = WEIGHTS[w];
  if (!name) throw new Error(`Swift: no Font.Weight for ${w}`);
  return name;
}

function color(light: Rgba, dark: Rgba): string {
  const args = [`lecternLight: 0x${hex6(toRgbInt(light))}`];
  if (light.a < 1) args.push(`lightOpacity: ${num(light.a)}`);
  args.push(`dark: 0x${hex6(toRgbInt(dark))}`);
  if (dark.a < 1) args.push(`darkOpacity: ${num(dark.a)}`);
  return `SwiftUI.Color(${args.join(", ")})`;
}

function px(d: { value: number; unit: string }): string {
  // rem is relative to a 16px root on the web; points are the native equivalent of px.
  return num(d.unit === "rem" ? d.value * 16 : d.value);
}

function member(token: Token, set: TokenSet, monoFamily: string): string {
  const [light, dark] = set.modes.map((m) => token.values[m]!) as [TokenValue, TokenValue];
  const name = memberName(token);
  switch (light.type) {
    case "color":
      return `public static let ${name} = ${color(light.value, (dark as typeof light).value)}`;
    case "dimension":
      return `public static let ${name}: CGFloat = ${px(light.value)}`;
    case "duration":
      return `public static let ${name}: TimeInterval = ${num(light.value.unit === "ms" ? light.value.value / 1000 : light.value.value)}`;
    case "fontFamily":
      return `public static let ${name}: [String] = [${light.value.map((f) => JSON.stringify(f)).join(", ")}]`;
    case "fontWeight":
      return `public static let ${name}: SwiftUI.Font.Weight = ${weight(light.value)}`;
    case "number":
      return `public static let ${name}: ${token.path[0] === "z" ? "Double" : "CGFloat"} = ${float(light.value)}`;
    case "cubicBezier":
      return `public static let ${name} = LecternCubicBezier(${["x1", "y1", "x2", "y2"].map((k, i) => `${k}: ${float(light.value[i]!)}`).join(", ")})`;
    case "shadow": {
      const darkLayers = (dark as typeof light).value;
      if (darkLayers.length !== light.value.length) throw new Error(`Swift: ${token.name} has a different layer count per mode`);
      const layers = light.value.map((l, i) => {
        const d = darkLayers[i]!;
        if (l.inset || d.inset) throw new Error(`Swift: ${token.name} uses an inset shadow`);
        // Only the colour can follow the appearance; the geometry is fixed.
        const geometry = (s: typeof l) => [s.offsetX, s.offsetY, s.blur, s.spread].map(px).join(" ");
        if (geometry(l) !== geometry(d)) throw new Error(`Swift: ${token.name} changes shadow geometry between modes`);
        return `LecternShadow(color: ${color(l.color, d.color)}, x: ${px(l.offsetX)}, y: ${px(l.offsetY)}, blur: ${px(l.blur)}, spread: ${px(l.spread)})`;
      });
      return `public static let ${name}: [LecternShadow] = [\n            ${layers.join(",\n            ")},\n        ]`;
    }
    case "typography": {
      const t = light.value;
      const mono = t.fontFamily[0] === monoFamily;
      return `public static let ${name} = LecternTextStyle(size: ${px(t.fontSize)}, weight: ${weight(t.fontWeight)}, lineHeight: ${float(t.lineHeight)}, tracking: ${px(t.letterSpacing)}, monospaced: ${mono})`;
    }
  }
}

function docComment(text: string, indent: string): string[] {
  return text ? [`${indent}/// ${text}`] : [];
}

export function emitSwift(set: TokenSet): string {
  if (set.modes.length !== 2) throw new Error("Swift: expects exactly a light and a dark mode");
  const monoToken = set.byName.get("font.family.mono")?.values[set.modes[0]!];
  const monoFamily = monoToken?.type === "fontFamily" ? monoToken.value[0]! : "";
  const exported = set.tokens.filter((t) => t.exported);
  const groups = new Map<string, Token[]>();
  for (const t of exported) {
    const g = GROUPS[t.path[0]!];
    if (!g) throw new Error(`Swift: no enum for token group ${t.path[0]}`);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  for (const t of exported) {
    if (t.themed && t.type !== "color" && t.type !== "shadow") throw new Error(`Swift: ${t.name} is themed but not a color or shadow`);
  }

  const lines = [
    `// ${GENERATED_NOTICE}`,
    "",
    "import SwiftUI",
    "#if os(macOS)",
    "import AppKit",
    "#else",
    "import UIKit",
    "#endif",
    "",
    "/// Lectern 디자인 토큰. 규칙과 사용법은 저장소 루트의 DESIGN.md를 본다.",
    "public enum LecternTokens {",
  ];
  let first = true;
  for (const [group, tokens] of groups) {
    if (!first) lines.push("");
    first = false;
    lines.push(`    public enum ${group} {`);
    for (const t of tokens) {
      lines.push(...docComment(t.description, "        "));
      lines.push(`        ${member(t, set, monoFamily)}`);
    }
    lines.push("    }");
  }
  lines.push("}");
  lines.push(SWIFT_SUPPORT);
  return lines.join("\n") + "\n";
}

const SWIFT_SUPPORT = `
/// 글자 조합. 웹은 Pretendard, 네이티브는 시스템 글꼴(SF Pro + Apple SD Gothic Neo)을 쓴다.
public struct LecternTextStyle: Sendable, Equatable {
    public let size: CGFloat
    public let weight: SwiftUI.Font.Weight
    /// 글자 크기에 곱하는 줄 높이 배수.
    public let lineHeight: CGFloat
    /// 자간(pt).
    public let tracking: CGFloat
    public let monospaced: Bool

    public var font: SwiftUI.Font {
        .system(size: size, weight: weight, design: monospaced ? .monospaced : .default)
    }

    /// \`.lineSpacing(_:)\`에 넘길 값. SwiftUI는 줄 높이가 아니라 줄 사이 간격을 받는다.
    public var lineSpacing: CGFloat { size * lineHeight - size }
}

/// 그림자 한 겹. \`blur\`는 CSS 값 그대로이고, SwiftUI \`shadow(radius:)\`에는 \`radius\`를 넘긴다.
public struct LecternShadow: Sendable {
    public let color: SwiftUI.Color
    public let x: CGFloat
    public let y: CGFloat
    public let blur: CGFloat
    /// SwiftUI는 spread를 지원하지 않는다. 1px 외곽선 겹은 \`overlay\`의 \`strokeBorder\`로 그린다.
    public let spread: CGFloat

    public var radius: CGFloat { blur / 2 }
}

/// CSS \`cubic-bezier()\`와 같은 이징 곡선.
public struct LecternCubicBezier: Sendable, Equatable {
    public let x1: Double
    public let y1: Double
    public let x2: Double
    public let y2: Double

    public func animation(duration: TimeInterval) -> SwiftUI.Animation {
        .timingCurve(x1, y1, x2, y2, duration: duration)
    }
}

extension SwiftUI.Color {
    /// 시스템 외관(라이트/다크)을 따라가는 sRGB 색.
    init(lecternLight light: UInt32, lightOpacity: Double = 1, dark: UInt32, darkOpacity: Double = 1) {
        #if os(macOS)
        self.init(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return lecternPlatformColor(isDark ? dark : light, opacity: isDark ? darkOpacity : lightOpacity)
        })
        #else
        self.init(uiColor: UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            return lecternPlatformColor(isDark ? dark : light, opacity: isDark ? darkOpacity : lightOpacity)
        })
        #endif
    }
}

#if os(macOS)
private func lecternPlatformColor(_ rgb: UInt32, opacity: Double) -> NSColor {
    NSColor(
        srgbRed: CGFloat((rgb >> 16) & 0xFF) / 255,
        green: CGFloat((rgb >> 8) & 0xFF) / 255,
        blue: CGFloat(rgb & 0xFF) / 255,
        alpha: CGFloat(opacity)
    )
}
#else
private func lecternPlatformColor(_ rgb: UInt32, opacity: Double) -> UIColor {
    UIColor(
        red: CGFloat((rgb >> 16) & 0xFF) / 255,
        green: CGFloat((rgb >> 8) & 0xFF) / 255,
        blue: CGFloat(rgb & 0xFF) / 255,
        alpha: CGFloat(opacity)
    )
}
#endif`;
