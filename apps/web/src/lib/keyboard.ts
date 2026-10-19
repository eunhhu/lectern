// Keyboard helpers shared by the global shortcuts, the player and the transcript
// (DESIGN.md §1.2, WCAG 2.1.4): single-key shortcuts never fire while the user types or
// while a Korean IME is composing a syllable.

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent);
}

/** `event.isComposing` is false for the keydown that starts composition in some browsers; 229 covers it. */
export function isImeComposing(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229;
}

const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider"]);

/** True when keys typed now belong to a text field (or a widget that uses plain keys). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "submit", "reset", "range", "file", "color"].includes(type);
  }
  const role = el.getAttribute("role");
  return role !== null && EDITABLE_ROLES.has(role);
}

/** "⌘K" on macOS, "Ctrl+K" elsewhere (DESIGN.md §6.4). */
export function formatShortcut(key: string, { mod = false, shift = false, mac = isMacPlatform() } = {}): string {
  const label = key.length === 1 ? key.toUpperCase() : key;
  if (mac) return `${shift ? "⇧" : ""}${mod ? "⌘" : ""}${label}`;
  return [mod ? "Ctrl" : "", shift ? "Shift" : "", label].filter(Boolean).join("+");
}
