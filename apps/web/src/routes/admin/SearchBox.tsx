// A labelled search box for the admin lists (P5-16): what is typed goes to the address a
// quarter second after the last key (like the old console), Enter sends it at once, Escape
// clears it. The address stays the source of truth: going back restores the text.

import { useEffect, useRef, useState } from "react";
import { Input, Label, SearchField } from "react-aria-components";
import { uiStyles } from "../../ui/controls.tsx";

export function SearchBox({ label, placeholder, value, onCommit }: { label: string; placeholder: string; value: string | undefined; onCommit: (q: string | undefined) => void }) {
  const [text, setText] = useState(value ?? "");
  const commit = useRef(onCommit);
  commit.current = onCommit;

  // The address changed elsewhere (back, a link, a cleared filter): show it.
  useEffect(() => setText(value ?? ""), [value]);

  useEffect(() => {
    if (text.trim() === (value ?? "")) return;
    const timer = setTimeout(() => commit.current(text.trim() || undefined), 250);
    return () => clearTimeout(timer);
  }, [text, value]);

  return (
    <SearchField className={uiStyles.field} value={text} onChange={setText} onSubmit={(v) => commit.current(v.trim() || undefined)}>
      <Label className={uiStyles.label}>{label}</Label>
      <Input className={uiStyles.input} placeholder={placeholder} />
    </SearchField>
  );
}
