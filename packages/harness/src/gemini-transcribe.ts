// Gemini audio transcription (AI_HARNESS §3.4, §5): one generateContent call per chunk,
// the chunk inline (a 6–8 minute AAC 32 kbps chunk is about 2 MB, well under the 20 MB
// request limit, so there is no Files API upload to poll and delete), structured output
// forced with a response schema.
//
// - The model answers clip-relative `MM:SS` timestamps, the form Gemini's audio docs use;
//   code turns them into milliseconds. Speaker labels are normalized to `S<n>`.
// - Thinking is billed as output. Transcription needs little of it, so the request asks for
//   the lowest level 3.8 Flash allows ("low"); `maxOutputTokens` leaves room for it.
// - Temperature stays at the model default: Gemini 3 guidance warns that lowering it can
//   cause looping, the failure §3.4 already guards against.
// - A 200 answer that cannot be used (empty, truncated, blocked, malformed JSON, bad
//   timestamps) throws output_validation with `billed`, so the ledger records what it cost
//   and the runner's single repair attempt follows.

import { readFileSync } from "node:fs";
import { resolveGeminiModel, type GeminiUsageMetadata } from "@lectern/core";
import type { TranscribeResult, TranscribeSegment } from "@lectern/domain";
import { formatClock, type RenderedChunk } from "@lectern/media";
import { z } from "zod";
import { HarnessError } from "./errors.ts";
import {
  GEMINI_API_BASE,
  geminiHttpError,
  geminiKeyOrThrow,
  withDeadline,
  type GeminiAdapterOptions,
} from "./gemini-http.ts";
import { GEMINI_PROVIDER_ID, normalizeGeminiUsage } from "./gemini.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import type { ProviderCallResult, TranscribeOptions, TranscriptionProvider } from "./providers.ts";
import { parseClock } from "./transcript/text.ts";

/** Pinned transcription model (AI_HARNESS §6.1, routing A). Changing it goes through the eval (§8). */
export const TRANSCRIBE_MODEL = "gemini-3.8-flash";

/** The prompt file; its content hash is part of the transcribe memo key (§4.4). */
export const TRANSCRIBE_PROMPT_PATH = new URL("../prompts/transcribe.md", import.meta.url);

let promptTemplate: string | null = null;

export function transcribePromptTemplate(): string {
  promptTemplate ??= readFileSync(TRANSCRIBE_PROMPT_PATH, "utf8");
  return promptTemplate;
}

export function renderTranscribePrompt(
  template: string,
  args: { durationMs: number; language?: string; speakersHint?: number; repair?: { issues: string } | null },
): string {
  const text = template
    .replaceAll("{{duration}}", formatClock(args.durationMs))
    .replaceAll("{{language}}", args.language ? ` 예상 언어: ${args.language}.` : "")
    .replaceAll("{{speakers}}", args.speakersHint ? ` 예상 화자 수: ${args.speakersHint}명.` : "")
    .trimEnd();
  if (!args.repair) return text;
  return `${text}\n\n이전 응답이 검증을 통과하지 못했다: ${args.repair.issues}\n규칙을 지켜 처음부터 다시 받아쓴다.`;
}

const SPEAKER_ENUM = Array.from({ length: 9 }, (_, i) => `S${i + 1}`);

/** responseSchema (the OpenAPI subset generateContent takes). Hashed into the memo key. */
export const GEMINI_TRANSCRIBE_SCHEMA = Object.freeze({
  type: "OBJECT",
  properties: {
    language: { type: "STRING", description: "주된 언어의 BCP 47 코드 (ko, en, ...)" },
    segments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          start: { type: "STRING", description: "클립 시작부터의 시작 시간, MM:SS" },
          end: { type: "STRING", description: "클립 시작부터의 끝 시간, MM:SS" },
          speaker: { type: "STRING", enum: SPEAKER_ENUM },
          text: { type: "STRING" },
        },
        required: ["start", "end", "speaker", "text"],
        propertyOrdering: ["start", "end", "speaker", "text"],
      },
    },
  },
  required: ["language", "segments"],
  propertyOrdering: ["language", "segments"],
});

const RawResponse = z.object({
  language: z.string().optional(),
  segments: z.array(z.object({ start: z.string(), end: z.string(), speaker: z.string(), text: z.string() })),
});

const LANGUAGE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** `S1`, `s2`, `Speaker 3`, `화자 4` → `S<n>`; anything without a number → `S1`. */
export function normalizeSpeakerLabel(label: string): string {
  const n = /(\d+)/.exec(label)?.[1];
  return n && Number(n) > 0 ? `S${Number(n)}` : "S1";
}

export interface GeminiTranscriptionOptions extends GeminiAdapterOptions {
  /** Requested model, resolved against the allowlist (LECTERN_GEMINI_ALLOWED_MODELS). */
  model?: string;
  thinkingLevel?: "low" | "medium" | "high";
  /** Includes thinking tokens. */
  maxOutputTokens?: number;
  /** Larger chunks are refused (inline requests are capped at 20 MB including base64). */
  maxInlineBytes?: number;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
  responseId?: string;
}

