import { describe, expect, test } from "bun:test";
import { renderIndexHtml } from "../scripts/html.ts";
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatRelative,
  formatSpokenTime,
  formatTimeOfDay,
  formatTimestamp,
  zonedTimeToUtc,
} from "../src/lib/format.ts";
import { bestMatch, matchScore, toChoseong } from "../src/lib/hangul.ts";
import { josa } from "../src/lib/josa.ts";
import { formatShortcut, isImeComposing } from "../src/lib/keyboard.ts";
import { SimulatedClock } from "../src/lib/media-clock.ts";
import { findActiveSegment, findByIdx, findLastStartedIndex, resolveSourceRange } from "../src/lib/segments.ts";

describe("segment search", () => {
  const segs = [
    { idx: 0, start_ms: 1000, end_ms: 3000 },
    { idx: 1, start_ms: 3500, end_ms: 6000 },
    { idx: 2, start_ms: 6200, end_ms: 9000 },
    { idx: 3, start_ms: 20_000, end_ms: 22_000 },
  ];

  test("finds the last segment that started", () => {
    expect(findLastStartedIndex(segs, 0)).toBe(-1);
    expect(findLastStartedIndex(segs, 1000)).toBe(0);
    expect(findLastStartedIndex(segs, 3499)).toBe(0);
    expect(findLastStartedIndex(segs, 3500)).toBe(1);
    expect(findLastStartedIndex(segs, 999_999)).toBe(3);
    expect(findLastStartedIndex([], 5)).toBe(-1);
  });

  test("keeps the highlight across short pauses but not across a break", () => {
    expect(findActiveSegment(segs, 3200)).toBe(0);
    expect(findActiveSegment(segs, 9000 + 1500)).toBe(2);
    expect(findActiveSegment(segs, 12_000)).toBe(-1);
    expect(findActiveSegment(segs, 21_000)).toBe(3);
  });

  test("agrees with a linear scan on a long transcript", () => {
    const long = Array.from({ length: 5000 }, (_, i) => ({ idx: i, start_ms: i * 3000, end_ms: i * 3000 + 2500 }));
    for (const ms of [0, 1, 2499, 2600, 2999, 3000, 7_777_777, 14_999_000]) {
      let expected = -1;
      long.forEach((s, i) => {
        if (s.start_ms <= ms) expected = i;
      });
      expect(findLastStartedIndex(long, ms)).toBe(expected);
    }
  });

  test("resolves SourceRef idx ranges to original-audio ms", () => {
    expect(findByIdx(segs, 2)).toBe(2);
    expect(findByIdx(segs, 9)).toBe(-1);
    expect(resolveSourceRange(segs, { start_idx: 1, end_idx: 2 })).toEqual({ first: 1, last: 2, start_ms: 3500, end_ms: 9000 });
    expect(resolveSourceRange(segs, { start_idx: 2, end_idx: 7 })).toBeNull();
  });
});

describe("Korean search", () => {
  test("matches initial consonants, mixed input, and ignores spaces and case", () => {
    expect(toChoseong("운영체제")).toBe("ㅇㅇㅊㅈ");
    expect(matchScore("강의 노트", "ㄱㅇ")).not.toBeNull();
    expect(matchScore("운영체제 7주차", "운ㅇ")).not.toBeNull();
    expect(matchScore("라이브러리", "라이 브")).not.toBeNull();
    expect(matchScore("Library", "lib")).not.toBeNull();
    expect(matchScore("강의", "ㄴ")).toBeNull();
  });

  test("ranks prefix matches first and accepts English aliases", () => {
    expect(matchScore("설정", "설")!).toBeGreaterThan(matchScore("환경 설정", "설")!);
    expect(bestMatch("테마 전환", ["theme", "dark"], "dark")).not.toBeNull();
    expect(bestMatch("테마 전환", ["theme"], "zzz")).toBeNull();
  });
});

