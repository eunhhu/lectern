// speakers (AI_HARNESS §3.5): chunk-local labels (each chunk's provider call numbers its
// own speakers S1, S2, ...) → recording-wide labels. Rule-based, no model call:
//
// 1. Overlap evidence. merge aligned the two chunks' texts in each overlap and counted the
//    letters each (earlier label, later label) pair agreed on. A pair that is each other's
//    best match, with at least `minLinkChars` letters, is the same person.
// 2. Continuity. Neighbouring chunks (skipping failed ones) are joined through their
//    dominant speakers when both chunks have one (`dominantShare` of the letters): a
//    lecture's lecturer across an overlap that fell in silence. Overlap links go first, so
//    this only adds what they left open and never contradicts them (rule 4).
// 3. Elimination. When neighbouring chunks each have exactly one label not yet joined to
//    any label of the other, those two are joined: the second voice of an interview, or
//    the audience of a lecture, across overlaps it did not speak in.
// 4. Never two labels of one chunk in one speaker: a provider call tells its own speakers
//    apart, so a link that would merge them is skipped (strongest links are applied first).
// 5. Recording-wide labels are numbered by first appearance.
//
// Confidence (domain Speaker.confidence) is about the cross-chunk identity: 1 for a
// one-chunk recording, the weakest link for a linked speaker (overlap 0.9, continuity 0.6),
// 0.5 for a label no evidence connects. The UI shows S1/S2 until the user names them.
//
// When this is not enough (meetings with many speakers and silent overlaps), §3.5's
// fallback is a cheap text-only model call over a few sample lines per chunk label; see
// packages/harness/README.md for its design and cost. Not implemented yet.

import type { MergedTranscript, Transcript, TranscriptSpeaker } from "./schemas.ts";
import { normalizeForMatch } from "./text.ts";

export const SPEAKERS_VERSION = 1;

export const SPEAKER_DEFAULTS = Object.freeze({
  minLinkChars: 8,
  dominantShare: 0.6,
  confidence: Object.freeze({ overlap: 0.9, continuity: 0.6, unlinked: 0.5 }),
});
export type SpeakerOptions = typeof SPEAKER_DEFAULTS;

interface Node {
  key: string;
  chunk: number;
  label: string;
  chars: number;
  segments: number;
  firstMs: number;
  firstIdx: number;
}

type Basis = "overlap" | "continuity";

