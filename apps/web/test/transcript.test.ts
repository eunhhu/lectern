// Readable transcript: paragraph grouping and 읽기 모드 (interjections hidden, display only).

import { describe, expect, test } from "bun:test";
import { createFixtureClient } from "../src/api/fixture/client.ts";
import { readableText } from "../src/lib/fillers.ts";
import { buildParagraphs, paragraphOf } from "../src/lib/transcript-paragraphs.ts";

const seg = (i: number, speaker: string | null, start: number, end: number, text = `문장 ${i}.`) => ({
  idx: i,
  speaker_id: speaker,
  start_ms: start,
  end_ms: end,
  text,
});

describe("paragraphs", () => {
  test("one speaker's consecutive segments become one paragraph; the name shows only on a change", () => {
    const segments = [seg(0, "a", 0, 2000), seg(1, "a", 2100, 4000), seg(2, "b", 4100, 6000), seg(3, "b", 6100, 8000), seg(4, "a", 8100, 9000)];
    const ps = buildParagraphs(segments, []);
    expect(ps.map((p) => [p.first, p.last, p.speakerId, p.newSpeaker])).toEqual([
      [0, 1, "a", true],
      [2, 3, "b", true],
      [4, 4, "a", true],
    ]);
  });

  test("long runs, long pauses and gaps start a new paragraph of the same speaker", () => {
    const run = Array.from({ length: 20 }, (_, i) => seg(i, "a", i * 3000, i * 3000 + 2500));
    const ps = buildParagraphs(run, [], { maxSegments: 8, maxChars: 10_000, maxMs: 10_000_000 });
    expect(ps.map((p) => [p.first, p.last])).toEqual([
      [0, 7],
      [8, 15],
      [16, 19],
    ]);
    expect(ps.slice(1).every((p) => !p.newSpeaker)).toBe(true);

    const paused = buildParagraphs([seg(0, "a", 0, 1000), seg(1, "a", 9000, 10_000)], [], { pauseMs: 4000 });
    expect(paused).toHaveLength(2);

    const gap = { kind: "break", start_ms: 1000, end_ms: 600_000 };
    const withGap = buildParagraphs([seg(0, "a", 0, 1000), seg(1, "a", 600_000, 601_000)], [gap]);
    expect(withGap[1]!.gapBefore).toEqual(gap);
    expect(withGap[1]!.newSpeaker).toBe(true);
  });

  test("every segment of a long fixture lecture lands in exactly one paragraph, in order", async () => {
    const api = createFixtureClient({ now: new Date("2026-10-19T03:00:00Z"), latencyMs: 0 });
    const t = await api.getTranscript("rec_os07");
    const ps = buildParagraphs(t.segments, t.gaps);
    expect(ps.length).toBeGreaterThan(300);
    expect(ps.length).toBeLessThan(t.segments.length / 2);
    expect(ps[0]!.first).toBe(0);
    expect(ps.at(-1)!.last).toBe(t.segments.length - 1);
    for (let i = 1; i < ps.length; i++) expect(ps[i]!.first).toBe(ps[i - 1]!.last + 1);
    for (const i of [0, 1, 500, 1777, t.segments.length - 1]) {
      const p = ps[paragraphOf(ps, i)]!;
      expect(p.first <= i && i <= p.last).toBe(true);
    }
    expect(paragraphOf(ps, -1)).toBe(-1);
    // The break in the middle of the lecture heads a paragraph.
    expect(ps.some((p) => p.gapBefore?.kind === "break")).toBe(true);
  });
});

describe("읽기 모드", () => {
  test("hides interjections followed by a comma or an ellipsis", () => {
    expect(readableText("음, 오늘은 스케줄링을 봅니다.")).toBe("오늘은 스케줄링을 봅니다.");
    expect(readableText("자, 어, 시작하겠습니다.")).toBe("시작하겠습니다.");
    expect(readableText("음... 그게 맞아요.")).toBe("그게 맞아요.");
    expect(readableText("이건 음, 중요한 부분이에요.")).toBe("이건 중요한 부분이에요.");
    expect(readableText("좋아요, 아, 그러면 이렇게 하죠.")).toBe("좋아요, 그러면 이렇게 하죠.");
  });

  test("keeps connectives, answers and words that merely start with the same letters", () => {
    expect(readableText("그러니까 입출력이 끝나면 준비 상태로 가요.")).toBe("그러니까 입출력이 끝나면 준비 상태로 가요.");
    expect(readableText("네, 맞습니다.")).toBe("네, 맞습니다.");
    expect(readableText("근데 그래서, 어떻게 됐어요?")).toBe("근데 그래서, 어떻게 됐어요?");
    expect(readableText("아이디어가 좋네요.")).toBe("아이디어가 좋네요.");
    expect(readableText("여자, 남자 모두")).toBe("여자, 남자 모두");
    expect(readableText("음")).toBe("음");
  });

  test("a segment that is only an interjection becomes empty (hidden, still seekable)", () => {
    expect(readableText("음, ")).toBe("");
    expect(readableText("어...")).toBe("");
  });
});
