// The fixture side of 물어보기: a small, deterministic stand-in for retrieval-augmented
// answers. It never invents content. Every sentence of an answer comes from the fixture
// notes (document blocks, extracted questions, events, to-dos) and cites the transcript
// range that block already points at, so a citation always lands on what it claims.
//
// - Intents first: 요약, 마감·일정, 할 일, 결정. They pick the matching parts of the notes.
// - A question close to an extracted question gets that question's answer.
// - Otherwise passages are ranked by character-bigram overlap with the question; below a
//   threshold the outcome is `no_answer` ("관련 내용을 찾지 못했습니다") instead of a guess.
//
// The output has the shape of the real one (packages/domain/src/api/ask.ts): `[c1]`
// markers in the text, transcript citations narrowed to the cited segments, `support`
// set when the turn completes. The real retrieval is apps/server + packages/ask.

import type { FixtureData } from "../../fixtures/index.ts";
import { formatDate, formatTimeOfDay } from "../../lib/format.ts";
import { findByIdx } from "../../lib/segments.ts";
import { asId, type AskOutcome, type AskScope, type AskTranscriptCitation, type ChunkId, type DocumentBlock, type Recording, type SourceRef } from "../types.ts";

export interface ComposedAnswer {
  text: string;
  /** Every citation of the text, in order of first use; `support` is set (the stream sends them with null). */
  citations: AskTranscriptCitation[];
  outcome: Extract<AskOutcome, "answered" | "no_answer">;
  /** How many notes were in scope and how many passages were used. */
  recordingCount: number;
  passageCount: number;
}

export interface AskInput {
  workspaceId: string;
  scope: AskScope;
  question: string;
}

interface Passage {
  recording: Recording;
  text: string;
  source: { start_idx: number; end_idx: number };
  kind: "summary" | "block" | "decision" | "question" | "event" | "action";
  /** For questions: the extracted answer. */
  answer?: string;
  /** For events and dated to-dos, for sorting. */
  at?: string;
  /** For to-dos. */
  owner?: string | null;
}

const PROCESSED = new Set(["ready", "partial"]);
const NO_EVIDENCE_SCORE = 0.5;

// Words that say how to answer rather than what about; they never match a note.
const STOP_WORDS = new Set([
  "알려줘", "알려주세요", "정리해", "정리해줘", "요약해", "요약해줘", "설명해", "설명해줘", "보여줘", "모아", "모아줘", "뭐", "뭐야", "뭐였어", "뭐지",
  "무엇", "무엇인가요", "어떻게", "어떤", "언제", "언제야", "누가", "왜", "있어", "있었어", "있나", "했어", "했나", "대해", "대해서", "관련",
  "관련된", "내용", "노트", "이", "그", "좀", "다시", "핵심", "중요한", "줘", "돼", "되나", "해", "점", "가장", "것",
]);
const PARTICLE = /(에서는|에서|으로|이나|나|로|은|는|이|가|을|를|의|에|와|과|도|만|이야|야|요)$/;

/** The question's content words, particles and answer-style words removed. */
function questionKey(question: string): string {
  return question
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((w) => (w.length > 2 ? w.replace(PARTICLE, "") : w))
    .filter((w) => !STOP_WORDS.has(w))
    .join("");
}

function grams(key: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < key.length - 1; i++) out.add(key.slice(i, i + 2));
  return out;
}

/** Share of the question's bigrams that the passage contains. */
function coverage(question: Set<string>, passage: string): number {
  if (question.size === 0) return 0;
  const p = grams(passage.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""));
  let hit = 0;
  for (const g of question) if (p.has(g)) hit++;
  return hit / question.size;
}

function blockText(block: DocumentBlock): string {
  switch (block.type) {
    case "list":
      return block.items.map((i) => i.text).join(" ");
    case "term":
      return `${block.term}: ${block.definition}`;
    case "formula":
      return block.explanation ?? block.expression;
    case "gap":
      return "";
    default:
      return "text" in block ? block.text : "";
  }
}