export function unifySpeakers(merged: MergedTranscript, overrides: Partial<SpeakerOptions> = {}): Transcript {
  const options = { ...SPEAKER_DEFAULTS, ...overrides };
  const nodes = new Map<string, Node>();
  const keyOf = (chunk: number, label: string) => `${chunk}:${label}`;
  merged.segments.forEach((seg, idx) => {
    const key = keyOf(seg.chunk, seg.speaker);
    const chars = normalizeForMatch(seg.text).chars.length;
    const node = nodes.get(key);
    if (node) {
      node.chars += chars;
      node.segments++;
      if (seg.start_ms < node.firstMs) node.firstMs = seg.start_ms;
    } else {
      nodes.set(key, { key, chunk: seg.chunk, label: seg.speaker, chars, segments: 1, firstMs: seg.start_ms, firstIdx: idx });
    }
  });

  // Union-find whose components remember the label they hold in each chunk.
  const parent = new Map<string, string>();
  const byChunk = new Map<string, Map<number, string>>();
  const edges = new Map<string, Basis[]>();
  for (const node of nodes.values()) {
    parent.set(node.key, node.key);
    byChunk.set(node.key, new Map([[node.chunk, node.label]]));
    edges.set(node.key, []);
  }
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string, basis: Basis): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return true;
    const ma = byChunk.get(ra)!;
    const mb = byChunk.get(rb)!;
    for (const [chunk, label] of mb) if (ma.has(chunk) && ma.get(chunk) !== label) return false;
    for (const [chunk, label] of mb) ma.set(chunk, label);
    parent.set(rb, ra);
    edges.set(ra, [...edges.get(ra)!, ...edges.get(rb)!, basis]);
    return true;
  };

  // 1. Overlap links: mutual best pairs, strongest first.
  const candidates: Array<{ seam: number; a: string; b: string; chars: number }> = [];
  for (const seam of merged.seams) {
    if (seam.method !== "aligned") continue;
    const bestNext = new Map<string, { label: string; chars: number }>();
    const bestPrev = new Map<string, { label: string; chars: number }>();
    for (const link of seam.links) {
      // links come sorted by chars (desc), then labels: the first seen is the best.
      if (!bestNext.has(link.prev)) bestNext.set(link.prev, { label: link.next, chars: link.chars });
      if (!bestPrev.has(link.next)) bestPrev.set(link.next, { label: link.prev, chars: link.chars });
    }
    for (const [prev, best] of bestNext) {
      if (best.chars < options.minLinkChars || bestPrev.get(best.label)?.label !== prev) continue;
      const a = keyOf(seam.after_chunk, prev);
      const b = keyOf(seam.after_chunk + 1, best.label);
      if (nodes.has(a) && nodes.has(b)) candidates.push({ seam: seam.after_chunk, a, b, chars: best.chars });
    }
  }
  candidates.sort((x, y) => y.chars - x.chars || x.seam - y.seam || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  for (const c of candidates) union(c.a, c.b, "overlap");

  // 2. Continuity between neighbouring transcribed chunks.
  const chunkChars = new Map<number, Node[]>();
  for (const node of nodes.values()) chunkChars.set(node.chunk, [...(chunkChars.get(node.chunk) ?? []), node]);
  const dominant = (chunk: number): Node | null => {
    const list = chunkChars.get(chunk) ?? [];
    const total = list.reduce((n, x) => n + x.chars, 0);
    const top = [...list].sort((x, y) => y.chars - x.chars || x.label.localeCompare(y.label))[0];
    return top && total > 0 && top.chars / total >= options.dominantShare ? top : null;
  };
  const present = [...chunkChars.keys()].sort((x, y) => x - y);
  for (let p = 1; p < present.length; p++) {
    const a = dominant(present[p - 1]!);
    const b = dominant(present[p]!);
    if (a && b) union(a.key, b.key, "continuity");
  }

  // 3. Elimination: the one label left on each side of a neighbour pair.
  for (let p = 1; p < present.length; p++) {
    const left = chunkChars.get(present[p - 1]!)!;
    const right = chunkChars.get(present[p]!)!;
    const open = (side: Node[], other: Node[]) =>
      side.filter((n) => !other.some((o) => find(o.key) === find(n.key)));
    const a = open(left, right);
    const b = open(right, left);
    if (a.length === 1 && b.length === 1) union(a[0]!.key, b[0]!.key, "continuity");
  }

  // 5. Recording-wide labels by first appearance.
  const components = new Map<string, Node[]>();
  for (const node of nodes.values()) {
    const root = find(node.key);
    components.set(root, [...(components.get(root) ?? []), node]);
  }
  const ordered = [...components.entries()]
    .map(([root, members]) => ({ root, members, first: Math.min(...members.map((m) => m.firstIdx)) }))
    .sort((x, y) => x.first - y.first);
  const singleChunk = merged.seams.length === 0;
  const labelOf = new Map<string, string>();
  const speakers: TranscriptSpeaker[] = ordered.map(({ root, members }, i) => {
    const label = `S${i + 1}`;
    for (const m of members) labelOf.set(m.key, label);
    const bases = edges.get(root)!;
    let basis: TranscriptSpeaker["basis"];
    let confidence: number;
    if (singleChunk) {
      basis = "single_chunk";
      confidence = 1;
    } else if (bases.length === 0) {
      basis = "unlinked";
      confidence = options.confidence.unlinked;
    } else {
      basis = bases.includes("continuity") ? "continuity" : "overlap";
      confidence = options.confidence[basis];
    }
    return {
      label,
      confidence,
      basis,
      segments: members.reduce((n, m) => n + m.segments, 0),
      chars: members.reduce((n, m) => n + m.chars, 0),
      members: members
        .map((m) => ({ chunk: m.chunk, label: m.label }))
        .sort((x, y) => x.chunk - y.chunk || x.label.localeCompare(y.label)),
    };
  });

  return {
    version: 1,
    duration_ms: merged.duration_ms,
    segments: merged.segments.map((seg, idx) => ({
      idx,
      start_ms: seg.start_ms,
      end_ms: seg.end_ms,
      speaker: labelOf.get(keyOf(seg.chunk, seg.speaker))!,
      text: seg.text,
      source_chunk: seg.chunk,
    })),
    speakers,
    gaps: merged.gaps,
    failed_chunks: merged.failed_chunks,
  };
}