export class GeminiTranscriptionProvider implements TranscriptionProvider {
  readonly id = GEMINI_PROVIDER_ID;
  readonly model: string;
  /** The harness's chunk ceiling for LLM transcription (§3.3: 5–8 minutes), not Gemini's 9.5 h. */
  readonly maxChunkSeconds = 8 * 60;
  readonly fingerprint: { prompt: string; params: unknown };
  private readonly thinkingLevel: "low" | "medium" | "high";
  private readonly maxOutputTokens: number;
  private readonly maxInlineBytes: number;

  constructor(private readonly opts: GeminiTranscriptionOptions) {
    this.model = resolveGeminiModel(opts.model ?? TRANSCRIBE_MODEL);
    this.thinkingLevel = opts.thinkingLevel ?? "low";
    this.maxOutputTokens = opts.maxOutputTokens ?? 16_384;
    this.maxInlineBytes = opts.maxInlineBytes ?? 14 * 1024 * 1024;
    this.fingerprint = {
      prompt: sha256Hex(transcribePromptTemplate()),
      params: {
        schema: sha256Hex(canonicalJson(GEMINI_TRANSCRIBE_SCHEMA)),
        thinkingLevel: this.thinkingLevel,
        maxOutputTokens: this.maxOutputTokens,
        temperature: "default",
        transport: "inline",
      },
    };
  }

  /** The generateContent body for one chunk (exported for tests through the instance). */
  requestBody(audioBase64: string, mime: string, prompt: string): Record<string, unknown> {
    return {
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: audioBase64 } }, { text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_TRANSCRIBE_SCHEMA,
        thinkingConfig: { thinkingLevel: this.thinkingLevel },
        maxOutputTokens: this.maxOutputTokens,
      },
    };
  }

  async transcribe(chunk: RenderedChunk, opts: TranscribeOptions): Promise<TranscribeResult & ProviderCallResult> {
    const key = geminiKeyOrThrow(this.opts);
    if (chunk.bytes > this.maxInlineBytes) {
      throw new HarnessError("config", `청크 ${chunk.index}(${chunk.bytes}바이트)가 인라인 전송 한도를 넘습니다.`, {
        code: "chunk_too_large",
      });
    }
    const durationMs = chunk.end_ms - chunk.start_ms;
    const audio = Buffer.from(await Bun.file(chunk.path).arrayBuffer()).toString("base64");
    const prompt = renderTranscribePrompt(transcribePromptTemplate(), {
      durationMs,
      language: opts.language,
      speakersHint: opts.speakersHint,
      repair: opts.repair,
    });
    const started = Date.now();
    const res = await (this.opts.fetch ?? fetch)(
      `${this.opts.baseUrl ?? GEMINI_API_BASE}/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(this.requestBody(audio, chunk.mime, prompt)),
        signal: withDeadline(opts.signal, this.opts.timeoutMs ?? 300_000),
      },
    );
    if (!res.ok) throw await geminiHttpError(res);
    const data = (await res.json()) as GeminiResponse;
    const billed: ProviderCallResult = {
      usage: normalizeGeminiUsage(data.usageMetadata, durationMs / 1000),
      model: data.modelVersion ?? this.model,
      requestId: data.responseId ?? null,
      latencyMs: Date.now() - started,
    };
    const reject = (code: string, message: string) =>
      new HarnessError("output_validation", `Gemini transcription of chunk ${chunk.index}: ${message}`, { code, billed });

    if (data.promptFeedback?.blockReason) throw reject("blocked", `request blocked (${data.promptFeedback.blockReason})`);
    const candidate = data.candidates?.[0];
    const finish = candidate?.finishReason;
    if (finish === "MAX_TOKENS") throw reject("truncated", "output hit maxOutputTokens");
    if (finish && finish !== "STOP") throw reject("finish_reason", `finished with ${finish}`);
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();
    if (!text) throw reject("empty_response", "empty response");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw reject("malformed_json", "response is not JSON");
    }
    const parsed = RawResponse.safeParse(json);
    if (!parsed.success) throw reject("schema", `response does not match the schema: ${parsed.error.message.slice(0, 200)}`);

    const segments: TranscribeSegment[] = [];
    for (const [i, seg] of parsed.data.segments.entries()) {
      const start = parseClock(seg.start);
      const end = parseClock(seg.end);
      if (start === null || end === null) throw reject("bad_timestamp", `segment ${i} has an unreadable timestamp`);
      segments.push({ start_ms: start, end_ms: end, speaker: normalizeSpeakerLabel(seg.speaker), text: seg.text.trim() });
    }
    const language = parsed.data.language?.trim().toLowerCase();
    return {
      segments,
      ...(language && LANGUAGE_RE.test(language) ? { language } : {}),
      ...billed,
    };
  }
}