const firstTranscript = (refs: readonly SourceRef[]) => refs.find((r): r is Extract<SourceRef, { kind: "transcript" }> => r.kind === "transcript");

export function recordingsInScope(data: FixtureData, workspaceId: string, scope: AskScope): Recording[] {
  const all = data.recordings.filter((r) => r.workspace_id === workspaceId && PROCESSED.has(r.status) && data.transcripts.has(r.id));
  if (scope.kind === "recording") return all.filter((r) => r.id === scope.recording_id);
  if (scope.kind === "folder") {
    const ids = new Set<string>([scope.folder_id]);
    if (!scope.include_subfolders) return all.filter((r) => r.folder_id === scope.folder_id);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of data.folders) if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) (ids.add(f.id), (grew = true));
    }
    return all.filter((r) => r.folder_id !== null && ids.has(r.folder_id));
  }
  return all;
}

function passagesOf(data: FixtureData, recording: Recording): Passage[] {
  const out: Passage[] = [];
  const doc = data.documents.find((d) => d.recording_id === recording.id);
  const version = doc && data.versions.find((v) => v.document_id === doc.id && v.version === doc.current_version);
  version?.body?.sections.forEach((section, si) => {
    const decision = /결정|결론|합의/.test(section.title);
    for (const block of section.blocks) {
      const items = block.type === "list" ? block.items.map((i) => ({ text: i.text, sources: i.sources })) : [{ text: blockText(block), sources: "sources" in block ? (block.sources as SourceRef[]) : [] }];
      for (const item of items) {
        const source = firstTranscript(item.sources);
        if (!source || !item.text) continue;
        out.push({ recording, text: item.text, source, kind: si === 0 ? "summary" : decision ? "decision" : "block" });
      }
    }
  });
  for (const q of data.questions.filter((x) => x.recording_id === recording.id)) {
    const source = firstTranscript(q.sources);
    if (source && q.answer) out.push({ recording, text: q.prompt, answer: q.answer, source, kind: "question" });
  }
  for (const e of data.events.filter((x) => x.recording_id === recording.id && x.status !== "dismissed")) {
    const source = firstTranscript(e.evidence.sources);
    if (source) out.push({ recording, text: e.title, source, kind: "event", at: e.start_at });
  }
  for (const a of data.actionItems.filter((x) => x.recording_id === recording.id)) {
    const source = firstTranscript(a.evidence.sources);
    if (source) out.push({ recording, text: a.text, source, kind: "action", at: a.due_at ?? undefined, owner: a.owner_name });
  }
  return out;
}

const INTENTS = {
  summary: /요약|핵심|무슨 내용|어떤 내용|한눈에|개요/,
  deadline: /마감|제출|시험|과제|일정|언제|데드라인|기한|다가오/,
  action: /할 ?일|해야|맡|담당|누가|액션|todo/i,
  decision: /결정|합의|정했|결론/,
};

