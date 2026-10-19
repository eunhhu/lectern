// Pairs the audio files and PDFs of one drop into upload groups (one group = one new
// recording = one upload session, packages/domain CreateUploadRequest). Pure: it only
// looks at file names, sizes, types and modification times, so it is unit-tested
// without a browser.
//
// Rules, strongest first:
// 1. A date in both names ("20261019", "2026-10-19", "10월 19일") must agree.
// 2. Numbers in both names ("7주차", "lecture07") must share at least one value.
// 3. Shared words (minus filler like "녹음", "slides", "강의자료") raise the score.
// 4. Close modification times add a little (within 3 hours), and alone are enough
//    within about 15 minutes, as long as no other recording is about as close.
// 5. If the drop has a single recording, every PDF belongs to it.
// Audio files that differ only by an explicit part marker ("1부"/"2부", "part1") become
// one recording with several audio parts.

import { DEFAULT_TIME_ZONE, zonedTimeToUtc } from "./format.ts";

export type PairFileKind = "audio" | "pdf";

export interface FileLike {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

const AUDIO_EXTENSIONS = new Set(["m4a", "mp3", "wav", "aac", "ogg", "oga", "opus", "weba", "flac", "caf", "amr"]);

export function extensionOf(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1]!.toLowerCase() : "";
}

