// sRGB colour math for token validation: parsing, alpha compositing, and WCAG 2.x contrast.

/** An sRGB colour with 0–1 channels and 0–1 alpha. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseHex(hex: string): Rgba {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb or #rrggbbaa colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
    a: m[2] ? parseInt(m[2], 16) / 255 : 1,
  };
}

function byte(channel: number): number {
  return Math.round(Math.min(1, Math.max(0, channel)) * 255);
}

/** `#rrggbb`, ignoring alpha. */
export function toHex6(c: Rgba): string {
  return "#" + [c.r, c.g, c.b].map((v) => byte(v).toString(16).padStart(2, "0")).join("");
}

/** 0xRRGGBB, ignoring alpha. */
export function toRgbInt(c: Rgba): number {
  return (byte(c.r) << 16) | (byte(c.g) << 8) | byte(c.b);
}

/** Paints `top` over `bottom` (source-over). The result is opaque when `bottom` is. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

/** Composites a stack of layers, bottom first. The bottom layer must be opaque. */
export function flatten(layers: Rgba[]): Rgba {
  const [base, ...rest] = layers;
  if (!base || base.a < 1) throw new Error("the bottom layer of a surface must be opaque");
  return rest.reduce((below, layer) => composite(layer, below), base);
}

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque colour. */
export function luminance(c: Rgba): number {
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

function gamma(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/**
 * CSS `oklch(L C h)` (L 0–1, h in degrees) → sRGB, or null when it falls outside the sRGB
 * gamut (the browser would then gamut-map it and the exact result is not defined).
 */
export function oklchToRgb(l: number, c: number, hueDeg: number): Rgba | null {
  const h = (hueDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map(gamma);
  if (rgb.some((v) => v < -1e-4 || v > 1 + 1e-4)) return null;
  const [r, g, bl] = rgb.map((v) => Math.min(1, Math.max(0, v)));
  return { r: r!, g: g!, b: bl!, a: 1 };
}

/**
 * WCAG 2.x contrast ratio. A translucent foreground is composited over the background
 * first, which is how it renders.
 */
export function contrast(fg: Rgba, bg: Rgba): number {
  if (bg.a < 1) throw new Error("contrast background must be opaque");
  const top = fg.a < 1 ? composite(fg, bg) : fg;
  const l1 = luminance(top);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
