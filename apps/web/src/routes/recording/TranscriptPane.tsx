// The transcript, virtualized with TanStack Virtual (thousands of segments), kept in sync
// with playback (ARCHITECTURE §7 전사 동기화, DESIGN.md §3.11):
//
// - Every animation frame reads `clock.currentTime` and binary-searches the sorted
//   segments; the playing one gets aria-current="true".
// - While following, the list scrolls to keep it in view. Wheel, touch, scrollbar drags
//   and keyboard movement inside the list mean the user is reading elsewhere: following
//   stops and "현재 위치로" appears. Our own scrolls never count as user scrolls,
//   because they are not wheel/touch/key events.
// - Click or Enter on a segment seeks there; ↑/↓, Home/End, PageUp/PageDown move
//   between segments (one tab stop for the whole list).

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatDuration, formatTimestamp } from "../../lib/format.ts";
import { findActiveSegment } from "../../lib/segments.ts";
import { Button } from "../../ui/controls.tsx";
import { usePlayback } from "./playback.tsx";
import s from "./recording.module.css";

const GAP_LABEL: Record<string, string> = { break: "쉬는 시간", tail: "녹음 끝", missing_transcript: "전사하지 못한 구간" };

export function TranscriptPane({ headingId }: { headingId: string }) {
  const { clock, segments, gaps, speakerNames, follow, setFollow, highlight, scrollRequest, seekToSegment } = usePlayback();
  const parentRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const [focusIndex, setFocusIndex] = useState(0);
  const pendingFocus = useRef<number | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  // Gap separators sit above the first segment after each gap.
  const gapBefore = useMemo(() => {
    const map = new Map<number, (typeof gaps)[number]>();
    for (const gap of gaps) {
      const i = segments.findIndex((seg) => seg.start_ms >= gap.end_ms);
      if (i >= 0) map.set(i, gap);
    }
    return map;
  }, [gaps, segments]);

  const keepVisible = (index: number, align: "start" | "center" = "center") => {
    const el = parentRef.current;
    const item = virtualizer.measurementsCache[index];
    if (!el || !item) return virtualizer.scrollToIndex(index, { align });
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    if (align === "start" || item.start < top + 24 || item.end > bottom - 72) virtualizer.scrollToIndex(index, { align });
  };

  // rAF loop: find the playing segment.
  useEffect(() => {
    let raf = 0;
    let last = -2;
    const tick = () => {
      const i = findActiveSegment(segments, clock.currentTime);
      if (i !== last) {
        last = i;
        setActive(i);
        if (i >= 0 && followRef.current && !clock.paused) keepVisible(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, clock]);

  // Requests from segment clicks and source chips.
  useEffect(() => {
    if (!scrollRequest) return;
    keepVisible(scrollRequest.index, scrollRequest.align);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  // Move DOM focus once the target row is rendered (it may need a scroll first).
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const el = parentRef.current?.querySelector<HTMLButtonElement>(`[data-index="${target}"] button`);
    if (el) {
      pendingFocus.current = null;
      el.focus({ preventScroll: true });
    }
  });

  const userScrolled = () => {
    if (followRef.current) setFollow(false);
  };

  const moveFocus = (next: number) => {
    const clamped = Math.max(0, Math.min(segments.length - 1, next));
    userScrolled();
    setFocusIndex(clamped);
    pendingFocus.current = clamped;
    virtualizer.scrollToIndex(clamped, { align: "auto" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
    if (e.key in step) {
      e.preventDefault();
      moveFocus(focusIndex + step[e.key]!);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveFocus(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveFocus(segments.length - 1);
    }
  };

  const items = virtualizer.getVirtualItems();
  const showReturn = !follow && active >= 0;

  return (
    <div className={s.transcript}>
      <div
        ref={parentRef}
        className={s.transcriptScroller}
        data-arrow-nav
        onWheel={userScrolled}
        onTouchMove={userScrolled}
        onPointerDown={(e) => e.target === e.currentTarget && userScrolled()}
        onKeyDown={onKeyDown}
      >
        <ol
          className={s.segments}
          role="list"
          aria-labelledby={headingId}
          ref={(el) => el?.style.setProperty("height", `${virtualizer.getTotalSize()}px`)}
        >
          {items.map((row) => {
            const seg = segments[row.index]!;
            const gap = gapBefore.get(row.index);
            const isActive = row.index === active;
            const isHighlighted = highlight !== null && row.index >= highlight.first && row.index <= highlight.last;
            return (
              <li
                key={row.key}
                data-index={row.index}
                ref={(el) => {
                  if (!el) return;
                  el.style.setProperty("transform", `translateY(${row.start}px)`);
                  virtualizer.measureElement(el);
                }}
                className={s.segmentRow}
                aria-setsize={segments.length}
                aria-posinset={row.index + 1}
              >
                {gap && (
                  <p className={s.gapMark}>
                    {GAP_LABEL[gap.kind] ?? "구간 없음"} · {formatTimestamp(gap.start_ms)}–{formatTimestamp(gap.end_ms)} ({formatDuration(gap.end_ms - gap.start_ms)})
                  </p>
                )}
                <button
                  type="button"
                  className={s.segment}
                  tabIndex={row.index === focusIndex ? 0 : -1}
                  aria-current={isActive ? "true" : undefined}
                  data-highlight={isHighlighted || undefined}
                  onFocus={() => setFocusIndex(row.index)}
                  onClick={() => seekToSegment(row.index)}
                >
                  <span className={s.segmentTime}>{formatTimestamp(seg.start_ms)}</span>
                  <span className={s.segmentBody}>
                    {seg.speaker_id && <span className={s.segmentSpeaker}>{speakerNames.get(seg.speaker_id)}</span>}
                    <span className={s.segmentText}>{seg.text}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {showReturn && (
        <div className={s.returnBar}>
          <Button
            size="sm"
            variant="primary"
            icon="target"
            onPress={() => {
              setFollow(true);
              virtualizer.scrollToIndex(active, { align: "center" });
            }}
          >
            현재 위치로
          </Button>
        </div>
      )}
    </div>
  );
}
