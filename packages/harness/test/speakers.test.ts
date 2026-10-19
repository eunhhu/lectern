import { describe, expect, test } from "bun:test";
import type { TimeMapEntry } from "@lectern/media";
import { mergeTranscripts, Transcript, unifySpeakers, type MergedTranscript } from "../src/index.ts";
import { chunkView, plan, script } from "./transcript-helpers.ts";

const S = 1000;
const MIN = 60 * S;
const duration = 10 * MIN;
const identity: TimeMapEntry[] = [{ cut_start_ms: 0, orig_start_ms: 0, length_ms: duration }];
const chunks = plan(duration, [
  { start: 0, end: 215 * S },
  { start: 195 * S, end: 415 * S },
  { start: 395 * S, end: duration },
]);

function transcriptOf(views: ReturnType<typeof chunkView>[] | Array<ReturnType<typeof chunkView> | null>): Transcript {
  const merged = mergeTranscripts({ chunks, results: views, timeMap: identity, cuts: [], durationMs: duration });
  const transcript = unifySpeakers(merged);
  expect(Transcript.safeParse(transcript).success).toBe(true);
  return transcript;
}

/** Recording-wide speaker of each segment, compared with the truth script's speaker by text. */
function agreement(transcript: Transcript, truth: ReturnType<typeof script>): Map<string, Set<string>> {
  const truthOf = new Map(truth.map((u) => [u.text.replace(/\s/g, ""), u.speaker]));
  const seen = new Map<string, Set<string>>();
  for (const seg of transcript.segments) {
    const real = truthOf.get(seg.text.replace(/\s/g, ""));
    if (!real) continue;
    seen.set(real, new Set([...(seen.get(real) ?? []), seg.speaker]));
  }
  return seen;
}

