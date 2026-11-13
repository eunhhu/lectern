// A scripted notes "model" for `bun run harness eval --notes`: it answers every notes stage
// from the eval set's annotations, so the metrics measure the harness (resolution, matching,
// verification) at no cost. Knobs make it wrong on purpose: leave out annotations, shift
// dates by a day, add events nobody said. Decisions are fixed per item by the seed, so a
// run is reproducible whatever order the calls come in.

import { RecordingDomain, templateOutputSchema, type TemplateDefinition } from "@lectern/domain";
import { HarnessError } from "../errors.ts";
import type { LlmRequest } from "../providers.ts";
import { CLASSIFY_SYSTEM } from "../notes/classify.ts";
import { extractSchemaFor } from "../notes/extract.ts";
import { loadTemplate, templateForDomain } from "../templates.ts";
import { ScriptedLlmProvider } from "./scripted-llm.ts";
import type { Annotation, EvalItem, EvalSet } from "./set.ts";

export interface OracleOptions {
  /** Share of event/action-item annotations left out (0..1). */
  dropRate?: number;
  /** Share of events answered one day off (0..1). */
  wrongDateRate?: number;
  /** Chance per item of one event that no annotation backs (0..1). */
  extraRate?: number;
  seed?: number;
}

/** The confidence the oracle classifies with: high enough to pick the domain's template. */
export const ORACLE_CONFIDENCE = 0.9;

/** Default recording time of an eval item without `recorded_at:` front matter. */
export const EVAL_RECORDED_AT = "2026-10-19T14:00:00+09:00";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The domain an item declares, as the classifier would answer it. */
export function itemDomain(item: EvalItem): RecordingDomain {
  const parsed = RecordingDomain.safeParse(item.domain);
  return parsed.success ? parsed.data : "other";
}

/** The template the notes pipeline picks for an item the oracle classified. */
export function oracleTemplate(item: EvalItem): TemplateDefinition {
  return loadTemplate(templateForDomain(itemDomain(item), ORACLE_CONFIDENCE)).def;
}

