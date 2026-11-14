// The notes pipeline as one job on the runner (CONTRACTS §1.1 step 4, §1.3):
// classify → structure → extract → verify → render. Called again with the same job, it
// resumes: finished stages are served from their memo. When a later stage fails it keeps
// what it can and marks the result `partial` (D-P1-2); config errors, cancels and (before
// there is a document) budget stops end the run.

import type { RecordingDomain } from "@lectern/domain";
import { HarnessError, classifyError, type ErrorKind } from "../errors.ts";
import type { PdfContext } from "../pdf/context.ts";
import type { LlmProvider } from "../providers.ts";
import type { Routing } from "../routing.ts";
import type { JobRun } from "../runner.ts";
import type { StageDefinition } from "../stage.ts";
import { loadTemplate, templateForDomain, TEMPLATES_DIR } from "../templates.ts";
import type { Transcript } from "../transcript/schemas.ts";
import { classifyStage } from "./classify.ts";
import type { CompactSegment } from "./compact.ts";
import { extractStage } from "./extract.ts";
import { renderDocumentMarkdown } from "./render.ts";
import { NotesResult, type ClassifyOutput } from "./schemas.ts";
import { structureStage } from "./structure.ts";
import { verifyDocument, verifyStage, type VerifyInput, type VerifyOutput } from "./verify.ts";

export interface NotesPipelineInput {
  /** The published transcript (harness Transcript). */
  transcript: Transcript;
  filename: string | null;
  hint: { domain: RecordingDomain | null; folder_id: string | null };
  folders: { id: string; name: string }[];
  tags: string[];
  recordedAtMs: number;
  recordedAtSource: "client" | "media" | "upload";
  tz: string;
  /** Related lecture PDF pages from the alignment (P3-04); structure and extract see them. */
  pdf?: PdfContext;
}

export type NotesStageName = "classify" | "structure" | "extract" | "verify" | "render";

export interface NotesStageEvent {
  stage: NotesStageName;
  cacheHit: boolean;
  resumed: boolean;
  value: unknown;
}

export interface NotesPipelineOptions {
  llm: LlmProvider;
  routing: Routing;
  onStage?: (event: NotesStageEvent) => void;
  /** Tests only; default TEMPLATES_DIR. */
  templatesDir?: URL | string;
}

const ALWAYS_FATAL: ReadonlySet<ErrorKind> = new Set(["config", "canceled"]);
const CLASSIFY_FATAL: ReadonlySet<ErrorKind> = new Set(["config", "canceled", "budget"]);

function fallbackTitle(filename: string | null): string {
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const title = stem.trim().slice(0, 60).trim();
  return title || "녹음";
}

export async function runNotesPipeline(
  run: JobRun,
  input: NotesPipelineInput,
  options: NotesPipelineOptions
): Promise<NotesResult> {
  const { llm, routing } = options;
  const throwIfCanceled = () => {
    if (run.context.signal?.aborted) throw new HarnessError("canceled", "작업이 취소되었습니다.");
  };
  const step = async <I, O>(name: NotesStageName, stage: StageDefinition<I, O>, stageInput: I): Promise<O> => {
    throwIfCanceled();
    const result = await run.run(stage, stageInput);
    options.onStage?.({ stage: name, cacheHit: result.cacheHit, resumed: result.resumed, value: result.value });
    return result.value;
  };

  const segments: CompactSegment[] = input.transcript.segments.map((s) => ({
    idx: s.idx,
    start_ms: s.start_ms,
    speaker: s.speaker,
    text: s.text,
  }));

  // classify: a failure other than config/cancel/budget falls back to a neutral classification.
  let classification: ClassifyOutput;
  let fallback = false;
  try {
    classification = await step("classify", classifyStage(llm, routing), {
      segments,
      filename: input.filename,
      hint: input.hint,
      folders: input.folders,
      tags: input.tags,
    });
  } catch (err) {
    const error = classifyError(err);
    if (CLASSIFY_FATAL.has(error.kind)) throw error;
    fallback = true;
    classification = {
      domain: input.hint.domain ?? "other",
      language: "ko",
      title: fallbackTitle(input.filename),
      participants: [],
      folder_suggestion: { folder_id: null, new_name: null },
      tags: [],
      confidence: 0,
    };
  }

  const templateId =
    fallback && input.hint.domain
      ? templateForDomain(input.hint.domain)
      : templateForDomain(classification.domain, classification.confidence);
  const template = loadTemplate(templateId, options.templatesDir ?? TEMPLATES_DIR);
  const language = classification.language;

  // structure: no document without it, so every failure ends the run.
  const structure = await step("structure", structureStage(llm, routing), { template, segments, language, pdf: input.pdf });

  let extractFailed = false;
  let extract = {};
  try {
    extract = await step("extract", extractStage(llm, routing), {
      template,
      segments,
      language,
      recordedAtMs: input.recordedAtMs,
      tz: input.tz,
      pdf: input.pdf,
    });
  } catch (err) {
    const error = classifyError(err);
    if (ALWAYS_FATAL.has(error.kind)) throw error;
    extractFailed = true;
    extract = {};
  }

  const verifyInput: VerifyInput = {
    template,
    structure,
    extract,
    transcript: { segments: input.transcript.segments, gaps: input.transcript.gaps },
    recordedAtMs: input.recordedAtMs,
    recordedAtSource: input.recordedAtSource,
    tz: input.tz,
    language,
    pdfLabels: input.pdf?.labels,
  };
  let verified: VerifyOutput;
  let verifyDegraded = false;
  try {
    verified = await step("verify", verifyStage(llm, routing), verifyInput);
  } catch (err) {
    const error = classifyError(err);
    if (ALWAYS_FATAL.has(error.kind)) throw error;
    throwIfCanceled();
    verifyDegraded = true;
    verified = await verifyDocument(verifyInput, null);
  }

  throwIfCanceled();
  const markdown = renderDocumentMarkdown(verified.body, {
    title: classification.title,
    segments: input.transcript.segments.map((s) => ({ idx: s.idx, start_ms: s.start_ms })),
  });
  options.onStage?.({ stage: "render", cacheHit: false, resumed: false, value: markdown });

  return NotesResult.parse({
    classification,
    template: { id: template.def.id, version: template.def.version },
    body: verified.body,
    markdown,
    events: verified.events,
    action_items: verified.action_items,
    report: verified.report,
    partial: verified.partial || extractFailed || verifyDegraded,
  });
}
