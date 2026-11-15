// OCR of scanned lecture PDF pages with Gemini (P3-05, CONTRACTS D-P3-3, §1.4 routing.ocr).
// Runs only after the user saw the estimate and confirmed it (POST /assets/{id}/ocr): never
// from an upload or a `process` run. The whole PDF goes inline with the page numbers to
// read; the answer is the visible text of those pages, as JSON. The request follows the
// other Gemini adapters: key in the `x-goog-api-key` header, a pinned model, a
// responseSchema, and every answer validated again with zod.

import { resolveGeminiModel, type GeminiUsageMetadata } from "@lectern/core";
import { z } from "zod";
import { HarnessError } from "./errors.ts";
import { GEMINI_API_BASE, geminiHttpError, geminiKeyOrThrow, withDeadline, type GeminiAdapterOptions } from "./gemini-http.ts";
import { GEMINI_PROVIDER_ID, normalizeGeminiUsage } from "./gemini.ts";
import { sha256Hex } from "./hash.ts";
import type { ProviderCallResult } from "./providers.ts";

/** Pages read per request; each request still carries the whole PDF. */
export const OCR_PAGES_PER_CALL = 8;
/** Inline request data limit (the 20 MB request cap minus base64 and prompt overhead). */
export const OCR_MAX_PDF_BYTES = 18 * 1024 * 1024;

export const OcrResult = z.object({
  pages: z.array(z.object({ page_no: z.int().min(1), text: z.string() })),
});
export type OcrResult = z.infer<typeof OcrResult>;

export interface GeminiOcrOptions extends GeminiAdapterOptions {
  /** routing.ocr.maxOutputTokens. */
  maxOutputTokens?: number;
}

export interface OcrRequest {
  pdf: Uint8Array;
  /** 1-based page numbers to read. */
  pages: number[];
  signal?: AbortSignal;
  repair?: { issues: string } | null;
}

const OCR_PROMPT =
  "첨부한 PDF에서 아래 쪽 번호의 쪽만 읽는다. 각 쪽에 보이는 글자를 읽는 순서대로 그대로 옮긴다. " +
  "요약, 번역, 추측, 설명을 하지 않는다. 글자가 없는 쪽은 빈 문자열로 둔다. " +
  "쪽마다 page_no(정수)와 text를 JSON으로 답한다.\n쪽 번호: ";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    pages: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { page_no: { type: "INTEGER" }, text: { type: "STRING" } },
        propertyOrdering: ["page_no", "text"],
        required: ["page_no", "text"],
      },
    },
  },
  propertyOrdering: ["pages"],
  required: ["pages"],
} as const;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
  responseId?: string;
}

export class GeminiOcrProvider {
  readonly id = GEMINI_PROVIDER_ID;
  /** Memo key parts: the prompt text's hash and the request parameters. */
  readonly fingerprint: { prompt: string; params: unknown };
  private readonly maxOutputTokens: number;

  constructor(
    readonly model: string,
    private readonly opts: GeminiOcrOptions
  ) {
    if (resolveGeminiModel(model) !== model) {
      throw new HarnessError("config", `model ${model} is not in the Gemini allowlist`, { code: "model_not_allowed" });
    }
    this.maxOutputTokens = opts.maxOutputTokens ?? 8192;
    this.fingerprint = {
      prompt: sha256Hex(OCR_PROMPT),
      params: { maxOutputTokens: this.maxOutputTokens, schema: sha256Hex(JSON.stringify(RESPONSE_SCHEMA)), thinkingLevel: "low" },
    };
  }

  requestBody(req: OcrRequest): Record<string, unknown> {
    const repair = req.repair ? `\n\n이전 응답이 검증을 통과하지 못했다: ${req.repair.issues}\n규칙을 지켜 다시 답한다.` : "";
    return {
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "application/pdf", data: Buffer.from(req.pdf).toString("base64") } },
            { text: `${OCR_PROMPT}${req.pages.join(", ")}${repair}` },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingLevel: "low" },
        maxOutputTokens: this.maxOutputTokens,
      },
    };
  }

  async ocr(req: OcrRequest): Promise<OcrResult & ProviderCallResult> {
    if (req.pdf.byteLength > OCR_MAX_PDF_BYTES) {
      throw new HarnessError("input", "PDF is too large for OCR", { code: "pdf_too_large_for_ocr" });
    }
    const key = geminiKeyOrThrow(this.opts);
    const started = Date.now();
    const res = await (this.opts.fetch ?? fetch)(
      `${this.opts.baseUrl ?? GEMINI_API_BASE}/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(this.requestBody(req)),
        signal: withDeadline(req.signal, this.opts.timeoutMs ?? 300_000),
      }
    );
    if (!res.ok) throw await geminiHttpError(res);
    const data = (await res.json()) as GeminiResponse;
    const billed: ProviderCallResult = {
      usage: normalizeGeminiUsage(data.usageMetadata),
      model: data.modelVersion ?? this.model,
      requestId: data.responseId ?? null,
      latencyMs: Date.now() - started,
    };
    const reject = (code: string, message: string) => new HarnessError("output_validation", `Gemini OCR: ${message}`, { code, billed });

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
    const parsed = OcrResult.safeParse(json);
    if (!parsed.success) throw reject("schema", `response does not match the schema: ${parsed.error.message.slice(0, 200)}`);

    // Only the pages asked for, each once.
    const wanted = new Set(req.pages);
    const seen = new Set<number>();
    const pages = parsed.data.pages.filter((p) => {
      if (!wanted.has(p.page_no) || seen.has(p.page_no)) return false;
      seen.add(p.page_no);
      return true;
    });
    return { pages, ...billed };
  }
}
