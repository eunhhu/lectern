// Citation checks (docs/adr/0009-ask-rag.md, "인용 검증"). Code, not a model, decides
// whether a citation stands, like the harness verify stage (AI_HARNESS §3.9):
//
// 1. Reference: a marker must name a passage given to the model in this turn. Unknown
//    markers are removed from the text as it streams.
// 2. Scope: the passage must lie inside the thread's AccessScope (checked again here).
// 3. Support: the sentence that carries the marker must share enough wording with the
//    passage (bigram containment). Below the threshold the citation is `weak`.
// 4. Narrowing: a transcript citation is narrowed to the segments that best match the
//    sentence, so the player jumps to the right second, not the window start.
// 5. Outcome: the model's 모름 sentinel → `no_answer`; no surviving citation →
//    `unsupported`; otherwise `answered`.

import type { AskCitation, AskOutcome } from "@lectern/domain";
import { NO_ANSWER_SENTINEL, type Passage } from "./context.ts";
import { type AccessScope, assertInScope } from "./scope.ts";
import { indexTokens } from "./text.ts";

/** Minimum share of a sentence's tokens found in the cited passage. Provisional; fit on the eval set. */
export const SUPPORT_MIN = 0.3;
const NARROW_NEIGHBOR_RATIO = 0.6;
const SNIPPET_CHARS = 200;

const MARKER = /[[【]\s*(c\d{1,3}(?:\s*[,;]\s*c\d{1,3})*)\s*[\]】]/g;
const MARKER_ONLY = /\[(c\d{1,3})\]/g;

/**
 * Cleans the answer while it streams: removes markers for unknown passages, normalizes
 * `[c1, c2]` to `[c1][c2]`, detects the 모름 sentinel at the start, and holds back a
 * marker cut in half by a chunk boundary.
 */
export class AnswerStreamFilter {
  private pending = "";
  private started = false;
  private seen = new Set<string>();
  /** The cleaned answer so far. */
  text = "";
  noAnswer = false;

  private labels: Set<string>;

  constructor(labels: Iterable<string>) {
    this.labels = new Set(labels);
  }

  /** Passages added by a tool round become citable. */
  addLabels(labels: Iterable<string>): void {
    for (const label of labels) this.labels.add(label);
  }

  push(delta: string): { text: string; newLabels: string[] } {
    this.pending += delta;
    return this.drain(false);
  }

  end(): { text: string; newLabels: string[] } {
    return this.drain(true);
  }

  private drain(final: boolean): { text: string; newLabels: string[] } {
    let buf = this.pending;
    if (!this.started) {
      const head = buf.trimStart();
      if (!final && head.length < NO_ANSWER_SENTINEL.length && NO_ANSWER_SENTINEL.startsWith(head)) {
        return { text: "", newLabels: [] };
      }
      this.started = true;
      if (head.startsWith(NO_ANSWER_SENTINEL)) {
        this.noAnswer = true;
        buf = head.slice(NO_ANSWER_SENTINEL.length).trimStart();
      }
    }
    let hold = "";
    if (!final) {
      const open = Math.max(buf.lastIndexOf("["), buf.lastIndexOf("【"));
      if (open !== -1 && !/[\]】]/.test(buf.slice(open)) && buf.length - open <= 24) {
        hold = buf.slice(open);
        buf = buf.slice(0, open);
      }
    }
    this.pending = hold;
    const newLabels: string[] = [];
    let text = buf.replace(MARKER, (_match, inner: string) => {
      const kept = inner.split(/\s*[,;]\s*/).filter((label) => this.labels.has(label));
      for (const label of kept) {
        if (this.seen.has(label)) continue;
        this.seen.add(label);
        newLabels.push(label);
      }
      return kept.map((label) => `[${label}]`).join("");
    });
    if (final) text = text.replace(/[ \t]+$/g, "");
    this.text += text;
    return { text, newLabels };
  }
}

function tokenSet(text: string): Set<string> {
  return new Set(indexTokens(text));
}

/** Share of `claim`'s tokens that appear in `passage` (1 when the claim has no tokens). */
export function supportScore(claim: string, passage: string | Set<string>): number {
  const c = tokenSet(claim);
  if (c.size === 0) return 1;
  const p = typeof passage === "string" ? tokenSet(passage) : passage;
  let hit = 0;
  for (const t of c) if (p.has(t)) hit++;
  return hit / c.size;
}

/** The sentence a marker at the end of `before` belongs to. */
function lastSentence(before: string): string {
  const body = before.replace(/\s+$/u, "").replace(/[.!?。]+$/u, "");
  const cut = Math.max(...[".", "!", "?", "。", "\n"].map((t) => body.lastIndexOf(t)));
  return body.slice(cut + 1).replace(/^\s*(?:[-*]|\d+\.)\s+/u, "").trim();
}

