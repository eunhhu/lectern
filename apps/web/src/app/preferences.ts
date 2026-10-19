// Per-viewer preferences kept in localStorage (a convenience only: the app works when
// storage is blocked). Theme follows the system unless the viewer picks one; single-key
// shortcuts can be turned off (WCAG 2.1.4). The recording view remembers which side panel
// was open and whether the transcript shows 읽기 모드 or 원문.

import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export type RecordingPanel = "transcript" | "files" | "ask" | "none";
export type TranscriptMode = "reading" | "verbatim";

export interface Preferences {
  theme: ThemeChoice;
  singleKeyShortcuts: boolean;
  recordingPanel: RecordingPanel;
  transcriptMode: TranscriptMode;
}

const PANELS: RecordingPanel[] = ["transcript", "files", "ask", "none"];

const KEY = "lectern.web.preferences";
const DEFAULTS: Preferences = { theme: "system", singleKeyShortcuts: true, recordingPanel: "transcript", transcriptMode: "reading" };

function read(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : "system",
      singleKeyShortcuts: parsed.singleKeyShortcuts !== false,
      recordingPanel: PANELS.includes(parsed.recordingPanel as RecordingPanel) ? (parsed.recordingPanel as RecordingPanel) : DEFAULTS.recordingPanel,
      transcriptMode: parsed.transcriptMode === "verbatim" ? "verbatim" : "reading",
    };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function applyTheme(theme: ThemeChoice = current.theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function getPreferences(): Preferences {
  return current;
}

export function setPreferences(patch: Partial<Preferences>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage blocked: keep the choice for this page only.
  }
  applyTheme();
  listeners.forEach((fn) => fn());
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/** The theme actually shown, resolving "system". */
export function effectiveTheme(): "light" | "dark" {
  if (current.theme !== "system") return current.theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function cycleTheme() {
  setPreferences({ theme: effectiveTheme() === "dark" ? "light" : "dark" });
}
