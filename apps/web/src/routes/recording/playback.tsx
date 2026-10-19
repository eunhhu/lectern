// Shared playback state of one recording view: the media clock, whether the transcript
// follows playback, the range a source chip asked to highlight, and the PDF page a chip
// pointed at. Jumping to a range opens the transcript panel and a PDF chip opens the
// files panel (`onRequestPanel`). Current time is NOT state here: the transcript and the player read
// `clock.currentTime` in their own requestAnimationFrame loops.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Speaker, TranscriptGap, TranscriptSegment } from "../../api/types.ts";
import { speakerName } from "../../app/labels.ts";
import { formatSpokenTime } from "../../lib/format.ts";
import type { MediaClock } from "../../lib/media-clock.ts";
import { resolveSourceRange } from "../../lib/segments.ts";
import { announce } from "../../ui/toast.tsx";

export type SidePanel = "transcript" | "files" | "ask";

export interface ScrollRequest {
  index: number;
  align: "start" | "center";
  /** Changes on every request so repeating the same index scrolls again. */
  token: number;
}

interface PlaybackValue {
  clock: MediaClock;
  segments: TranscriptSegment[];
  gaps: TranscriptGap[];
  speakerNames: Map<string, string>;
  follow: boolean;
  setFollow: (follow: boolean) => void;
  highlight: { first: number; last: number } | null;
  scrollRequest: ScrollRequest | null;
  /** Seek to a segment (array position) and follow playback from there. */
  seekToSegment: (index: number) => void;
  /** A source chip: seek, highlight the range for 1.5 s, and scroll the transcript to it. */
  jumpToRange: (ref: { start_idx: number; end_idx: number }) => void;
  pdfTarget: { assetId: string; page: number; token: number } | null;
  showPdfPage: (assetId: string, page: number) => void;
}

const PlaybackContext = createContext<PlaybackValue | null>(null);

export function PlaybackProvider({
  clock,
  segments,
  gaps,
  speakers,
  onRequestPanel,
  children,
}: {
  clock: MediaClock;
  segments: TranscriptSegment[];
  gaps: TranscriptGap[];
  speakers: Speaker[];
  onRequestPanel: (panel: SidePanel) => void;
  children: ReactNode;
}) {
  const [follow, setFollow] = useState(true);
  const [highlight, setHighlight] = useState<{ first: number; last: number } | null>(null);
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  const [pdfTarget, setPdfTarget] = useState<PlaybackValue["pdfTarget"]>(null);
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const speakerNames = useMemo(() => new Map(speakers.map((s) => [s.id, speakerName(s.label, s.display_name)])), [speakers]);

  const seekToSegment = useCallback(
    (index: number) => {
      const seg = segments[index];
      if (!seg) return;
      clock.seek(seg.start_ms);
      setFollow(true);
      setScrollRequest({ index, align: "center", token: ++token.current });
    },
    [clock, segments],
  );

  const jumpToRange = useCallback(
    (ref: { start_idx: number; end_idx: number }) => {
      const range = resolveSourceRange(segments, ref);
      if (!range) {
        announce("이 출처의 전사 구간을 찾을 수 없습니다.");
        return;
      }
      clock.seek(range.start_ms);
      setFollow(true);
      onRequestPanel("transcript");
      setHighlight({ first: range.first, last: range.last });
      setScrollRequest({ index: range.first, align: "start", token: ++token.current });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setHighlight(null), 1500);
      announce(`${formatSpokenTime(range.start_ms)} 구간으로 이동했습니다.`);
    },
    [clock, segments, onRequestPanel],
  );

  const showPdfPage = useCallback(
    (assetId: string, page: number) => {
      onRequestPanel("files");
      setPdfTarget({ assetId, page, token: ++token.current });
      announce(`PDF ${page}쪽을 표시합니다.`);
    },
    [onRequestPanel],
  );

  const value = useMemo<PlaybackValue>(
    () => ({ clock, segments, gaps, speakerNames, follow, setFollow, highlight, scrollRequest, seekToSegment, jumpToRange, pdfTarget, showPdfPage }),
    [clock, segments, gaps, speakerNames, follow, highlight, scrollRequest, seekToSegment, jumpToRange, pdfTarget, showPdfPage],
  );
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackValue {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error("PlaybackProvider is missing");
  return value;
}