/** Reference lines as segments (empty lines left out), `#idx` = position. */
export function referenceSegments(item: EvalItem): Array<{ idx: number; start_ms: number; end_ms: number; speaker: string; text: string }> {
  return item.reference.lines
    .filter((line) => line.text.trim() !== "")
    .map((line, idx) => ({ idx, start_ms: line.start_ms, end_ms: line.end_ms, speaker: line.speaker, text: line.text }));
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "10월 26일" or "10월 26일 14시 30분": an expression the Korean date resolver reads exactly. */
function dateExpression(date: string, time: string | null): string {
  const [, month, day] = date.split("-").map(Number);
  if (!time) return `${month}월 ${day}일`;
  const [hour, minute] = time.split(":").map(Number);
  return `${month}월 ${day}일 ${hour}시${minute ? ` ${minute}분` : ""}`;
}

interface ItemPlan {
  item: EvalItem;
  def: TemplateDefinition;
  segments: ReturnType<typeof referenceSegments>;
  events: Array<{ annotation: Annotation | null; title: string; date: string; time: string | null; at_ms: number }>;
  actions: Annotation[];
  markers: string[];
}

function planItem(item: EvalItem, index: number, annotations: readonly Annotation[], options: OracleOptions): ItemPlan {
  const random = mulberry32((options.seed ?? 1) * 7919 + index);
  const def = oracleTemplate(item);
  const segments = referenceSegments(item);
  const own = annotations.filter((a) => a.item === item.id);
  const events: ItemPlan["events"] = [];
  const actions: Annotation[] = [];
  for (const annotation of own) {
    if (annotation.kind !== "event" && annotation.kind !== "action_item") continue;
    const dropped = random() < (options.dropRate ?? 0);
    const wrong = random() < (options.wrongDateRate ?? 0);
    if (dropped) continue;
    if (annotation.kind === "action_item") {
      actions.push(annotation);
      continue;
    }
    events.push({
      annotation,
      title: annotation.text,
      date: wrong ? addDays(annotation.date!, 1) : annotation.date!,
      time: annotation.time,
      at_ms: annotation.start_ms,
    });
  }
  if (random() < (options.extraRate ?? 0)) {
    // Far from every annotation, so nothing can match it.
    const far = segments.find((s) => own.every((a) => Math.abs(a.start_ms - s.start_ms) > 2 * 60_000));
    const recorded = (item.reference.meta.recorded_at ?? EVAL_RECORDED_AT).slice(0, 10);
    if (far) events.push({ annotation: null, title: `추가 일정 ${index + 1}`, date: addDays(recorded, 3), time: null, at_ms: far.start_ms });
  }
  return { item, def, segments, events, actions, markers: segments.slice(0, 40).map((s) => s.text) };
}

function nearest(segments: ItemPlan["segments"], ms: number): ItemPlan["segments"][number] {
  let best = segments[0]!;
  for (const s of segments) if (Math.abs(s.start_ms - ms) < Math.abs(best.start_ms - ms)) best = s;
  return best;
}

const provenance = (token: string) => ({ sources: [token], pdf_pages: [] as number[] });

function block(type: string, text: string, token: string): Record<string, unknown> {
  switch (type) {
    case "paragraph":
      return { type, heading: null, text, ...provenance(token) };
    case "list":
      return { type, heading: null, style: "bullet", items: [{ text, ...provenance(token) }], ...provenance(token) };
    case "callout":
      return { type, heading: null, tone: "note", text, ...provenance(token) };
    case "quote":
      return { type, heading: null, text, speaker: null, ...provenance(token) };
    case "term":
      return { type, heading: null, term: text, definition: text, ...provenance(token) };
    default:
      return { type: "formula", heading: null, expression: "x", explanation: null, ...provenance(token) };
  }
}

const BLOCK_PREFERENCE = ["paragraph", "list", "callout", "quote", "term", "formula"];

function structureAnswer(plan: ItemPlan): unknown {
  const sections = plan.def.sections
    .filter((s) => s.fill === "structure" && s.required)
    .map((s) => {
      const type = BLOCK_PREFERENCE.find((t) => (s.block_types as string[]).includes(t))!;
      return { key: s.key, blocks: [block(type, `${plan.item.id}: ${s.title}`, "#0")] };
    });
  return templateOutputSchema(plan.def).parse({ sections });
}

function extractAnswer(plan: ItemPlan): unknown {
  const answer: Record<string, unknown[]> = {};
  for (const [field, enabled] of Object.entries(plan.def.extract)) {
    if (!enabled || field === "questions") continue;
    answer[field] = [];
  }
  if (answer.events) {
    answer.events = plan.events.map((e) => {
      const at = nearest(plan.segments, e.at_ms);
      return {
        title: e.title,
        kind: "other",
        raw_expression: dateExpression(e.date, e.time),
        model_resolution: { date: e.date, time: e.time, end_time: null, all_day: e.time === null },
        evidence: [`#${at.idx}`],
        quote: at.text,
        confidence: 0.9,
      };
    });
  }
  if (answer.action_items) {
    answer.action_items = plan.actions.map((a) => {
      const at = nearest(plan.segments, a.start_ms);
      return { text: a.text, owner_name: a.owner, due_raw: null, evidence: [`#${at.idx}`], quote: at.text };
    });
  }
  return extractSchemaFor(plan.def).parse(answer);
}

function contextText(req: LlmRequest<unknown>): string {
  return req.context.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

/** The item a request is about: its marker (map summaries), else the most reference lines found. */
function planFor(plans: readonly ItemPlan[], req: LlmRequest<unknown>): ItemPlan {
  const text = contextText(req);
  const marked = plans.find((p) => text.includes(`[eval:${p.item.id}]`));
  if (marked) return marked;
  let best: ItemPlan | null = null;
  let bestScore = 0;
  for (const plan of plans) {
    const score = plan.markers.filter((m) => text.includes(m)).length;
    if (score > bestScore) [best, bestScore] = [plan, score];
  }
  if (!best) throw new HarnessError("config", "oracle: the request matches no eval item");
  return best;
}

/** A ScriptedLlmProvider that answers the notes stages from `set`'s annotations. */
export function oracleNotesLlm(set: EvalSet, options: OracleOptions = {}): ScriptedLlmProvider {
  const plans = set.items.map((item, i) => planItem(item, i, set.annotations, options));
  return new ScriptedLlmProvider((req) => {
    const plan = planFor(plans, req);
    if (req.system === CLASSIFY_SYSTEM) {
      return {
        domain: itemDomain(plan.item),
        language: plan.item.language ?? "ko",
        title: plan.item.id,
        participants: [],
        folder_suggestion: { folder_id: null, new_name: null },
        tags: [],
        confidence: ORACLE_CONFIDENCE,
      };
    }
    if (req.instruction.startsWith("이 구간의 핵심 내용을")) {
      const token = /#\d+/.exec(contextText(req))?.[0] ?? "#0";
      return { points: [{ text: `[eval:${plan.item.id}] 구간 요약`, sources: [token] }] };
    }
    if (req.instruction.includes("이유(issues)")) return { fixes: [] };
    if (req.instruction.includes("추출 항목:")) return extractAnswer(plan);
    return structureAnswer(plan);
  });
}
