// The fixture side of 물어보기: a small, deterministic stand-in for retrieval-augmented
// answers. It never invents content. Every sentence of an answer comes from the fixture
// notes (document blocks, extracted questions, events, to-dos) and cites the transcript
// range that block already points at, so a citation always lands on what it claims.
//
// - Intents first: 요약, 마감·일정, 할 일, 결정. They pick the matching parts of the notes.
// - A question close to an extracted question gets that question's answer.
// - Otherwise passages are ranked by character-bigram overlap with the question; below a
//   threshold the answer is `no_evidence` ("관련 내용을 찾지 못했습니다") instead of a guess.
//
// The real retrieval is designed elsewhere (README "domain 요청").

import { speakerName } from "../../app/labels.ts";
import type { FixtureData } from "../../fixtures/index.ts";
import { formatDate, formatTimeOfDay } from "../../lib/format.ts";
import { findByIdx } from "../../lib/segments.ts";
import type { AskCitation, AskRequest, AskScope, DocumentBlock, Recording, SourceRef } from "../types.ts";

export interface ComposedAnswer {
  text: string;
  citations: AskCitation[];
  status: "complete" | "no_evidence";
  searched: number;
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
    const ids = new Set([scope.folder_id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of data.folders) if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) (ids.add(f.id), (grew = true));
    }
    return all.filter((r) => r.folder_id !== null && ids.has(r.folder_id));
  }
  return all;
}

export function scopeLabel(data: FixtureData, scope: AskScope): string {
  if (scope.kind === "recording") return data.recordings.find((r) => r.id === scope.recording_id)?.title ?? "노트";
  if (scope.kind === "folder") return `${data.folders.find((f) => f.id === scope.folder_id)?.name ?? "폴더"} 폴더`;
  return "전체 노트";
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

export function composeAnswer(data: FixtureData, req: AskRequest): ComposedAnswer {
  const recordings = recordingsInScope(data, req.workspace_id, req.scope);
  const searched = recordings.length;
  const all = recordings.flatMap((r) => passagesOf(data, r));
  const citations: AskCitation[] = [];
  const cite = (p: Passage): string => {
    const existing = citations.find((c) => c.recording_id === p.recording.id && c.start_idx === p.source.start_idx);
    if (existing) return `[${existing.n}]`;
    const c = toCitation(data, p, citations.length + 1);
    if (!c) return "";
    citations.push(c);
    return `[${c.n}]`;
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
  const done = (text: string): ComposedAnswer => ({ text, citations, status: "complete", searched });

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
      status: "no_evidence",
      searched,
    };
  }
  const picked = relevant.map((x) => x.p);
  const head = lead(picked, "노트에서 찾은 관련 내용입니다.", (n) => `노트 ${n}개에서 관련 내용을 찾았습니다.`, (title) => `**${title}**에서 찾은 관련 내용입니다.`);
  return done(`${head}\n${bullets(picked, (p) => titled(p, p.text))}`);
}

function toCitation(data: FixtureData, p: Passage, n: number): AskCitation | null {
  const segments = data.transcripts.get(p.recording.id)?.segments ?? [];
  const first = findByIdx(segments, p.source.start_idx);
  const last = findByIdx(segments, p.source.end_idx);
  if (first < 0 || last < first) return null;
  const seg = segments[first]!;
  const speaker = data.speakers.find((s) => s.id === seg.speaker_id);
  const quote = segments
    .slice(first, last + 1)
    .map((s) => s.text)
    .join(" ");
  return {
    n,
    recording_id: p.recording.id,
    recording_title: p.recording.title,
    start_idx: p.source.start_idx,
    end_idx: p.source.end_idx,
    start_ms: seg.start_ms,
    end_ms: segments[last]!.end_ms,
    speaker: speaker ? speakerName(speaker.label, speaker.display_name) : null,
    quote: quote.length > 160 ? `${quote.slice(0, 160)}…` : quote,
  };
}

/** Chips under the composer: what is worth asking about this scope. */
export function suggestionsFor(data: FixtureData, workspaceId: string, scope: AskScope): string[] {
  const recordings = recordingsInScope(data, workspaceId, scope);
  if (scope.kind === "recording") {
    const rec = recordings[0];
    if (!rec) return [];
    const fromQuestions = data.questions
      .filter((q) => q.recording_id === rec.id && q.answer)
      .slice(0, 2)
      .map((q) => q.prompt);
    const base =
      rec.domain === "meeting" || rec.domain === "interview"
        ? ["결정된 사항은?", "누가 무엇을 맡았어?"]
        : rec.domain === "lecture"
          ? ["핵심 내용을 요약해 줘", "시험이나 과제 관련 내용은?"]
          : ["핵심 내용을 요약해 줘", "해야 할 일이 있었어?"];
    return [...base, ...fromQuestions].slice(0, 4);
  }
  const latest = [...recordings].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  const out = [scope.kind === "folder" ? "이 폴더 노트들의 핵심을 요약해 줘" : "다가오는 마감과 일정을 정리해 줘", "해야 할 일을 모아 줘"];
  if (recordings.some((r) => r.domain === "meeting")) out.push("최근 회의에서 결정된 사항은?");
  if (latest) out.push(`‘${latest.title}’ 핵심 요약`);
  return out.slice(0, 4);
}

/** Splits an answer into stream deltas without breaking `[n]` markers or `**`. */
export function streamChunks(text: string, size = 4): string[] {
  const tokens = text.match(/\[\d+\]|\*\*|[\s\S]/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += size) out.push(tokens.slice(i, i + size).join(""));
  return out;
}
