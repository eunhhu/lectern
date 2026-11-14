// Line icons on a 16px grid, 1.5px strokes in currentColor (DESIGN.md §2.4). Decorative
// by default (aria-hidden); the control that holds one carries the accessible name.

import type { SVGProps } from "react";

const PATHS = {
  home: "M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3v-3h2v3h3V6.5",
  library: "M3 2.5h2.5v11H3zM7 2.5h2.5v11H7zM11.2 3.2l2.3-.6 2 10.6-2.3.5z",
  calendar: "M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3",
  settings: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2",
  search: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.3 10.3l3.2 3.2",
  upload: "M8 10.5V2.5M4.8 5.7 8 2.5l3.2 3.2M2.5 10.5v3h11v-3",
  folder: "M2 4.5V12.5h12V5.5H7.5L6 3.5H2z",
  folderOpen: "M2 12.5V3.5h4l1.5 2h5.5v2M2 12.5l1.8-5h11l-1.8 5z",
  tag: "M2.5 2.5h5l6 6-5 5-6-6zM5.2 5.2h.1",
  inbox: "M2.5 9 4.2 3.5h7.6L13.5 9v4.5h-11zM2.5 9h3.2l.8 1.8h3l.8-1.8h3.2",
  play: "M5 3.2v9.6L12.8 8z",
  pause: "M5 3v10M11 3v10",
  back: "M7.5 4.5 4 8l3.5 3.5M4 8h5.5a3 3 0 0 1 0 6",
  forward: "M8.5 4.5 12 8l-3.5 3.5M12 8H6.5a3 3 0 0 0 0 6",
  chevronRight: "m6 3.5 4.5 4.5L6 12.5",
  chevronDown: "M3.5 6 8 10.5 12.5 6",
  chevronUp: "M3.5 10 8 5.5 12.5 10",
  shield: "M8 1.8 13 3.8v4c0 3-2.2 5.3-5 6.4-2.8-1.1-5-3.4-5-6.4v-4z",
  more: "M3.5 8h.1M8 8h.1M12.5 8h.1",
  check: "m3 8.5 3.2 3L13 4.5",
  close: "m4 4 8 8M12 4l-8 8",
  alert: "M8 2.2 14.2 13.5H1.8zM8 6.5v3.2M8 11.6v.1",
  info: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8ZM8 7.2v4M8 4.8v.1",
  audio: "M3.5 1.8h6l3 3v9.4h-9zM9.5 1.8v3h3M6.5 7v4.5M8.5 8.2v2.2M4.5 8.6v1.3M10.5 8.8v1",
  pdf: "M3.5 1.8h6l3 3v9.4h-9zM9.5 1.8v3h3M5.5 8.5h5M5.5 10.8h5M5.5 6.2h2",
  keyboard: "M1.8 4h12.4v8H1.8zM4 6.5h.1M6.5 6.5h.1M9 6.5h.1M11.5 6.5h.1M5 9.5h6",
  menu: "M2.5 4h11M2.5 8h11M2.5 12h11",
  grip: "M6 4h.1M10 4h.1M6 8h.1M10 8h.1M6 12h.1M10 12h.1",
  workspace: "M2.5 2.5h4.5v4.5h-4.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5h-4.5zM9 9h4.5v4.5H9z",
  sun: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1",
  target: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
  trash: "M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4",
  spark: "M8 2v3M8 11v3M2 8h3M11 8h3",
  user: "M8 2.5a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6ZM2.8 13.5c.6-2.6 2.7-4 5.2-4s4.6 1.4 5.2 4",
  quote: "M3 9.5h3v3H3zM3 9.5c0-3 1-4.5 3-5M9.5 9.5h3v3h-3zM9.5 9.5c0-3 1-4.5 3-5",
  plus: "M8 3v10M3 8h10",
  pencil: "M10.5 2.8 13.2 5.5 6 12.7l-3.2.5.5-3.2zM9.2 4.1l2.7 2.7",
  clock: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2ZM8 4.8V8l2.2 1.6",
  users: "M6 3a2.3 2.3 0 1 0 0 4.6A2.3 2.3 0 0 0 6 3ZM1.8 13c.4-2.2 2.1-3.4 4.2-3.4s3.8 1.2 4.2 3.4M11 3.3a2.2 2.2 0 0 1 0 4.2M12.2 9.8c1.2.4 2 1.4 2.2 3",
  book: "M2.5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 0-1.5-1.5h-4zM13.5 3.5h-4A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5h4z",
  logout: "M6.5 13.5h-3v-11h3M10 5l3 3-3 3M13 8H6.5",
  move: "M2 4.5V12.5h12V5.5H7.5L6 3.5H2zM6.5 9h4M9 7l1.5 2L9 11",
  chevronLeft: "M10 3.5 5.5 8l4.5 4.5",
  copy: "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7",
  send: "M8 13V3.5M4 7.5 8 3.5l4 4",
  stop: "M4.5 4.5h7v7h-7z",
  flip: "M3 6h8.5a2 2 0 0 1 0 4H4M5.5 4 3 6l2.5 2M10.5 12 13 10",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
