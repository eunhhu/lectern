// The verify stage (CONTRACTS §1.8, AI_HARNESS §3.9): code checks what structure and
// extract produced, in this order: ① schema, ② source refs, ⑥ one repair call for what
// failed ①②, ③ quote match, ④ dates through the Korean parser, ⑤ plausibility and
// duplicates. Then it assembles the stored document body (block ids, gap blocks).
// PDF page labels (`pdf_pages`) become `pdf_page` sources when the label was in the PDF
// context; any other number is removed (P3-04, D-P3-4).

import {
  DocumentBody,
  ExtractedActionItem,
  ExtractedDecision,
  ExtractedEvent,
  ExtractedGlossaryEntry,
  TemplateBlock,
  type DocumentBlock,
  type DocumentSection,
  type ExtractResult,
  type GapKind,
  type SourceRef,
  type TemplateOutput,
} from "@lectern/domain";
import { z } from "zod";
import { HarnessError } from "../errors.ts";
import { canonicalJson, sha256Hex } from "../hash.ts";
import type { LlmProvider } from "../providers.ts";
import type { Routing } from "../routing.ts";
import type { PdfLabel } from "../pdf/context.ts";
import { defineStage, type StageDefinition } from "../stage.ts";
import type { LoadedTemplate } from "../templates.ts";
import { normalizeForMatch } from "../transcript/text.ts";
import { expandSourceTokens } from "./compact.ts";
import { resolveKoreanDate } from "./korean-date.ts";
import { NOTES_SYSTEM, notesContext } from "./prompt.ts";
import { VerifiedActionItem, VerifiedEvent, VerifyReport } from "./schemas.ts";

export interface VerifySegment {
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker: string | null;
  text: string;
}

export interface VerifyInput {
  template: LoadedTemplate;
  structure: TemplateOutput;
  extract: Partial<ExtractResult>;
  transcript: { segments: VerifySegment[]; gaps: { kind: GapKind; start_ms: number; end_ms: number }[] };
  recordedAtMs: number;
  recordedAtSource: "client" | "media" | "upload";
  tz: string;
  language: string;
  /** Labels of the PDF context structure saw (P3-04). Without them every `pdf_pages` number is removed. */
  pdfLabels?: PdfLabel[];
}

export const VerifyOutput = z.object({
  body: DocumentBody,
  events: z.array(VerifiedEvent),
  action_items: z.array(VerifiedActionItem),
  report: VerifyReport,
  partial: z.boolean(),
});
export type VerifyOutput = z.infer<typeof VerifyOutput>;

export interface RepairTarget {
  ref: string;
  kind: "block" | "event" | "action_item";
  item: unknown;
  issues: string[];
}

export interface RepairFix {
  ref: string;
  block: TemplateBlock | null;
  event: ExtractedEvent | null;
  action_item: ExtractedActionItem | null;
}

export type RepairFn = (targets: RepairTarget[]) => Promise<RepairFix[]>;

/** Quote match below this ratio flags the item `low_confidence`. */
export const QUOTE_MATCH_MIN = 0.8;
/** Items dated further than this past the recording are dropped. */
export const MAX_FUTURE_DAYS = 365;

type ReportItem = VerifyReport["items"][number];
type BlockWithoutId = DocumentBlock extends infer B ? (B extends { id: string } ? Omit<B, "id" | "edited"> : never) : never;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Longest common subsequence of the normalized texts, divided by the quote's length. */
export function lcsRatio(quote: string, text: string): number {
  const a = normalizeForMatch(quote).chars;
  const b = normalizeForMatch(text).chars;
  if (a.length === 0) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[b.length]! / a.length;
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const floored = Math.floor(utcMs / 60_000) * 60_000;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(floored));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return local - floored;
}

