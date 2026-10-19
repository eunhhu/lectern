// An in-place name field (folder and tag rename). Enter or leaving the field saves, Esc
// cancels, and Enter during Korean IME composition finishes the syllable instead of
// saving. Key and pointer events stop here so the surrounding tree or list does not treat
// typing as navigation, typeahead or selection.

import { useEffect, useRef, type SyntheticEvent } from "react";
import { isImeComposing } from "../lib/keyboard.ts";
import s from "./ui.module.css";

export function InlineName({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  /** Accessible name, e.g. "폴더 이름". */
  label: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // After React Aria's own focus handling for the row has run.
    const id = requestAnimationFrame(() => {
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value.trim() ?? "";
    if (save && value && value !== initial) onCommit(value);
    else onCancel();
  };

  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <input
      ref={ref}
      className={s.inlineName}
      defaultValue={initial}
      aria-label={label}
      maxLength={200}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (isImeComposing(e.nativeEvent)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onKeyUp={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onBlur={() => finish(true)}
    />
  );
}