/** Every sentence that cites each label, markers removed. */
export function claimsByLabel(answer: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let plain = "";
  let last = 0;
  for (const m of answer.matchAll(MARKER_ONLY)) {
    plain += answer.slice(last, m.index);
    last = m.index! + m[0].length;
    const claim = lastSentence(plain);
    out.set(m[1]!, [...(out.get(m[1]!) ?? []), claim]);
  }
  return out;
}

export interface Narrowed {
  startIdx: number;
  endIdx: number;
  startMs: number;
  endMs: number;
  text: string;
}

/** The segment(s) of a transcript passage that best match `claim`. */
export function narrowTranscript(passage: Passage, claim: string): Narrowed | null {
  const { spans, text } = passage.chunk;
  if (!spans?.length) return null;
  const scores = spans.map(([, , , from, to]) => supportScore(claim, text.slice(from, to)));
  let best = 0;
  scores.forEach((s, i) => {
    if (s > scores[best]!) best = i;
  });
  let lo = best;
  let hi = best;
  const floor = scores[best]! * NARROW_NEIGHBOR_RATIO;
  if (scores[best]! > 0) {
    while (lo > 0 && scores[lo - 1]! >= floor && scores[lo - 1]! > 0) lo--;
    while (hi < spans.length - 1 && scores[hi + 1]! >= floor && scores[hi + 1]! > 0) hi++;
  }
  return {
    startIdx: spans[lo]![0],
    endIdx: spans[hi]![0],
    startMs: spans[lo]![1],
    endMs: Math.max(...spans.slice(lo, hi + 1).map((s) => s[2])),
    text: text.slice(spans[lo]![3], spans[hi]![4]),
  };
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS - 1)}…` : flat;
}

/** The citation DTO for a passage. `support` null and no narrowing while streaming. */
export function toCitation(
  passage: Passage,
  access: AccessScope,
  check: { support: "supported" | "weak"; narrowed: Narrowed | null } | null,
): AskCitation {
  const c = passage.chunk;
  const base = {
    label: passage.label,
    chunk_id: c.id,
    recording_id: c.recordingId,
    recording_title: access.recordings.get(c.recordingId)?.title ?? "",
    support: check?.support ?? null,
    available: true,
  };
  if (c.kind === "transcript") {
    const n = check?.narrowed;
    return {
      kind: "transcript",
      ...base,
      snippet: snippet(n?.text ?? c.text),
      start_idx: n?.startIdx ?? c.startIdx ?? 0,
      end_idx: n?.endIdx ?? c.endIdx ?? 0,
      start_ms: n?.startMs ?? c.startMs ?? 0,
      end_ms: n?.endMs ?? c.endMs ?? 0,
    } as AskCitation;
  }
  if (c.kind === "pdf_page") {
    return { kind: "pdf_page", ...base, snippet: snippet(c.text), asset_id: c.assetId!, page: c.page! } as AskCitation;
  }
  return {
    kind: "document",
    ...base,
    snippet: snippet(c.text),
    document_id: c.documentId!,
    document_version: c.documentVersion ?? 1,
    block_id: c.blockId,
    section_title: c.heading?.split(" › ")[0] ?? null,
    start_ms: c.startMs,
    sources: c.sources ?? [],
  } as AskCitation;
}

export interface VerifiedAnswer {
  answer: string;
  citations: AskCitation[];
  outcome: AskOutcome;
}

export const NO_ANSWER_TEXT = "노트에서 이 질문에 답할 내용을 찾지 못했습니다.";

/** Runs checks 2–5 on a finished, filtered answer. */
export function verifyAnswer(args: {
  answer: string;
  noAnswer: boolean;
  passages: readonly Passage[];
  access: AccessScope;
}): VerifiedAnswer {
  const byLabel = new Map(args.passages.map((p) => [p.label, p]));
  const claims = claimsByLabel(args.answer);
  const citations: AskCitation[] = [];
  for (const [label, sentences] of claims) {
    const passage = byLabel.get(label);
    if (!passage) continue; // the stream filter already removed it; belt and braces
    assertInScope(args.access, passage.chunk);
    const passageTokens = tokenSet(`${passage.chunk.heading ?? ""}\n${passage.chunk.text}`);
    let bestClaim = sentences[0] ?? "";
    let best = -1;
    for (const s of sentences) {
      const score = supportScore(s, passageTokens);
      if (score > best) {
        best = score;
        bestClaim = s;
      }
    }
    citations.push(
      toCitation(passage, args.access, {
        support: best >= SUPPORT_MIN ? "supported" : "weak",
        narrowed: passage.chunk.kind === "transcript" ? narrowTranscript(passage, bestClaim) : null,
      }),
    );
  }
  citations.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)));
  if (args.noAnswer) {
    return { answer: args.answer.trim() || NO_ANSWER_TEXT, citations, outcome: "no_answer" };
  }
  return { answer: args.answer, citations, outcome: citations.length ? "answered" : "unsupported" };
}