export function composeAnswer(data: FixtureData, req: AskInput): ComposedAnswer {
  const recordings = recordingsInScope(data, req.workspaceId, req.scope);
  const searched = recordings.length;
  const all = recordings.flatMap((r) => passagesOf(data, r));
  const citations: AskTranscriptCitation[] = [];
  const cite = (p: Passage): string => {
    const existing = citations.find((c) => c.recording_id === p.recording.id && c.start_idx === p.source.start_idx);
    if (existing) return `[${existing.label}]`;
    const c = toCitation(data, p, citations.length + 1);
    if (!c) return "";
    citations.push(c);
    return `[${c.label}]`;
  };
  const many = recordings.length > 1;
  // Bullets name their note only when the picked passages span several notes.
  let spread = false;
  const titled = (p: Passage, text: string) => (spread ? `**${p.recording.title}**: ${text}` : text);
  const noteCount = (ps: Passage[]) => new Set(ps.map((p) => p.recording.id)).size;
  /** "노트 2개에서 …" / "**제목**에서 …" / the single-note lead. */
  const lead = (ps: Passage[], single: string, several: (n: number) => string, fromOne: (title: string) => string) => {
    const n = noteCount(ps);
    spread = n > 1;
    return n > 1 ? several(n) : many ? fromOne(ps[0]!.recording.title) : single;
  };
  // One bullet per cited moment: an event and the to-do it came from share a source.
  const bullets = (ps: Passage[], line: (p: Passage) => string) => {
    const seen = new Set<string>();
    return ps
      .filter((p) => {
        const key = `${p.recording.id}:${p.source.start_idx}`;
        return !seen.has(key) && seen.add(key);
      })
      .map((p) => `- ${line(p)} ${cite(p)}`.trimEnd())
      .join("\n");
  };
  const q = req.question.trim();
  const qGrams = grams(questionKey(q));
  const topic = (ps: Passage[]) => (qGrams.size > 1 ? ps.filter((p) => coverage(qGrams, `${p.recording.title} ${p.text}`) >= 0.3) : []);
  const done = (text: string): ComposedAnswer => ({ text, citations, outcome: "answered", recordingCount: searched, passageCount: citations.length });

  // 마감·일정: events and dated to-dos, soonest first.
  if (INTENTS.deadline.test(q) && !INTENTS.decision.test(q) && !INTENTS.summary.test(q)) {
    const today = new Date(data.now.getTime() - 12 * 3_600_000).toISOString();
    const datedAll = all.filter((p) => (p.kind === "event" || p.kind === "action") && p.at).sort((a, b) => a.at!.localeCompare(b.at!));
    const upcoming = datedAll.filter((p) => p.at! >= today);
    const dated = upcoming.length ? upcoming : datedAll;
    const focused = topic(dated);
    const picked = (focused.length ? focused : dated).slice(0, 6);
    if (picked.length) {
      const when = (iso: string) => `${formatDate(iso, data.now)} ${formatTimeOfDay(iso)}`;
      const head = lead(picked, "다가오는 일정과 마감입니다.", () => "다가오는 일정과 마감입니다.", (title) => `**${title}**의 다가오는 일정과 마감입니다.`);
      return done(`${head}\n${bullets(picked, (p) => titled(p, `${p.text} — ${when(p.at!)}`))}\n일정 화면에서 캘린더에 추가할 수 있습니다.`);
    }
  }

  // 요약: the summary section of one note, or the first summary line of each note.
  if (INTENTS.summary.test(q)) {
    const summaries = all.filter((p) => p.kind === "summary");
    const focused = topic(summaries);
    const pool = focused.length ? focused : summaries;
    const firstOfEach = () => {
      const byNote = new Map<string, Passage>();
      for (const p of pool) if (!byNote.has(p.recording.id)) byNote.set(p.recording.id, p);
      return [...byNote.values()].sort((a, b) => b.recording.recorded_at.localeCompare(a.recording.recorded_at)).slice(0, 4);
    };
    const picked = many ? firstOfEach() : pool.slice(0, 4);
    if (picked.length) {
      const head = lead(picked, "이 노트의 핵심은 다음과 같습니다.", (n) => `노트 ${n}개의 핵심입니다.`, (title) => `**${title}**의 핵심입니다.`);
      return done(`${head}\n${bullets(picked, (p) => titled(p, p.text))}`);
    }
  }

  // 할 일: action items.
  if (INTENTS.action.test(q)) {
    const actions = all.filter((p) => p.kind === "action");
    const focused = topic(actions);
    const picked = (focused.length ? focused : actions).slice(0, 6);
    if (picked.length) {
      const head = lead(picked, "노트에서 나온 할 일입니다.", (n) => `노트 ${n}개에서 나온 할 일입니다.`, (title) => `**${title}**에서 나온 할 일입니다.`);
      const who = (p: Passage) => [p.owner, p.at ? `${formatDate(p.at, data.now)}까지` : null].filter(Boolean).join(", ");
      return done(`${head}\n${bullets(picked, (p) => titled(p, who(p) ? `${p.text} (${who(p)})` : p.text))}`);
    }
  }

  // 결정: blocks under a 결정/결론 section.
  if (INTENTS.decision.test(q)) {
    const decisions = all.filter((p) => p.kind === "decision");
    if (decisions.length) {
      const picked = decisions.slice(0, 6);
      const head = lead(picked, "정해진 사항입니다.", (n) => `노트 ${n}개에서 정해진 사항입니다.`, (title) => `**${title}**에서 정해진 사항입니다.`);
      return done(`${head}\n${bullets(picked, (p) => titled(p, p.text))}`);
    }
  }

  // A question close to an extracted one gets its answer.
  const scored = all
    .filter((p) => p.kind !== "event" && p.kind !== "action")
    .map((p) => ({ p, score: coverage(qGrams, p.text) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best && best.p.kind === "question" && best.score >= 0.55) {
    const related = scored.find((x) => x.p.kind !== "question" && x.p.recording.id === best.p.recording.id && x.score >= NO_EVIDENCE_SCORE);
    const text = [`${best.p.answer} ${cite(best.p)}`, related ? `노트에는 이렇게 정리돼 있습니다. ${related.p.text} ${cite(related.p)}` : ""].filter(Boolean).join("\n");
    return done(many ? `**${best.p.recording.title}**에서 찾았습니다.\n${text}` : text);
  }

  // Otherwise: the best matching passages, or no evidence.
  const relevant = scored.filter((x) => x.score >= NO_EVIDENCE_SCORE && x.p.kind !== "question").slice(0, 4);
  if (!relevant.length) {
    return {
      text:
        searched === 0
          ? "이 범위에는 처리가 끝난 노트가 없습니다."
          : `이 범위의 노트 ${searched}개에서 ‘${q}’와 관련된 내용을 찾지 못했습니다. 다른 표현으로 묻거나 범위를 넓혀 보세요.`,
      citations: [],
      outcome: "no_answer",
      recordingCount: searched,
      passageCount: 0,
    };
  }
  const picked = relevant.map((x) => x.p);
  const head = lead(picked, "노트에서 찾은 관련 내용입니다.", (n) => `노트 ${n}개에서 관련 내용을 찾았습니다.`, (title) => `**${title}**에서 찾은 관련 내용입니다.`);
  return done(`${head}\n${bullets(picked, (p) => titled(p, p.text))}`);
}

function toCitation(data: FixtureData, p: Passage, n: number): AskTranscriptCitation | null {
  const segments = data.transcripts.get(p.recording.id)?.segments ?? [];
  const first = findByIdx(segments, p.source.start_idx);
  const last = findByIdx(segments, p.source.end_idx);
  if (first < 0 || last < first) return null;
  const quote = segments
    .slice(first, last + 1)
    .map((s) => s.text)
    .join(" ");
  return {
    kind: "transcript",
    label: `c${n}`,
    chunk_id: asId<ChunkId>(`chk_${p.recording.id}_${p.source.start_idx}`),
    recording_id: p.recording.id,
    recording_title: p.recording.title,
    snippet: quote.length > 160 ? `${quote.slice(0, 160)}…` : quote,
    // The fixture's sentences are the notes' own, so every citation is supported.
    support: "supported",
    available: true,
    start_idx: p.source.start_idx,
    end_idx: p.source.end_idx,
    start_ms: segments[first]!.start_ms,
    end_ms: segments[last]!.end_ms,
  };
}

/** Splits an answer into stream deltas without breaking `[c1]` markers or `**`. */
export function streamChunks(text: string, size = 4): string[] {
  const tokens = text.match(/\[c\d+\]|\*\*|[\s\S]/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += size) out.push(tokens.slice(i, i + size).join(""));
  return out;
}