describe("speakers", () => {
  // A lecturer and a student who speaks every third utterance, through every overlap.
  const truth = script({ seed: 5, from: 0, to: duration, speakers: (i) => (i % 3 === 2 ? "B" : "A") });

  test("labels swapped between chunks are unified through the overlap text", () => {
    const local = [
      (s: string) => (s === "A" ? "S1" : "S2"),
      (s: string) => (s === "A" ? "S2" : "S1"), // chunk 1 heard the student first
      (s: string) => (s === "A" ? "S1" : "S2"),
    ];
    const transcript = transcriptOf(chunks.map((c, i) => chunkView(truth, c, { label: local[i] })));
    const seen = agreement(transcript, truth);
    expect(seen.get("A")).toEqual(new Set(["S1"]));
    expect(seen.get("B")).toEqual(new Set(["S2"]));
    expect(transcript.speakers.map((s) => [s.label, s.basis, s.confidence])).toEqual([
      ["S1", "overlap", 0.9],
      ["S2", "overlap", 0.9],
    ]);
    expect(transcript.speakers[0]!.members).toEqual([
      { chunk: 0, label: "S1" },
      { chunk: 1, label: "S2" },
      { chunk: 2, label: "S1" },
    ]);
    expect(transcript.segments.map((s) => s.idx)).toEqual(transcript.segments.map((_, i) => i));
  });

  test("an overlap in silence: the dominant speakers of neighbouring chunks are joined (continuity)", () => {
    // Only the lecturer, and a silent first overlap.
    const solo = script({ seed: 6, from: 0, to: duration }).filter((u) => u.end <= 185 * S || u.start >= 225 * S);
    const views = chunks.map((c, i) => chunkView(solo, c, { label: () => (i === 1 ? "S3" : "S1") }));
    const transcript = transcriptOf(views);
    expect(new Set(transcript.segments.map((s) => s.speaker))).toEqual(new Set(["S1"]));
    expect(transcript.speakers).toHaveLength(1);
    expect(transcript.speakers[0]!.basis).toBe("continuity"); // the weakest link it rests on
    expect(transcript.speakers[0]!.confidence).toBe(0.6);
  });

  test("never merges two labels of one chunk, and a label no evidence connects stays its own speaker", () => {
    // Chunk 1 also has a third person mid-chunk, outside every overlap.
    const third = truth.map((u) => (u.start > 280 * S && u.start < 300 * S ? { ...u, speaker: "C" } : u));
    const label = (s: string) => ({ A: "S1", B: "S2", C: "S3" })[s]!;
    const transcript = transcriptOf(chunks.map((c) => chunkView(third, c, { label })));
    const seen = agreement(transcript, third);
    expect(seen.get("A")!.size).toBe(1);
    expect(seen.get("B")!.size).toBe(1);
    expect(seen.get("C")!.size).toBe(1);
    expect(new Set([...seen.values()].map((s) => [...s][0]))).toEqual(new Set(["S1", "S2", "S3"]));
    const c = transcript.speakers.find((s) => s.label === [...seen.get("C")!][0])!;
    expect([c.basis, c.confidence, c.members]).toEqual(["unlinked", 0.5, [{ chunk: 1, label: "S3" }]]);
  });

  test("a failed chunk in between: its neighbours are joined by continuity", () => {
    const solo = script({ seed: 7, from: 0, to: duration });
    const views = chunks.map((c, i) => (i === 1 ? null : chunkView(solo, c, { label: () => (i === 2 ? "S2" : "S1") })));
    const transcript = transcriptOf(views);
    expect(transcript.failed_chunks).toEqual([1]);
    expect(transcript.speakers.map((s) => [s.label, s.basis])).toEqual([["S1", "continuity"]]);
    expect(transcript.gaps.map((g) => g.kind)).toEqual(["missing_transcript"]);
  });

  test("an interview: the voice that never speaks in an overlap is joined by elimination", () => {
    // Two people taking turns (no dominant speaker); only A speaks around the overlaps.
    const turns = script({ seed: 8, from: 0, to: duration, speakers: (i) => (i % 2 ? "B" : "A") }).map((u) =>
      (u.end > 180 * S && u.start < 230 * S) || (u.end > 380 * S && u.start < 430 * S) ? { ...u, speaker: "A" } : u,
    );
    const local = [(s: string) => (s === "A" ? "S1" : "S2"), (s: string) => (s === "A" ? "S2" : "S1"), (s: string) => (s === "A" ? "S1" : "S2")];
    const transcript = transcriptOf(chunks.map((c, i) => chunkView(turns, c, { label: local[i] })));
    const seen = agreement(transcript, turns);
    expect(seen.get("A")).toEqual(new Set(["S1"]));
    expect(seen.get("B")).toEqual(new Set(["S2"]));
    expect(transcript.speakers.map((s) => [s.label, s.basis])).toEqual([
      ["S1", "overlap"],
      ["S2", "continuity"],
    ]);
  });

  test("a continuity link that contradicts an overlap link is skipped", () => {
    // The overlap says chunk 0's S1 is chunk 1's S2; chunk 1's dominant S1 must stay apart.
    const seg = (chunk: number, speaker: string, start: number, text: string) => ({
      start_ms: start,
      end_ms: start + 4 * S,
      chunk,
      speaker,
      text,
    });
    const merged: MergedTranscript = {
      version: 1,
      duration_ms: duration,
      segments: [
        seg(0, "S1", 0, "가나다라마바사아자차카타파하"),
        seg(1, "S2", 200 * S, "하파타카차자아사바마라다나가"),
        seg(1, "S1", 210 * S, "길고 긴 설명이 이어지는 첫 번째 문장입니다 정말 깁니다"),
        seg(1, "S1", 220 * S, "길고 긴 설명이 이어지는 두 번째 문장입니다 정말 깁니다"),
      ],
      gaps: [],
      seams: [{ after_chunk: 0, method: "aligned", score: 40, drift_ms: 0, links: [{ prev: "S1", next: "S2", chars: 20 }] }],
      failed_chunks: [],
    };
    const transcript = unifySpeakers(merged);
    expect(transcript.segments.map((s) => s.speaker)).toEqual(["S1", "S1", "S2", "S2"]);
    expect(transcript.speakers.map((s) => [s.label, s.basis])).toEqual([
      ["S1", "overlap"],
      ["S2", "unlinked"],
    ]);
  });

  test("a one-chunk recording keeps its labels, renumbered by first appearance, at full confidence", () => {
    const merged: MergedTranscript = {
      version: 1,
      duration_ms: 20 * S,
      segments: [
        { start_ms: 0, end_ms: 4 * S, chunk: 0, speaker: "S2", text: "먼저 말한 사람" },
        { start_ms: 5 * S, end_ms: 9 * S, chunk: 0, speaker: "S1", text: "나중에 말한 사람" },
        { start_ms: 10 * S, end_ms: 14 * S, chunk: 0, speaker: "S2", text: "다시 첫 사람" },
      ],
      gaps: [],
      seams: [],
      failed_chunks: [],
    };
    const transcript = unifySpeakers(merged);
    expect(transcript.segments.map((s) => s.speaker)).toEqual(["S1", "S2", "S1"]);
    expect(transcript.speakers.map((s) => [s.label, s.basis, s.confidence, s.segments])).toEqual([
      ["S1", "single_chunk", 1, 2],
      ["S2", "single_chunk", 1, 1],
    ]);
  });
});
