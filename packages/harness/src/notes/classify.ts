// The first notes stage: what kind of recording this is, its language, a title, and where
// it belongs (CONTRACTS §1.3). It reads a bounded sample of the transcript, not all of it.

import type { RecordingDomain } from "@lectern/domain";
import { llmSchemaHash } from "../gemini-llm.ts";
import { canonicalJson, sha256Hex } from "../hash.ts";
import type { LlmProvider, LlmRequest } from "../providers.ts";
import type { Routing } from "../routing.ts";
import { defineStage, type StageDefinition } from "../stage.ts";
import { formatCompactTranscript, type CompactSegment } from "./compact.ts";
import { ClassifyOutput } from "./schemas.ts";

export interface ClassifyInput {
  /** The whole transcript. */
  segments: CompactSegment[];
  filename: string | null;
  hint: { domain: RecordingDomain | null; folder_id: string | null };
  folders: { id: string; name: string }[];
  /** Existing tag names. */
  tags: string[];
}

const SAMPLE_LIMIT = 6000;
const HEAD_MS = 180_000;
const HEAD_BUDGET = 2900;
const PART_BUDGET = 750;
const PARTS = 4;
const SEPARATOR = "\n...\n";

export const CLASSIFY_SYSTEM = [
  "녹음 전사의 일부를 보고 분류한다. 전사에 나온 내용만 근거로 한다. 확실하지 않으면 confidence를 낮게 적는다.",
  "전사 줄은 `#번호 [분:초] 화자: 본문` 형식이다. 줄 사이의 `...`는 생략된 부분이다.",
].join("\n");

export const CLASSIFY_INSTRUCTION = [
  "다음 필드를 채운다.",
  "- domain: lecture, meeting, seminar, interview, one_on_one, call, other 중 하나.",
  "- language: 녹음의 주된 언어, BCP 47 코드(ko, en, ...).",
  "- title: 녹음 내용을 나타내는 60자 이내의 한 줄 제목.",
  "- participants: 전사에서 이름이 언급된 사람만. 없으면 빈 배열.",
  "- folder_suggestion: 기존 폴더 중 맞는 것이 있으면 folder_id에 그 id를, 없으면 new_name에 새 폴더 이름을 적는다. 둘 중 하나만 쓴다. 모르면 둘 다 null.",
  "- tags: 내용을 나타내는 태그 최대 5개. 기존 태그와 같은 뜻이면 기존 태그 이름을 쓴다.",
  "- confidence: 분류에 대한 확신, 0~1.",
].join("\n");

function line(segment: CompactSegment): string {
  return formatCompactTranscript({ segments: [segment] }).text;
}

/** Appends whole lines until the next one would exceed `budget`; an oversized first line is cut. */
function take(segments: readonly CompactSegment[], budget: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const segment of segments) {
    const text = line(segment);
    const cost = text.length + (lines.length > 0 ? 1 : 0);
    if (used + cost > budget) {
      if (lines.length === 0) lines.push(text.slice(0, budget));
      break;
    }
    lines.push(text);
    used += cost;
  }
  return lines.join("\n");
}

/**
 * A deterministic sample of at most 6000 characters: the first three minutes (up to 2900
 * characters), then four 750-character windows centred in the four quarters of the rest.
 */
export function sampleForClassify(segments: readonly CompactSegment[]): string {
  const head = segments.filter((s) => s.start_ms < HEAD_MS);
  const rest = segments.filter((s) => s.start_ms >= HEAD_MS);
  const pieces: string[] = [];
  const headText = take(head, HEAD_BUDGET);
  if (headText) pieces.push(headText);
  if (rest.length > 0) {
    for (let k = 0; k < PARTS; k++) {
      const start = Math.floor((rest.length * (k + 0.5)) / PARTS);
      const text = take(rest.slice(start), PART_BUDGET);
      if (text) pieces.push(text);
    }
  }
  return pieces.join(SEPARATOR).slice(0, SAMPLE_LIMIT);
}

function instructionFor(input: ClassifyInput, repair: { issues: string } | null): string {
  const folders = input.folders.length ? input.folders.map((f) => `- ${f.id}: ${f.name}`).join("\n") : "(없음)";
  const tags = input.tags.length ? input.tags.map((t) => `- ${t}`).join("\n") : "(없음)";
  const hint = [
    input.hint.domain ? `사용자가 고른 종류: ${input.hint.domain}` : null,
    input.hint.folder_id ? `사용자가 고른 폴더: ${input.hint.folder_id}` : null,
  ].filter(Boolean);
  const parts = [
    CLASSIFY_INSTRUCTION,
    `파일 이름: ${input.filename ?? "(없음)"}`,
    `힌트: ${hint.length ? hint.join(", ") : "(없음)"}`,
    `기존 폴더:\n${folders}`,
    `기존 태그:\n${tags}`,
  ];
  let text = parts.join("\n\n");
  if (repair) text += `\n\n이전 응답이 검증을 통과하지 못했다: ${repair.issues}\n규칙을 지켜 다시 답한다.`;
  return text;
}

function cleanList(values: readonly string[], caseInsensitive: boolean, limit?: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = caseInsensitive ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}

function postProcess(value: ClassifyOutput, input: ClassifyInput): ClassifyOutput {
  const domain = input.hint.domain ?? value.domain;
  let { folder_id, new_name } = value.folder_suggestion;
  if (folder_id !== null && !input.folders.some((f) => f.id === folder_id)) folder_id = null;
  if (folder_id !== null && new_name !== null) new_name = null;
  return {
    ...value,
    domain,
    folder_suggestion: { folder_id, new_name },
    tags: cleanList(value.tags, true, 5),
    participants: cleanList(value.participants, false),
  };
}

export function classifyStage(llm: LlmProvider, routing: Routing): StageDefinition<ClassifyInput, ClassifyOutput> {
  const route = routing.classify;
  return defineStage({
    name: "classify",
    version: 1,
    output: ClassifyOutput,
    memo: "shared",
    retry: { maxAttempts: 3, repairs: 1 },
    key: (input) => ({
      inputs: [
        sha256Hex(formatCompactTranscript({ segments: input.segments }).text),
        sha256Hex(canonicalJson({ filename: input.filename, hint: input.hint, folders: input.folders, tags: input.tags })),
      ],
      prompt: sha256Hex(`${CLASSIFY_SYSTEM}\u0000${CLASSIFY_INSTRUCTION}`),
      provider: llm.id,
      model: route.model,
      params: { schema: llmSchemaHash(ClassifyOutput), maxOutputTokens: route.maxOutputTokens },
    }),
    async run(input, ctx) {
      const req: LlmRequest<ClassifyOutput> = {
        schema: ClassifyOutput,
        system: CLASSIFY_SYSTEM,
        context: [{ type: "text", text: sampleForClassify(input.segments) }],
        instruction: instructionFor(input, ctx.repair),
        model: route.model,
        maxOutputTokens: route.maxOutputTokens,
        signal: ctx.signal,
      };
      const result = await ctx.meter({ provider: llm.id, model: route.model }, () => llm.generate(req));
      return postProcess(result.value, input);
    },
  });
}