/** A local date (and time) in `tz` as epoch ms; midnight when there is no time. */
export function zonedTimeToMs(date: string, time: string | null, tz: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time ? (time.split(":").map(Number) as [number, number]) : [0, 0];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

function localDate(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function dayDiff(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

function validLocalDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}

function zodIssues(error: z.ZodError): string {
  return error.message.slice(0, 200);
}

function mergeRefs(lists: SourceRef[][]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const list of lists) {
    for (const ref of list) {
      const key = canonicalJson(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// ①② for blocks, events and action items
// ---------------------------------------------------------------------------

type Checked<T> = { ok: true; value: T; reasons: string[] } | { ok: false; issues: string[]; reasons: string[] };

/** PDF context labels by number. */
type LabelMap = ReadonlyMap<number, PdfLabel>;

function checkBlock(raw: unknown, known: ReadonlySet<number>, labels: LabelMap): Checked<BlockWithoutId> {
  const parsed = TemplateBlock.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: [`schema: ${zodIssues(parsed.error)}`], reasons: ["schema"] };
  const block = parsed.data;
  const reasons: string[] = [];
  const expand = (tokens: readonly string[]) => {
    const { refs, dropped } = expandSourceTokens(tokens, known);
    for (const token of dropped) reasons.push(`dropped_ref:${token}`);
    return refs;
  };
  // Transcript refs first: the rendered anchor of a block is its first source.
  const pdfRefs = (pages: readonly number[]): SourceRef[] => {
    const refs: SourceRef[] = [];
    for (const n of pages) {
      const label = labels.get(n);
      if (label) refs.push({ kind: "pdf_page", asset_id: label.asset_id, page: label.page_no } as SourceRef);
      else if (!reasons.includes("pdf_page_out_of_set")) reasons.push("pdf_page_out_of_set");
    }
    return refs;
  };
  const own = mergeRefs([expand(block.sources), pdfRefs(block.pdf_pages)]);
  const { pdf_pages: _pages, sources: _sources, ...rest } = block;
  if (block.type === "list") {
    const items: Array<{ text: string; sources: SourceRef[] }> = [];
    for (const item of block.items) {
      const refs = mergeRefs([expand(item.sources), pdfRefs(item.pdf_pages)]);
      if (refs.length === 0) {
        reasons.push("item_dropped_no_source");
        continue;
      }
      items.push({ text: item.text, sources: refs });
    }
    const sources = mergeRefs([own, ...items.map((i) => i.sources)]);
    if (items.length === 0 || sources.length === 0) {
      return { ok: false, issues: ["no_source: every item lost its sources"], reasons };
    }
    return { ok: true, value: { ...(rest as object), items, sources } as BlockWithoutId, reasons };
  }
  if (own.length === 0) return { ok: false, issues: ["no_source: the block cites no existing segment"], reasons };
  return { ok: true, value: { ...(rest as object), sources: own } as BlockWithoutId, reasons };
}

type EventDraft = { item: ExtractedEvent; refs: SourceRef[] };
type ActionDraft = { item: ExtractedActionItem; refs: SourceRef[] };

function checkEvidence<T extends { evidence: string[] }>(
  schema: z.ZodType<T>,
  raw: unknown,
  known: ReadonlySet<number>
): Checked<{ item: T; refs: SourceRef[] }> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: [`schema: ${zodIssues(parsed.error)}`], reasons: ["schema"] };
  const { refs, dropped } = expandSourceTokens(parsed.data.evidence, known);
  const reasons = dropped.map((token) => `dropped_ref:${token}`);
  if (refs.length === 0) return { ok: false, issues: ["no_source: the evidence cites no existing segment"], reasons };
  return { ok: true, value: { item: parsed.data, refs }, reasons };
}

// ---------------------------------------------------------------------------
// verifyDocument
// ---------------------------------------------------------------------------

export async function verifyDocument(input: VerifyInput, repair: RepairFn | null): Promise<VerifyOutput> {
  const segments = [...input.transcript.segments].sort((a, b) => a.idx - b.idx);
  const known = new Set(segments.map((s) => s.idx));
  const byIdx = new Map(segments.map((s) => [s.idx, s] as const));
  const position = new Map(segments.map((s, i) => [s.idx, i] as const));
  const labels: LabelMap = new Map((input.pdfLabels ?? []).map((l) => [l.label, l] as const));
  const report: ReportItem[] = [];
  let droppedBlocks = 0;
  let repaired = false;

  // ① ② ------------------------------------------------------------------
  const blocks = new Map<string, { section: string; checked: Checked<BlockWithoutId>; raw: unknown }>();
  const blockOrder: string[] = [];
  for (const section of input.structure.sections) {
    section.blocks.forEach((raw, i) => {
      const ref = `${section.key}#${i + 1}`;
      blocks.set(ref, { section: section.key, checked: checkBlock(raw, known, labels), raw });
      blockOrder.push(ref);
    });
  }
  const events = (input.extract.events ?? []).map((raw, i) => ({
    ref: `event:${i}`,
    raw: raw as unknown,
    checked: checkEvidence(ExtractedEvent, raw, known) as Checked<EventDraft>,
  }));
  const actions = (input.extract.action_items ?? []).map((raw, i) => ({
    ref: `action_item:${i}`,
    raw: raw as unknown,
    checked: checkEvidence(ExtractedActionItem, raw, known) as Checked<ActionDraft>,
  }));

  // ⑥ one repair call for everything that failed ① or ② ---------------------------
  const targets: RepairTarget[] = [];
  for (const ref of blockOrder) {
    const b = blocks.get(ref)!;
    if (!b.checked.ok) targets.push({ ref, kind: "block", item: b.raw, issues: b.checked.issues });
  }
  for (const e of events) if (!e.checked.ok) targets.push({ ref: e.ref, kind: "event", item: e.raw, issues: e.checked.issues });
  for (const a of actions) {
    if (!a.checked.ok) targets.push({ ref: a.ref, kind: "action_item", item: a.raw, issues: a.checked.issues });
  }
  const fixed = new Set<string>();
  if (targets.length > 0 && repair) {
    repaired = true;
    const fixes = await repair(targets);
    const byRef = new Map(fixes.map((fix) => [fix.ref, fix] as const));
    for (const target of targets) {
      const fix = byRef.get(target.ref);
      if (!fix) continue;
      if (target.kind === "block" && fix.block) {
        const b = blocks.get(target.ref)!;
        const again = checkBlock(fix.block, known, labels);
        b.checked = again.ok
          ? { ...again, reasons: [...b.checked.reasons, "repaired", ...again.reasons] }
          : { ...again, reasons: [...b.checked.reasons, "repair_failed", ...again.reasons] };
        if (again.ok) fixed.add(target.ref);
      } else if (target.kind === "event" && fix.event) {
        const e = events.find((x) => x.ref === target.ref)!;
        const again = checkEvidence(ExtractedEvent, fix.event, known) as Checked<EventDraft>;
        e.checked = { ...again, reasons: [...e.checked.reasons, again.ok ? "repaired" : "repair_failed", ...again.reasons] };
        if (again.ok) fixed.add(target.ref);
      } else if (target.kind === "action_item" && fix.action_item) {
        const a = actions.find((x) => x.ref === target.ref)!;
        const again = checkEvidence(ExtractedActionItem, fix.action_item, known) as Checked<ActionDraft>;
        a.checked = { ...again, reasons: [...a.checked.reasons, again.ok ? "repaired" : "repair_failed", ...again.reasons] };
        if (again.ok) fixed.add(target.ref);
      }
    }
  }

  const outcomeOf = (ref: string, reasons: string[]): "ok" | "fixed" =>
    fixed.has(ref) || reasons.length > 0 ? "fixed" : "ok";

  // Blocks: final outcome.
  const keptBlocks = new Map<string, BlockWithoutId[]>();
  for (const ref of blockOrder) {
    const b = blocks.get(ref)!;
    if (b.checked.ok) {
      const list = keptBlocks.get(b.section) ?? [];
      list.push(b.checked.value);
      keptBlocks.set(b.section, list);
      report.push({ kind: "block", ref, outcome: outcomeOf(ref, b.checked.reasons), reasons: b.checked.reasons });
    } else {
      droppedBlocks += 1;
      const reasons = [...b.checked.reasons, ...b.checked.issues.map((i) => i.split(":")[0]!)];
      report.push({ kind: "block", ref, outcome: "dropped", reasons: [...new Set(reasons)] });
    }
  }

  const baseDate = localDate(input.recordedAtMs, input.tz);

  // ③ quote match text: the evidence segments plus one neighbour on each side.
  const quoteText = (refs: SourceRef[]): string => {
    const ids = new Set<number>();
    for (const ref of refs) {
      if (ref.kind !== "transcript") continue;
      for (let id = ref.start_idx; id <= ref.end_idx; id++) if (known.has(id)) ids.add(id);
    }
    const positions = [...ids].map((id) => position.get(id)!).sort((a, b) => a - b);
    if (positions.length === 0) return "";
    const from = Math.max(0, positions[0]! - 1);
    const to = Math.min(segments.length - 1, positions.at(-1)! + 1);
    const chosen = new Set(positions);
    chosen.add(from);
    chosen.add(to);
    return [...chosen]
      .sort((a, b) => a - b)
      .map((p) => segments[p]!.text)
      .join(" ");
  };

  // Events ③ ④ ⑤
  const verifiedEvents: VerifiedEvent[] = [];
  const eventDates: string[] = [];
  const eventKeys = new Set<string>();
  for (const e of events) {
    if (!e.checked.ok) {
      report.push({ kind: "event", ref: e.ref, outcome: "dropped", reasons: [...e.checked.reasons, "no_valid_repair"] });
      continue;
    }
    const { item, refs } = e.checked.value;
    const reasons = [...e.checked.reasons];
    const flags: string[] = [];
    let confidence = item.confidence;
    const addFlag = (flag: string) => {
      if (!flags.includes(flag)) flags.push(flag);
    };

    if (item.quote !== null && lcsRatio(item.quote, quoteText(refs)) < QUOTE_MATCH_MIN) {
      addFlag("low_confidence");
      confidence = Math.min(confidence, 0.3);
      reasons.push("quote_mismatch");
    }

    const parsed = resolveKoreanDate(item.raw_expression, { recordedAtMs: input.recordedAtMs, tz: input.tz });
    let date: string;
    let time: string | null;
    let endTime: string | null;
    let resolution: VerifiedEvent["resolution"];
    if (parsed) {
      date = parsed.date;
      time = parsed.time;
      endTime = parsed.end_time;
      resolution = { method: "parser", rule: parsed.rule };
      const model = item.model_resolution;
      if (model.date !== parsed.date || (parsed.time !== null && model.time !== parsed.time)) {
        addFlag("date_mismatch");
        confidence = Math.min(confidence, 0.6);
        reasons.push("date_mismatch");
      }
      if (parsed.flags?.includes("weekday_mismatch")) addFlag("weekday_mismatch");
      if (input.recordedAtSource === "upload") {
        addFlag("recorded_at_estimated");
        confidence = Math.min(confidence, 0.6);
      }
    } else {
      date = item.model_resolution.date;
      time = item.model_resolution.time;
      endTime = item.model_resolution.end_time;
      resolution = { method: "model", rule: null };
      addFlag("needs_review");
    }
    if (!validLocalDate(date)) {
      report.push({ kind: "event", ref: e.ref, outcome: "dropped", reasons: [...reasons, "invalid_date"] });
      continue;
    }

    const allDay = time === null;
    const startAt = zonedTimeToMs(date, time, input.tz);
    const endAt = allDay ? zonedTimeToMs(nextDay(date), null, input.tz) : endTime ? zonedTimeToMs(date, endTime, input.tz) : null;

    if (endAt !== null && endAt < startAt) {
      report.push({ kind: "event", ref: e.ref, outcome: "dropped", reasons: [...reasons, "end_before_start"] });
      continue;
    }
    if (dayDiff(date, baseDate) > MAX_FUTURE_DAYS) {
      report.push({ kind: "event", ref: e.ref, outcome: "dropped", reasons: [...reasons, "too_far_future"] });
      continue;
    }
    const key = `${normalizeForMatch(item.title).chars.join("")}|${date}`;
    if (eventKeys.has(key)) {
      report.push({ kind: "event", ref: e.ref, outcome: "dropped", reasons: [...reasons, "duplicate"] });
      continue;
    }
    eventKeys.add(key);
    if (item.kind === "deadline" && date < baseDate) {
      addFlag("needs_review");
      reasons.push("past_deadline");
    }

    verifiedEvents.push({
      title: item.title,
      kind: item.kind,
      start_at: startAt,
      end_at: endAt,
      all_day: allDay,
      tz: input.tz,
      raw_expression: item.raw_expression,
      resolution,
      confidence,
      evidence: { sources: refs, quote: item.quote },
      flags,
    });
    eventDates.push(time ? `${date} ${time}` : date);
    report.push({ kind: "event", ref: e.ref, outcome: outcomeOf(e.ref, reasons), reasons });
  }

  // Action items ③ ④ ⑤
  const verifiedActions: VerifiedActionItem[] = [];
  const actionDue: Array<string | null> = [];
  const actionKeys = new Set<string>();
  for (const a of actions) {
    if (!a.checked.ok) {
      report.push({ kind: "action_item", ref: a.ref, outcome: "dropped", reasons: [...a.checked.reasons, "no_valid_repair"] });
      continue;
    }
    const { item, refs } = a.checked.value;
    const reasons = [...a.checked.reasons];
    const flags: string[] = [];
    const addFlag = (flag: string) => {
      if (!flags.includes(flag)) flags.push(flag);
    };
    if (item.quote !== null && lcsRatio(item.quote, quoteText(refs)) < QUOTE_MATCH_MIN) {
      addFlag("low_confidence");
      reasons.push("quote_mismatch");
    }
    let dueAt: number | null = null;
    let dueDate: string | null = null;
    if (item.due_raw !== null) {
      const parsed = resolveKoreanDate(item.due_raw, { recordedAtMs: input.recordedAtMs, tz: input.tz });
      if (parsed) {
        dueDate = parsed.date;
        dueAt = zonedTimeToMs(parsed.date, parsed.time ?? "23:59", input.tz);
        if (parsed.flags?.includes("weekday_mismatch")) addFlag("weekday_mismatch");
        if (input.recordedAtSource === "upload") addFlag("recorded_at_estimated");
      } else {
        addFlag("needs_review");
      }
    }
    if (dueDate !== null && dayDiff(dueDate, baseDate) > MAX_FUTURE_DAYS) {
      report.push({ kind: "action_item", ref: a.ref, outcome: "dropped", reasons: [...reasons, "too_far_future"] });
      continue;
    }
    const key = `${normalizeForMatch(item.text).chars.join("")}|${dueDate ?? ""}`;
    if (actionKeys.has(key)) {
      report.push({ kind: "action_item", ref: a.ref, outcome: "dropped", reasons: [...reasons, "duplicate"] });
      continue;
    }
    actionKeys.add(key);
    if (dueDate !== null && dueDate < baseDate) {
      addFlag("needs_review");
      reasons.push("past_due");
    }
    verifiedActions.push({
      text: item.text,
      owner_name: item.owner_name,
      due_at: dueAt,
      due_raw: item.due_raw,
      evidence: { sources: refs, quote: item.quote },
      flags,
    });
    actionDue.push(dueDate);
    report.push({ kind: "action_item", ref: a.ref, outcome: outcomeOf(a.ref, reasons), reasons });
  }

  // Decisions and glossary: no repair; no source means dropped.
  const decisions: Array<{ text: string; sources: SourceRef[] }> = [];
  (input.extract.decisions ?? []).forEach((raw, i) => {
    const ref = `decision:${i}`;
    const checked = checkEvidence(ExtractedDecision, raw, known);
    if (!checked.ok) {
      report.push({ kind: "decision", ref, outcome: "dropped", reasons: [...checked.reasons, "no_source"] });
      return;
    }
    decisions.push({ text: checked.value.item.text, sources: checked.value.refs });
    report.push({ kind: "decision", ref, outcome: checked.reasons.length ? "fixed" : "ok", reasons: checked.reasons });
  });
  const glossary: Array<{ text: string; sources: SourceRef[] }> = [];
  (input.extract.glossary ?? []).forEach((raw, i) => {
    const ref = `glossary:${i}`;
    const checked = checkEvidence(ExtractedGlossaryEntry, raw, known);
    if (!checked.ok) {
      report.push({ kind: "glossary", ref, outcome: "dropped", reasons: [...checked.reasons, "no_source"] });
      return;
    }
    const { term, definition } = checked.value.item;
    glossary.push({ text: `${term}: ${definition}`, sources: checked.value.refs });
    report.push({ kind: "glossary", ref, outcome: checked.reasons.length ? "fixed" : "ok", reasons: checked.reasons });
  });

  // Assembly ------------------------------------------------------------------
  const listBlock = (items: Array<{ text: string; sources: SourceRef[] }>): BlockWithoutId =>
    ({
      type: "list",
      heading: null,
      style: "bullet",
      items,
      sources: mergeRefs(items.map((i) => i.sources)),
    }) as BlockWithoutId;

  const eventItems = verifiedEvents.map((ev, i) => ({ text: `${ev.title} (${eventDates[i]})`, sources: ev.evidence.sources }));
  const actionItems = verifiedActions.map((item, i) => ({
    text: `${item.text}${item.owner_name ? ` — 담당: ${item.owner_name}` : ""}${actionDue[i] ? ` (기한: ${actionDue[i]})` : ""}`,
    sources: item.evidence.sources,
  }));
  const fromExtract: Record<string, Array<{ text: string; sources: SourceRef[] }>> = {
    events: eventItems,
    action_items: actionItems,
    decisions,
    glossary,
  };

  const def = input.template.def;
  let partial = false;
  const sections: Array<{ key: string; title: string; blocks: Array<BlockWithoutId | GapDraft> }> = [];
  for (const section of def.sections) {
    let sectionBlocks: BlockWithoutId[];
    if (section.fill === "structure") {
      sectionBlocks = keptBlocks.get(section.key) ?? [];
    } else {
      const items = fromExtract[section.fill] ?? [];
      sectionBlocks = items.length ? [listBlock(items)] : [];
    }
    if (sectionBlocks.length === 0) {
      if (!section.required) continue;
      partial = true;
    }
    sections.push({ key: section.key, title: section.title, blocks: [...sectionBlocks] });
  }

  // Gap blocks go to `topics`, else the template's first structure section.
  const gaps = [...input.transcript.gaps].sort((a, b) => a.start_ms - b.start_ms);
  if (gaps.length > 0) {
    const targetDef =
      def.sections.find((s) => s.key === "topics") ?? def.sections.find((s) => s.fill === "structure") ?? def.sections[0];
    if (targetDef) {
      let target = sections.find((s) => s.key === targetDef.key);
      if (!target) {
        target = { key: targetDef.key, title: targetDef.title, blocks: [] };
        const order = def.sections.map((s) => s.key);
        const at = sections.findIndex((s) => order.indexOf(s.key) > order.indexOf(targetDef.key));
        sections.splice(at === -1 ? sections.length : at, 0, target);
      }
      const timeKey = (block: BlockWithoutId | GapDraft): number | null => {
        if (block.type === "gap") return null;
        let first: number | null = null;
        for (const ref of block.sources) {
          if (ref.kind !== "transcript") continue;
          if (first === null || ref.start_idx < first) first = ref.start_idx;
        }
        if (first === null) return null;
        return byIdx.get(first)?.start_ms ?? null;
      };
      for (const gap of gaps) {
        const draft: GapDraft = { type: "gap", heading: null, kind: gap.kind, start_ms: gap.start_ms, end_ms: gap.end_ms, sources: [] };
        const at = target.blocks.findIndex((block) => {
          const key = timeKey(block);
          return key !== null && key > gap.start_ms;
        });
        target.blocks.splice(at === -1 ? target.blocks.length : at, 0, draft);
      }
    }
  }

  let nextId = 1;
  const body: DocumentBody = {
    sections: sections.map(
      (section): DocumentSection => ({
        key: section.key,
        title: section.title,
        blocks: section.blocks.map((block) => ({ id: `b${nextId++}`, ...block }) as DocumentBlock),
      })
    ),
  };

  return VerifyOutput.parse({
    body,
    events: verifiedEvents,
    action_items: verifiedActions,
    report: { repaired, dropped_blocks: droppedBlocks, items: report },
    partial,
  });
}

type GapDraft = {
  type: "gap";
  heading: null;
  kind: GapKind;
  start_ms: number;
  end_ms: number;
  sources: SourceRef[];
};

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

const REPAIR_INSTRUCTION =
  "아래 조각은 검증을 통과하지 못했다. 이유(issues)를 고쳐 같은 ref로 돌려준다. 출처는 전사의 #번호만 쓴다. 고칠 수 없으면 그 ref를 빼라.";

export const RepairFixes = z.object({
  fixes: z.array(
    z.object({
      ref: z.string(),
      block: TemplateBlock.nullable(),
      event: ExtractedEvent.nullable(),
      action_item: ExtractedActionItem.nullable(),
    })
  ),
});

export function verifyStage(llm: LlmProvider, routing: Routing): StageDefinition<VerifyInput, VerifyOutput> {
  const route = routing.repair;
  return defineStage({
    name: "verify",
    version: 1,
    output: VerifyOutput,
    memo: "shared",
    retry: { maxAttempts: 3, repairs: 0 },
    key: (input) => {
      const def = input.template.def;
      return {
        inputs: [
          sha256Hex(canonicalJson(input.structure)),
          sha256Hex(canonicalJson(input.extract)),
          sha256Hex(canonicalJson(input.transcript)),
          ...(input.pdfLabels?.length ? [sha256Hex(canonicalJson(input.pdfLabels))] : []),
        ],
        prompt: sha256Hex(`${NOTES_SYSTEM}\u0000${REPAIR_INSTRUCTION}`),
        template: `${def.id}@${def.version}:${input.template.hash}`,
        provider: llm.id,
        model: route.model,
        params: {
          maxOutputTokens: route.maxOutputTokens,
          recordedAtMs: input.recordedAtMs,
          recordedAtSource: input.recordedAtSource,
          tz: input.tz,
          language: input.language,
          lcs: QUOTE_MATCH_MIN,
          minFuture: MAX_FUTURE_DAYS,
        },
      };
    },
    async run(input, ctx) {
      const repairFn: RepairFn = async (targets) => {
        try {
          const result = await ctx.meter({ provider: llm.id, model: route.model }, () =>
            llm.generate({
              schema: RepairFixes,
              system: NOTES_SYSTEM,
              context: notesContext(input.transcript.segments),
              instruction: `${REPAIR_INSTRUCTION}\n${JSON.stringify(targets)}`,
              model: route.model,
              maxOutputTokens: route.maxOutputTokens,
              signal: ctx.signal,
            })
          );
          return result.value.fixes as RepairFix[];
        } catch (err) {
          if (err instanceof HarnessError && err.kind === "output_validation") return [];
          throw err;
        }
      };
      return verifyDocument(input, repairFn);
    },
  });
}
