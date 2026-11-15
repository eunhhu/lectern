// App-wide keyboard shortcuts (DESIGN.md §1.2): ⌘K / Ctrl+K always; single keys (U, ?,
// "G then H/L/A/C/S") only outside text fields, never during Korean IME composition,
// never while a dialog is open, and only while the viewer has them turned on (WCAG 2.1.4).
// Service operators also have the admin console's "G then O/M/J/," (P5-13).

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { isImeComposing, isTypingTarget } from "../lib/keyboard.ts";
import { useIsOperator } from "../api/queries.ts";
import { ADMIN_GO_KEYS, GO_KEYS } from "./commands.ts";
import { currentOverlay, openOverlay } from "./overlays.ts";
import { getPreferences } from "./preferences.ts";

const SEQUENCE_MS = 1200;

export function insideDialog(target: EventTarget | null): boolean {
  return Boolean((target as Element | null)?.closest?.('[role="dialog"], [role="alertdialog"]'));
}

export function GlobalShortcuts() {
  const navigate = useNavigate();
  const operator = useIsOperator() === true;

  useEffect(() => {
    let pendingG = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (currentOverlay() === "palette") return;
        openOverlay("palette");
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (!getPreferences().singleKeyShortcuts || currentOverlay() || insideDialog(e.target) || isTypingTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (pendingG && Date.now() - pendingG < SEQUENCE_MS && GO_KEYS[key]) {
        pendingG = 0;
        e.preventDefault();
        void navigate({ to: GO_KEYS[key] });
        return;
      }
      if (pendingG && Date.now() - pendingG < SEQUENCE_MS && operator && ADMIN_GO_KEYS[key]) {
        pendingG = 0;
        e.preventDefault();
        void navigate({ to: ADMIN_GO_KEYS[key] });
        return;
      }
      pendingG = 0;
      if (key === "g") {
        pendingG = Date.now();
      } else if (key === "u") {
        e.preventDefault();
        openOverlay("upload");
      } else if (e.key === "?") {
        e.preventDefault();
        openOverlay("shortcuts");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate, operator]);

  return null;
}
