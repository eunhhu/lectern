// Eval set files (AI_HARNESS §8; format in packages/harness/eval/README.md):
//
//   <set>/items.csv         one row per recording: id, audio, reference, language, domain, consent, notes
//   <set>/ref/<id>.md       corrected reference transcript, "[M:SS] S1: text" lines
//   <set>/annotations.csv   events, action items, decisions, key concepts (scored from §11 step 6)
//   <set>/audio/...         recordings (real sets live outside the repository)
//
// Everything here is parsing and validation; errors name the file and line.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Interval } from "@lectern/media";
import { parseClock } from "../transcript/text.ts";

export class EvalSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalSetError";
  }
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180: commas, double-quoted fields with "" escapes, CRLF or LF)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (quoted) throw new EvalSetError("CSV: unterminated quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

/** Rows as records keyed by the header; `required` columns must exist. */
export function csvRecords(text: string, file: string, required: readonly string[]): Array<Record<string, string>> {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new EvalSetError(`${file}: empty`);
  const columns = header.map((h) => h.trim());
  for (const name of required) if (!columns.includes(name)) throw new EvalSetError(`${file}: missing column "${name}"`);
  return rows.map((row, i) => {
    if (row.length > columns.length) throw new EvalSetError(`${file}:${i + 2}: ${row.length} fields, header has ${columns.length}`);
    return Object.fromEntries(columns.map((c, k) => [c, (row[k] ?? "").trim()]));
  });
}

// ---------------------------------------------------------------------------
// Reference transcript (Markdown)
// ---------------------------------------------------------------------------

export interface ReferenceLine {
  start_ms: number;
  end_ms: number;
  speaker: string;
  text: string;
}

export interface ReferenceTranscript {
  meta: Record<string, string>;
  lines: ReferenceLine[];
  /** `reviewed:` front matter: only these original-time ranges are scored; null = everything. */
  reviewed: Interval[] | null;
  /** `duration:` front matter, when given (synthetic items need it). */
  duration_ms: number | null;
}

const LINE_RE = /^\[([0-9:.]+)(?:\s*[-~]\s*([0-9:.]+))?\]\s*(S\d+)\s*:\s*(.*)$/;

/** Reads "[M:SS] S1: text" (or "[M:SS-M:SS] S1: text") lines; "#" headings, ">" notes and blank lines are skipped. */
export function parseReferenceTranscript(markdown: string, file = "reference"): ReferenceTranscript {
  const meta: Record<string, string> = {};
  let body = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  let offset = 0;
  if (front) {
    for (const line of front[1]!.split("\n")) {
      const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
      if (m) meta[m[1]!] = m[2]!.trim();
    }
    offset = front[0].split("\n").length - 1;
    body = body.slice(front[0].length);
  }

  const raw: Array<{ start: number; end: number | null; speaker: string; text: string }> = [];
  body.split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(">")) return;
    const m = LINE_RE.exec(trimmed);
    const where = `${file}:${i + 1 + offset}`;
    if (!m) throw new EvalSetError(`${where}: expected "[M:SS] S1: text", got "${trimmed.slice(0, 40)}"`);
    const start = parseClock(m[1]!);
    const end = m[2] === undefined ? null : parseClock(m[2]);
    if (start === null || (m[2] !== undefined && end === null)) throw new EvalSetError(`${where}: unreadable time`);
    const previous = raw.at(-1);
    if (previous && start < previous.start) throw new EvalSetError(`${where}: time goes backwards`);
    raw.push({ start, end, speaker: m[3]!, text: m[4]!.trim() });
  });

  const duration = meta.duration ? parseClock(meta.duration) : null;
  if (meta.duration && duration === null) throw new EvalSetError(`${file}: unreadable duration "${meta.duration}"`);
  // A line without an end runs to the next line's start (the last one: 5 s, within the recording).
  const lines = raw.map((l, i) => {
    const next = raw[i + 1]?.start;
    const fallback = next ?? Math.min(l.start + 5_000, duration ?? Infinity);
    return { start_ms: l.start, end_ms: Math.max(l.start, l.end ?? fallback), speaker: l.speaker, text: l.text };
  });

  let reviewed: Interval[] | null = null;
  if (meta.reviewed) {
    reviewed = meta.reviewed.split(",").map((part) => {
      const [a, b] = part.split(/[-~]/).map((x) => parseClock(x ?? ""));
      if (a == null || b == null || b <= a) throw new EvalSetError(`${file}: bad reviewed range "${part.trim()}"`);
      return { start_ms: a, end_ms: b };
    });
  }
  return { meta, lines, reviewed, duration_ms: duration };
}

