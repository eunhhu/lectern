// Toasts (DESIGN.md §3.6) on React Aria's toast queue, and a polite live region for
// status messages that are not toasts (selection counts, seek targets: WCAG 4.1.3).

import { useSyncExternalStore } from "react";
import {
  Button as AriaButton,
  Text,
  UNSTABLE_Toast as Toast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as ToastRegion,
} from "react-aria-components";
import { Button, Dot, type Tone } from "./controls.tsx";
import s from "./ui.module.css";

export interface ToastContentValue {
  title: string;
  description?: string;
  tone?: Tone;
  /** An optional shortcut ("실행 취소"). The same result must be reachable elsewhere. */
  action?: { label: string; onAction: () => void };
}

export const toastQueue = new ToastQueue<ToastContentValue>({ maxVisibleToasts: 3 });

export function showToast(content: ToastContentValue, timeout = 5000) {
  return toastQueue.add(content, { timeout });
}

export function Toasts() {
  return (
    <ToastRegion queue={toastQueue} className={s.toastRegion} aria-label="알림">
      {({ toast }) => (
        <Toast toast={toast} className={s.toast}>
          <span className={s.toastDot}>
            <Dot tone={toast.content.tone ?? "success"} />
          </span>
          <ToastContent className={s.toastContent}>
            <Text slot="title">{toast.content.title}</Text>
            {toast.content.description && <Text slot="description">{toast.content.description}</Text>}
          </ToastContent>
          <span className={s.toastActions}>
            {toast.content.action && (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  toast.content.action!.onAction();
                  toastQueue.close(toast.key);
                }}
              >
                {toast.content.action.label}
              </Button>
            )}
            <AriaButton slot="close" aria-label="알림 닫기" className={`${s.button} ${s.ghost} ${s.sm} ${s.iconOnly}`}>
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </AriaButton>
          </span>
        </Toast>
      )}
    </ToastRegion>
  );
}

// --- live region -------------------------------------------------------------

let message = "";
let seq = 0;
const subscribers = new Set<() => void>();

/** Announces `text` politely to screen readers. Repeating the same text re-announces it. */
export function announce(text: string) {
  seq += 1;
  // Alternate a zero-width suffix so identical messages still count as changes.
  message = seq % 2 ? text : `${text}​`;
  subscribers.forEach((fn) => fn());
}

export function LiveRegion() {
  const text = useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => message,
  );
  return (
    <div className="visually-hidden" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}