export function classifyFile(file: Pick<FileLike, "name" | "type">): PairFileKind | null {
  const ext = extensionOf(file.name);
  if (ext === "pdf" || file.type === "application/pdf") return "pdf";
  if (AUDIO_EXTENSIONS.has(ext) || (file.type.startsWith("audio/") && ext !== "")) return "audio";
  return null;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface ParsedName {
  /** File name without its extension, NFC-normalised (macOS hands out NFD). */
  base: string;
  words: string[];
  numbers: string[];
  /** "MM-DD" when the name contains a date. */
  dayKey: string | null;
  /** Wall-clock start when the name has a full date and time ("20261019_143005"). */
  local: LocalDateTime | null;
  /** Explicit part number ("1부", "part2") and the readable name without it. */
  part: number | null;
  partStem: string;
  /** Readable title with dates and separators removed; "" when only filler remains. */
  title: string;
}

const FILLER_WORDS = new Set([
  "녹음", "음성", "녹취", "파일", "새로운", "새", "recording", "record", "rec", "audio", "voice", "memo", "new",
  "자료", "강의자료", "수업자료", "슬라이드", "slides", "slide", "handout", "notes", "note", "필기", "교안",
  "ppt", "pdf", "final", "최종", "copy", "사본",
]);

const FULL_DATE_RE =
  /(?<!\d)(20\d{2})[-_.\s]?(0[1-9]|1[0-2])[-_.\s]?(0[1-9]|[12]\d|3[01])(?:[\sT_-]*([01]\d|2[0-3])[:._-]?([0-5]\d)(?:[:._-]?[0-5]\d)?)?(?!\d)/;
const KOREAN_DATE_RE = /(\d{1,2})월\s*(\d{1,2})일/;
const PART_RE = /(?:(?:part|pt|파트)[\s_-]*(\d{1,2})|(?<!\d)(\d{1,2})[\s_-]*부)(?![\p{L}\p{N}])/iu;

export function parseFileName(name: string): ParsedName {
  const base = name.normalize("NFC").replace(/\.[^./\\]+$/, "");
  let rest = base;
  let dayKey: string | null = null;
  let local: LocalDateTime | null = null;

  const full = FULL_DATE_RE.exec(rest);
  if (full) {
    const [, y, mo, d, h, mi] = full;
    dayKey = `${mo}-${d}`;
    if (h !== undefined && mi !== undefined) {
      local = { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi) };
    }
    rest = rest.replace(full[0], " ");
  } else {
    const ko = KOREAN_DATE_RE.exec(rest);
    if (ko) {
      dayKey = `${ko[1]!.padStart(2, "0")}-${ko[2]!.padStart(2, "0")}`;
      rest = rest.replace(ko[0], " ");
    }
  }

  let part: number | null = null;
  let partless = rest;
  const partMatch = PART_RE.exec(rest);
  if (partMatch) {
    part = Number(partMatch[1] ?? partMatch[2]);
    partless = rest.replace(partMatch[0], " ");
  }

  const tidy = (s: string) => s.replace(/[_]+/g, " ").replace(/\s+/g, " ").replace(/^[\s\-–—.,]+|[\s\-–—.,]+$/g, "");
  const tokens = partless
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((t) => t.split(/(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u))
    .filter(Boolean);
  const numbers = [...new Set(tokens.filter((t) => /^\p{N}+$/u.test(t)).map((t) => String(Number(t))))];
  const words = [...new Set(tokens.filter((t) => !/^\p{N}+$/u.test(t) && !FILLER_WORDS.has(t)))];
  const partStem = tidy(partless);
  return { base, words, numbers, dayKey, local, part, partStem, title: words.length ? tidy(rest) : "" };
}

export type PairReason = "name" | "number" | "date" | "time" | "only_recording";

export interface PairedPdf<F> {
  file: F;
  reasons: PairReason[];
}

export interface UploadGroup<F> {
  /** Stable within one pairing result. */
  id: string;
  /** Audio parts in playback order (`asset.part_index`). */
  audio: F[];
  pdfs: PairedPdf<F>[];
  /** Suggested title from the file name, or null to let the server classify it. */
  title: string | null;
  /** ISO UTC start time when the audio file name carries one, else null. */
  recordedAt: string | null;
}

export interface PairingResult<F> {
  groups: UploadGroup<F>[];
  /** PDFs that matched no recording; the user assigns them or leaves them out. */
  unmatched: F[];
  rejected: { file: F; reason: "unsupported" | "empty" }[];
}

export const PAIR_THRESHOLD = 0.45;
const TIME_WINDOW_MS = 3 * 3_600_000;
/** A time-only match must beat every other recording by this much (≈20 minutes). */
const TIME_MARGIN = 0.05;

interface Candidate {
  score: number;
  reasons: PairReason[];
  timeGap: number;
}

function scorePair(audio: { parsed: ParsedName; file: FileLike }, pdf: { parsed: ParsedName; file: FileLike }): Candidate {
  const a = audio.parsed;
  const p = pdf.parsed;
  const reasons: PairReason[] = [];
  const timeGap = Math.abs(audio.file.lastModified - pdf.file.lastModified);
  if (a.dayKey && p.dayKey && a.dayKey !== p.dayKey) return { score: 0, reasons, timeGap };
  if (a.numbers.length && p.numbers.length && !a.numbers.some((n) => p.numbers.includes(n))) {
    return { score: 0, reasons, timeGap };
  }
  let score = 0;
  const union = new Set([...a.words, ...p.words]);
  const shared = a.words.filter((w) => p.words.includes(w)).length;
  if (union.size && shared) {
    score += shared / union.size;
    reasons.push("name");
  }
  if (a.numbers.length && p.numbers.length) {
    score += 0.3;
    reasons.push("number");
  }
  if (a.dayKey && a.dayKey === p.dayKey) {
    score += 0.5;
    reasons.push("date");
  }
  if (timeGap <= TIME_WINDOW_MS) {
    score += 0.5 * (1 - timeGap / TIME_WINDOW_MS);
    reasons.push("time");
  }
  return { score, reasons, timeGap };
}

export function pairFiles<F extends FileLike>(files: readonly F[], timeZone = DEFAULT_TIME_ZONE): PairingResult<F> {
  const rejected: PairingResult<F>["rejected"] = [];
  const audios: { file: F; parsed: ParsedName }[] = [];
  const pdfs: { file: F; parsed: ParsedName }[] = [];
  for (const file of files) {
    const kind = classifyFile(file);
    if (!kind) rejected.push({ file, reason: "unsupported" });
    else if (file.size <= 0) rejected.push({ file, reason: "empty" });
    else (kind === "audio" ? audios : pdfs).push({ file, parsed: parseFileName(file.name) });
  }

  // Multi-part recordings: same name apart from distinct explicit part numbers.
  const byStem = new Map<string, typeof audios>();
  for (const a of audios) {
    if (a.parsed.part === null) continue;
    const key = `${a.parsed.partStem}\u0000${a.parsed.dayKey ?? ""}`;
    byStem.set(key, [...(byStem.get(key) ?? []), a]);
  }
  const grouped = new Set<(typeof audios)[number]>();
  const audioGroups: (typeof audios)[] = [];
  for (const a of audios) {
    if (grouped.has(a)) continue;
    const siblings = a.parsed.part === null ? [] : byStem.get(`${a.parsed.partStem}\u0000${a.parsed.dayKey ?? ""}`)!;
    const distinctParts = new Set(siblings.map((s) => s.parsed.part)).size === siblings.length;
    if (siblings.length >= 2 && distinctParts) {
      const parts = [...siblings].sort((x, y) => x.parsed.part! - y.parsed.part!);
      parts.forEach((s) => grouped.add(s));
      audioGroups.push(parts);
    } else {
      grouped.add(a);
      audioGroups.push([a]);
    }
  }

  const groups: UploadGroup<F>[] = audioGroups.map((parts, i) => {
    const lead = parts[0]!;
    const multi = parts.length > 1;
    const title = multi ? (lead.parsed.words.length ? lead.parsed.partStem : "") : lead.parsed.title;
    const local = lead.parsed.local;
    return {
      id: `group-${i + 1}`,
      audio: parts.map((p) => p.file),
      pdfs: [],
      title: title || null,
      recordedAt: local ? zonedTimeToUtc(local, timeZone).toISOString() : null,
    };
  });

  const unmatched: F[] = [];
  for (const pdf of pdfs) {
    // Best candidate per group (over its audio parts), then the best and runner-up groups.
    const perGroup = audioGroups.map((parts, group) => {
      let best: Candidate | null = null;
      for (const part of parts) {
        const c = scorePair(part, pdf);
        if (!best || c.score > best.score || (c.score === best.score && c.timeGap < best.timeGap)) best = c;
      }
      return { group, candidate: best! };
    });
    perGroup.sort((a, b) => b.candidate.score - a.candidate.score || a.candidate.timeGap - b.candidate.timeGap || a.group - b.group);
    const [chosen, runnerUp] = perGroup;
    // Modification time alone only decides when it clearly singles out one recording.
    const timeOnly = chosen !== undefined && chosen.candidate.reasons.every((r) => r === "time");
    const ambiguous = timeOnly && runnerUp !== undefined && runnerUp.candidate.score >= chosen!.candidate.score - TIME_MARGIN;
    if (chosen && chosen.candidate.score >= PAIR_THRESHOLD && !ambiguous) {
      groups[chosen.group]!.pdfs.push({ file: pdf.file, reasons: chosen.candidate.reasons });
    } else if (groups.length === 1) {
      groups[0]!.pdfs.push({ file: pdf.file, reasons: ["only_recording"] });
    } else {
      unmatched.push(pdf.file);
    }
  }

  return { groups, unmatched, rejected };
}

/** Moves one PDF to another group (or out of every group with `null`), as the user chose. */
export function assignPdf<F>(result: PairingResult<F>, file: F, groupId: string | null): PairingResult<F> {
  const groups = result.groups.map((g) => ({ ...g, pdfs: g.pdfs.filter((p) => p.file !== file) }));
  const unmatched = result.unmatched.filter((f) => f !== file);
  const target = groups.find((g) => g.id === groupId);
  if (target) target.pdfs.push({ file, reasons: [] });
  else unmatched.push(file);
  return { ...result, groups, unmatched };
}