// ---------------------------------------------------------------------------
// Annotations (CSV)
// ---------------------------------------------------------------------------

export const ANNOTATION_KINDS = ["event", "action_item", "decision", "concept"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export interface Annotation {
  item: string;
  kind: AnnotationKind;
  /** Where it is said, original time. */
  start_ms: number;
  end_ms: number | null;
  text: string;
  /** Events: the correct date (YYYY-MM-DD), and time (HH:MM) when stated. */
  date: string | null;
  time: string | null;
  /** Action items: who owns it, as said. */
  owner: string | null;
}

export function parseAnnotations(text: string, file = "annotations.csv"): Annotation[] {
  return csvRecords(text, file, ["item", "kind", "start", "text"]).map((r, i) => {
    const where = `${file}:${i + 2}`;
    if (!(ANNOTATION_KINDS as readonly string[]).includes(r.kind!)) {
      throw new EvalSetError(`${where}: kind must be one of ${ANNOTATION_KINDS.join(", ")}`);
    }
    const start = parseClock(r.start!);
    const end = r.end ? parseClock(r.end) : null;
    if (start === null || (r.end && end === null)) throw new EvalSetError(`${where}: unreadable time`);
    if (r.date && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new EvalSetError(`${where}: date must be YYYY-MM-DD`);
    if (r.time && !/^\d{2}:\d{2}$/.test(r.time)) throw new EvalSetError(`${where}: time must be HH:MM`);
    if (r.kind === "event" && !r.date) throw new EvalSetError(`${where}: an event needs its correct date`);
    return {
      item: r.item!,
      kind: r.kind as AnnotationKind,
      start_ms: start,
      end_ms: end,
      text: r.text!,
      date: r.date || null,
      time: r.time || null,
      owner: r.owner || null,
    };
  });
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

export interface EvalItem {
  id: string;
  /** Absolute path, or "synth" (tones generated from the reference; example set only). */
  audio: string;
  reference: ReferenceTranscript;
  language: string | null;
  domain: string | null;
  notes: string;
}

export interface EvalSet {
  id: string;
  dir: string;
  items: EvalItem[];
  annotations: Annotation[];
}

/** The bundled synthetic set (no real recordings). */
export const EXAMPLE_SET_DIR = fileURLToPath(new URL("../../eval/example", import.meta.url));

const CONSENT = new Set(["yes", "synthetic"]);

export function loadEvalSet(dir: string): EvalSet {
  const itemsFile = join(dir, "items.csv");
  if (!existsSync(itemsFile)) throw new EvalSetError(`${itemsFile}: not found`);
  const records = csvRecords(readFileSync(itemsFile, "utf8"), "items.csv", ["id", "audio", "reference", "consent"]);
  if (records.length === 0) throw new EvalSetError(`${itemsFile}: no items`);
  const seen = new Set<string>();
  const items = records.map((r, i) => {
    const where = `items.csv:${i + 2}`;
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(r.id!)) throw new EvalSetError(`${where}: id must be lowercase letters, digits, - or _`);
    if (seen.has(r.id!)) throw new EvalSetError(`${where}: duplicate id ${r.id}`);
    seen.add(r.id!);
    // §8: recordings whose speakers did not all consent are excluded, not just flagged.
    if (!CONSENT.has(r.consent!)) throw new EvalSetError(`${where}: consent must be "yes" (every speaker agreed) or "synthetic"`);
    if (r.audio === "synth" && r.consent !== "synthetic") throw new EvalSetError(`${where}: synth audio is for synthetic items`);
    const refPath = isAbsolute(r.reference!) ? r.reference! : join(dir, r.reference!);
    if (!existsSync(refPath)) throw new EvalSetError(`${where}: reference ${r.reference} not found`);
    const reference = parseReferenceTranscript(readFileSync(refPath, "utf8"), r.reference);
    if (r.audio === "synth" && reference.duration_ms === null) throw new EvalSetError(`${r.reference}: synth items need "duration:"`);
    const audio = r.audio === "synth" ? "synth" : isAbsolute(r.audio!) ? r.audio! : join(dir, r.audio!);
    return { id: r.id!, audio, reference, language: r.language || null, domain: r.domain || null, notes: r.notes ?? "" };
  });
  const annotationsFile = join(dir, "annotations.csv");
  const annotations = existsSync(annotationsFile) ? parseAnnotations(readFileSync(annotationsFile, "utf8")) : [];
  for (const a of annotations) if (!seen.has(a.item)) throw new EvalSetError(`annotations.csv: unknown item ${a.item}`);
  return { id: dir.split("/").filter(Boolean).at(-1)!, dir, items, annotations };
}
