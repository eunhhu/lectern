// Bottom audio player (DESIGN.md §3.10). Keyboard, outside text fields and widgets that
// use the keys themselves: Space play/pause, ←/→ 5 s, Shift+←/→ 30 s, [ / ] speed.
// Nothing plays until the user asks (WCAG 1.4.2).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatSpokenTime, formatTimestamp } from "../../lib/format.ts";
import { isImeComposing, isTypingTarget } from "../../lib/keyboard.ts";
import { PLAYBACK_RATES } from "../../lib/media-clock.ts";
import { insideDialog } from "../../app/GlobalShortcuts.tsx";
import { Badge, Button, SelectField } from "../../ui/controls.tsx";
import { usePlayback } from "./playback.tsx";
import s from "./recording.module.css";

const ARROW_WIDGETS = '[role="slider"], [role="listbox"], [role="grid"], [role="tablist"], [role="menu"], [role="tree"], [data-arrow-nav], input, select, textarea';
const PRESSABLE = 'button, a, input, select, textarea, [role="button"], [role="tab"], [role="checkbox"], [role="menuitem"], [role="option"], [role="row"], [role="gridcell"], [role="treeitem"], [role="switch"], [role="radio"]';

export function AudioPlayer() {
  const { clock } = usePlayback();
  const paused = useSyncExternalStore(
    (fn) => clock.subscribe(fn),
    () => clock.paused,
  );
  const rate = useSyncExternalStore(
    (fn) => clock.subscribe(fn),
    () => clock.playbackRate,
  );
  const status = useSyncExternalStore(
    (fn) => clock.subscribe(fn),
    () => clock.status,
  );
  const unavailable = status === "error";
  const [position, setPosition] = useState(0);
  const rangeRef = useRef<HTMLInputElement>(null);
  const duration = clock.duration;

  // Re-render only when the shown second changes.
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const sec = Math.floor(clock.currentTime / 1000);
      if (sec !== last) {
        last = sec;
        setPosition(sec);
        rangeRef.current?.style.setProperty("--progress", `${duration ? ((sec * 1000) / duration) * 100 : 0}%`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock, duration]);

  const skip = (ms: number) => clock.seek(clock.currentTime + ms);
  const changeRate = (dir: 1 | -1) => {
    const i = PLAYBACK_RATES.indexOf(clock.playbackRate as (typeof PLAYBACK_RATES)[number]);
    const next = PLAYBACK_RATES[Math.max(0, Math.min(PLAYBACK_RATES.length - 1, (i < 0 ? 1 : i) + dir))]!;
    clock.setPlaybackRate(next);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isImeComposing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as Element | null;
      if (isTypingTarget(target) || insideDialog(target)) return;
      if (e.key === " " && !target?.closest?.(PRESSABLE)) {
        e.preventDefault();
        clock.paused ? clock.play() : clock.pause();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !target?.closest?.(ARROW_WIDGETS)) {
        e.preventDefault();
        skip((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 30_000 : 5_000));
      } else if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        changeRate(e.key === "[" ? -1 : 1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock]);

  const durationSec = Math.floor(duration / 1000);
  return (
    <section className={s.player} aria-label="오디오 플레이어">
      <Button
        variant="primary"
        icon={paused ? "play" : "pause"}
        iconOnly
        aria-label={paused ? "재생" : "일시정지"}
        aria-keyshortcuts="Space"
        isDisabled={unavailable}
        onPress={() => (paused ? clock.play() : clock.pause())}
      />
      <Button variant="ghost" icon="back" iconOnly aria-label="10초 뒤로" onPress={() => skip(-10_000)} />
      <Button variant="ghost" icon="forward" iconOnly aria-label="10초 앞으로" onPress={() => skip(10_000)} />
      <input
        ref={rangeRef}
        className={s.range}
        type="range"
        min={0}
        max={durationSec}
        step={1}
        value={Math.min(position, durationSec)}
        aria-label="재생 위치"
        aria-valuetext={`${formatSpokenTime(position * 1000)} / ${formatSpokenTime(duration)}`}
        onChange={(e) => clock.seek(Number(e.currentTarget.value) * 1000)}
      />
      <span className={s.time} aria-hidden="true">
        {formatTimestamp(position * 1000)} / {formatTimestamp(duration)}
      </span>
      <span className={s.rate}>
        <SelectField
          label="재생 속도"
          hideLabel
          items={PLAYBACK_RATES.map((r) => ({ id: String(r), label: `${r}배` }))}
          selectedKey={String(rate)}
          onSelectionChange={(k) => clock.setPlaybackRate(Number(k))}
        />
      </span>
      {!clock.audible && <Badge tone="info">소리 없는 미리보기</Badge>}
      {unavailable && (
        <span className={s.audioNote} role="status">
          <Badge tone="info">오디오 준비 중</Badge>
          <span className={s.audioNoteText}>오디오를 아직 불러올 수 없습니다. 전사와 출처 이동은 그대로 됩니다.</span>
        </span>
      )}
    </section>
  );
}
