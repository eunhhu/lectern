// User avatar (DESIGN.md §3.9): initials on a colour chosen from the user id. The
// background is the one colour formula DESIGN.md allows outside the tokens,
// oklch(52% 0.08 h): white text stays above 5.2:1 for every hue (tested in
// packages/design-tokens). It is set through CSSOM, so no inline style attribute is
// written. Decorative: the name is always shown next to it.

import s from "./ui.module.css";

export function avatarHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (/^[\p{Script=Hangul}]/u.test(trimmed)) return trimmed.slice(0, 1);
  const words = trimmed.split(/\s+/);
  return (words[0]![0]! + (words[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({ id, name, size = "md" }: { id: string; name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={s.avatar}
      data-size={size}
      aria-hidden="true"
      ref={(el) => el?.style.setProperty("background-color", `oklch(52% 0.08 ${avatarHue(id)})`)}
    >
      {initials(name)}
    </span>
  );
}
