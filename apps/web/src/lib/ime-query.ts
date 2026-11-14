// A search box query that never searches half-typed Hangul (D-P3-5). While an IME
// composition is in progress (ㅋ → 퀀 → 퀀ㅌ …) the committed query stays where it was;
// it follows the text again once the composition ends and the text has rested a moment.

import { useEffect, useMemo, useState } from "react";

/** The committed query: it follows `raw` except while an IME composition is in progress. */
export function nextCommitted(prev: string, raw: string, composing: boolean): string {
  return composing ? prev : raw;
}

export interface ImeSafeQuery {
  /** What the field shows. */
  raw: string;
  setRaw: (value: string) => void;
  /** What to search: `raw` trimmed, `delayMs` after it last changed, never mid-composition. */
  committed: string;
  /** Spread onto the <Input>. */
  inputProps: {
    onCompositionStart: () => void;
    onCompositionEnd: (e: { currentTarget: { value: string } }) => void;
  };
}

export function useImeSafeQuery(initial = "", delayMs = 250): ImeSafeQuery {
  const [raw, setRaw] = useState(initial);
  const [committed, setCommitted] = useState(initial.trim());
  const [composing, setComposing] = useState(false);
  // Bumped when a composition ends, so the delay restarts even if the text did not change.
  const [ended, setEnded] = useState(0);

  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => setCommitted((prev) => nextCommitted(prev, raw.trim(), false)), delayMs);
    return () => clearTimeout(timer);
  }, [raw, composing, delayMs, ended]);

  const inputProps = useMemo(
    () => ({
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: (e: { currentTarget: { value: string } }) => {
        setComposing(false);
        setRaw(e.currentTarget.value);
        setEnded((n) => n + 1);
      },
    }),
    [],
  );

  return { raw, setRaw, committed, inputProps };
}