describe("formatting (DESIGN.md §6.4)", () => {
  test("timestamps and durations", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(23 * 60_000 + 45_000)).toBe("23:45");
    expect(formatTimestamp(3_600_000 + 23 * 60_000 + 45_000)).toBe("1:23:45");
    expect(formatSpokenTime(12 * 60_000 + 30_000)).toBe("12분 30초");
    expect(formatSpokenTime(5_025_000)).toBe("1시간 23분 45초");
    expect(formatSpokenTime(0)).toBe("0초");
    expect(formatDuration(5_000_000)).toBe("1시간 23분");
    expect(formatDuration(45_000)).toBe("45초");
    expect(formatDuration(7_200_000)).toBe("2시간");
  });

  test("sizes use decimal units with a space", () => {
    expect(formatBytes(820)).toBe("820 B");
    expect(formatBytes(37_000_000)).toBe("37 MB");
    expect(formatBytes(1_400_000_000)).toBe("1.4 GB");
  });

  test("dates, times and relative times in Asia/Seoul", () => {
    const now = new Date("2026-10-19T06:00:00Z"); // 15:00 KST, Monday
    expect(formatDate("2026-10-18T03:00:00Z", now)).toBe("10월 18일 (일)");
    expect(formatDate("2025-10-19T03:00:00Z", now)).toBe("2025년 10월 19일");
    expect(formatTimeOfDay("2026-10-19T06:05:00Z")).toBe("오후 3:05");
    expect(formatTimeOfDay("2026-10-18T15:30:00Z")).toBe("오전 12:30");
    expect(formatRelative("2026-10-19T05:59:30Z", now)).toBe("방금 전");
    expect(formatRelative("2026-10-19T05:57:00Z", now)).toBe("3분 전");
    expect(formatRelative("2026-10-19T01:00:00Z", now)).toBe("5시간 전");
    expect(formatRelative("2026-10-18T10:00:00Z", now)).toBe("어제");
    expect(formatRelative("2026-10-15T10:00:00Z", now)).toBe("4일 전");
    expect(zonedTimeToUtc({ year: 2026, month: 10, day: 19, hour: 14, minute: 30 }).toISOString()).toBe("2026-10-19T05:30:00.000Z");
  });

  test("particles follow the final consonant, and non-Hangul asks for a rephrase", () => {
    expect(josa("녹음", "을/를")).toBe("녹음을");
    expect(josa("강의", "을/를")).toBe("강의를");
    expect(josa("운영체제", "으로/로")).toBe("운영체제로");
    expect(josa("연구실", "으로/로")).toBe("연구실로"); // ㄹ takes 로
    expect(josa("세미나 폴더", "으로/로")).toBe("세미나 폴더로");
    expect(josa("개인", "으로/로")).toBe("개인으로");
    expect(josa("Lectern", "을/를")).toBeNull();
  });
});

describe("keyboard", () => {
  test("detects IME composition including keyCode 229", () => {
    expect(isImeComposing({ isComposing: true, keyCode: 0 })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 75 })).toBe(false);
  });

  test("formats shortcuts per platform", () => {
    expect(formatShortcut("k", { mod: true, mac: true })).toBe("⌘K");
    expect(formatShortcut("k", { mod: true, mac: false })).toBe("Ctrl+K");
    expect(formatShortcut("p", { mod: true, shift: true, mac: true })).toBe("⇧⌘P");
  });
});

describe("SimulatedClock", () => {
  test("advances with the playback rate, seeks, and stops at the end", () => {
    let t = 0;
    const clock = new SimulatedClock(10_000, () => t);
    const changes: boolean[] = [];
    clock.subscribe(() => changes.push(clock.paused));
    expect(clock.currentTime).toBe(0);
    clock.play();
    t = 1000;
    expect(clock.currentTime).toBe(1000);
    clock.setPlaybackRate(2);
    t = 2000;
    expect(clock.currentTime).toBe(3000);
    clock.seek(9000);
    t = 4000;
    expect(clock.currentTime).toBe(10_000); // clamped at the end
    clock.pause();
    clock.seek(500);
    expect(clock.currentTime).toBe(500);
    expect(changes).toEqual([false, false, false, true, true]);
    clock.dispose();
  });
});

describe("index.html", () => {
  test("references only same-origin assets, with no inline script or style", () => {
    const html = renderIndexHtml({ styles: ["/app/assets/main-abc.css"], scripts: ["/app/assets/main-abc.js"] });
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('<link rel="stylesheet" href="/app/assets/main-abc.css">');
    expect(html).toContain('<script type="module" src="/app/assets/main-abc.js"></script>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toContain("<style");
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(() => renderIndexHtml({ styles: ["https://cdn.example.com/x.css"], scripts: [] })).toThrow();
  });
});
