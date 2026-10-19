// The transcript as readable paragraphs (lib/transcript-paragraphs.ts), virtualized with
// TanStack Virtual (thousands of segments), kept in sync with playback (ARCHITECTURE §7
// 전사 동기화, DESIGN.md §3.11):
//
// - A paragraph is one speaker's consecutive segments. The speaker's name heads it only
//   when the speaker changes; a quiet timestamp heads every paragraph and is the
//   paragraph's button (Enter seeks there). The text itself is plain, selectable prose.
// - Every animation frame reads `clock.currentTime` and binary-searches the sorted
//   segments; the playing sentence gets aria-current="true" and a soft background.
// - While following, the list scrolls to keep it in view. Wheel, touch, scrollbar drags
//   and keyboard movement inside the list mean the user is reading elsewhere: following
//   stops and "현재 위치로" appears. Our own scrolls never count as user scrolls.
// - Clicking a sentence seeks to it (unless the click ended a text selection); ↑/↓,
//   Home/End, PageUp/PageDown move between paragraphs (one tab stop for the list).
// - 읽기 모드 hides interjections (lib/fillers.ts); 원문 shows the text as transcribed.

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { TranscriptMode } from "../../app/preferences.ts";
import { readableText } from "../../lib/fillers.ts";
import { formatDuration, formatTimestamp } from "../../lib/format.ts";
import { findActiveSegment } from "../../lib/segments.ts";
import { buildParagraphs, paragraphOf } from "../../lib/transcript-paragraphs.ts";
import { Button } from "../../ui/controls.tsx";
import { usePlayback } from "./playback.tsx";
import s from "./recording.module.css";

const GAP_LABEL: Record<string, string> = { break: "쉬는 시간", tail: "녹음 끝", missing_transcript: "전사하지 못한 구간" };

export function TranscriptPane({ headingId, mode }: { headingId: string; mode: TranscriptMode }) {
  const { clock, segments, gaps, speakerNames, follow, setFollow, highlight, scrollRequest, seekToSegment } = usePlayback();
  const parentRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const [focusIndex, setFocusIndex] = useState(0);
  const pendingFocus = useRef<number | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  const paragraphs = useMemo(() => buildParagraphs(segments, gaps), [segments, gaps]);
  const texts = useMemo(() => (mode === "reading" ? segments.map((seg) => readableText(seg.text)) : segments.map((seg) => seg.text)), [segments, mode]);

  const virtualizer = useVirtualizer({
    count: paragraphs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150,
    overscan: 6,
  });

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
        if (i >= 0 && followRef.current && !clock.paused) keepVisible(paragraphOf(paragraphs, i));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, paragraphs, clock]);

  // Requests from sentence clicks, source chips and answers.
  useEffect(() => {
    if (!scrollRequest) return;
    const p = paragraphOf(paragraphs, scrollRequest.index);
    if (p >= 0) keepVisible(p, scrollRequest.align);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  // Move DOM focus once the target paragraph is rendered (it may need a scroll first).
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
    const clamped = Math.max(0, Math.min(paragraphs.length - 1, next));
    userScrolled();
    setFocusIndex(clamped);
    pendingFocus.current = clamped;
    virtualizer.scrollToIndex(clamped, { align: "auto" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
    if (e.key in step) {
      e.preventDefault();
      moveFocus(focusIndex + step[e.key]!);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveFocus(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveFocus(paragraphs.length - 1);
    }
  };

  const items = virtualizer.getVirtualItems();
  const activeParagraph = paragraphOf(paragraphs, active);
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
          className={s.paragraphs}
          role="list"
          aria-labelledby={headingId}
          ref={(el) => el?.style.setProperty("height", `${virtualizer.getTotalSize()}px`)}
        >
          {items.map((row) => {
            const p = paragraphs[row.index]!;
            const speaker = p.speakerId ? (speakerNames.get(p.speakerId) ?? null) : null;
            const ts = formatTimestamp(p.startMs);
            return (
              <li
                key={row.key}
                data-index={row.index}
                ref={(el) => {
                  if (!el) return;
                  el.style.setProperty("transform", `translateY(${row.start}px)`);
                  virtualizer.measureElement(el);
                }}
                className={s.paragraphRow}
                aria-setsize={paragraphs.length}
                aria-posinset={row.index + 1}
              >
                {p.gapBefore && (
                  <p className={s.gapMark}>
                    {GAP_LABEL[p.gapBefore.kind] ?? "구간 없음"} · {formatTimestamp(p.gapBefore.start_ms)}–{formatTimestamp(p.gapBefore.end_ms)} (
                    {formatDuration(p.gapBefore.end_ms - p.gapBefore.start_ms)})
                  </p>
                )}
                <div className={s.paragraph} data-active={row.index === activeParagraph || undefined}>
                  <p className={s.paragraphHead}>
                    {p.newSpeaker && speaker && <span className={s.paragraphSpeaker}>{speaker}</span>}
                    <button
                      type="button"
                      className={s.paragraphTime}
                      tabIndex={row.index === focusIndex ? 0 : -1}
                      aria-label={`${ts}부터 재생${speaker ? `, ${speaker}` : ""}`}
                      onFocus={() => setFocusIndex(row.index)}
                      onClick={() => seekToSegment(p.first)}
                    >
                      {ts}
                    </button>
                  </p>
                  <p className={s.paragraphText}>
                    {segments.slice(p.first, p.last + 1).map((seg, k) => {
                      const i = p.first + k;
                      const text = texts[i]!;
                      if (!text) return null;
                      const isHighlighted = highlight !== null && i >= highlight.first && i <= highlight.last;
                      return (
                        // Mouse convenience: the paragraph's time button is the keyboard way to seek.
                        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                        <span
                          key={seg.idx}
                          className={s.sentence}
                          data-segment={i}
                          aria-current={i === active ? "true" : undefined}
                          data-highlight={isHighlighted || undefined}
                          onClick={() => {
                            if (window.getSelection()?.isCollapsed !== false) seekToSegment(i);
                          }}
                        >
                          {text}{" "}
                        </span>
                      );
                    })}
                  </p>
                </div>
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
              const p = paragraphOf(paragraphs, active);
              if (p >= 0) virtualizer.scrollToIndex(p, { align: "center" });
            }}
          >
            현재 위치로
          </Button>
        </div>
      )}
    </div>
  );
}
