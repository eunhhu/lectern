// Open state of the app-wide overlays (command palette, upload dialog, shortcut sheet),
// so global shortcuts, the sidebar and palette commands can all open them.

import { useSyncExternalStore } from "react";

export type Overlay = "palette" | "upload" | "shortcuts" | "nav";

let open: Overlay | null = null;
const listeners = new Set<() => void>();

export function openOverlay(which: Overlay) {
  open = which;
  listeners.forEach((fn) => fn());
}

export function closeOverlay(which?: Overlay) {
  if (which && open !== which) return;
  open = null;
  listeners.forEach((fn) => fn());
}

export function currentOverlay() {
  return open;
}

export function useOverlay(which: Overlay): [boolean, (isOpen: boolean) => void] {
  const isOpen = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open === which,
  );
  return [isOpen, (next: boolean) => (next ? openOverlay(which) : closeOverlay(which))];
}
