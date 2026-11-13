// Deterministic Korean relative-date parser (CONTRACTS §1.7, AI_HARNESS §3.9.1).
// "다음 주 화요일 수업 전까지", "내일 오전 9시 반" → a calendar date (and time) in the
// recording's time zone. Anything it cannot read returns null: it never guesses.

export interface KoreanDateBase {
  recordedAtMs: number;
  tz: string;
}

export interface ResolvedDate {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string | null;
  /** HH:MM */
  end_time: string | null;
  all_day: boolean;
  rule: string;
  /** Only present when non-empty; the only value used here is "weekday_mismatch". */
  flags?: string[];
}

const WEEKDAYS = "월화수목금토일";

function localParts(ms: number, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function dayNumber(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fmt(dn: number): string {
  return new Date(dn * 86_400_000).toISOString().slice(0, 10);
}

/** Monday = 0 … Sunday = 6 (1970-01-01 was a Thursday). */
function weekday(dn: number): number {
  return (((dn + 3) % 7) + 7) % 7;
}

/** Day number of an existing calendar date, or null (2월 30일, 13월). */
function validDay(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dn = dayNumber(y, m, d);
  const [yy, mm, dd] = fmt(dn).split("-").map(Number);
  return yy === y && mm === m && dd === d ? dn : null;
}

function lastDayOfMonth(y: number, m: number): number {
  return dayNumber(y, m + 1, 1) - 1;
}

type Clock = { hour: number; minute: number; meridiem: string | undefined };

function toClock(meridiem: string | undefined, hourText: string, minuteText: string | undefined, half: string | undefined): Clock | null {
  let hour = Number(hourText);
  const minute = half ? 30 : minuteText ? Number(minuteText) : 0;
  if (meridiem === "오후" && hour < 12) hour += 12;
  else if (meridiem === "오전" && hour === 12) hour = 0;
  if (hour >= 24 || minute >= 60) return null;
  return { hour, minute, meridiem };
}

function hhmm(c: { hour: number; minute: number }): string {
  return `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
}

const RANGE_RE =
  /(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(?:(\d{1,2})\s*분|(반)))?\s*(?:부터|~|-)\s*(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(?:(\d{1,2})\s*분|(반)))?/;
const SINGLE_RE = /(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(?:(\d{1,2})\s*분|(반)))?/;

/** Pulls the time (or time range) out of the text. `invalid` means a time that cannot exist. */
function extractTime(text: string): { time: string | null; end: string | null; rest: string; invalid: boolean } {
  const range = RANGE_RE.exec(text);
  if (range) {
    const start = toClock(range[1], range[2]!, range[3], range[4]);
    if (!start) return { time: null, end: null, rest: text, invalid: true };
    const endMeridiem = range[5] ?? range[1];
    let endHour = Number(range[6]);
    const endMinute = range[8] ? 30 : range[7] ? Number(range[7]) : 0;
    if (endMeridiem === "오후" && endHour < 12) endHour += 12;
    else if (endMeridiem === "오전" && endHour === 12) endHour = 0;
    if (endHour >= 24 || endMinute >= 60) return { time: null, end: null, rest: text, invalid: true };
    let endTotal = endHour * 60 + endMinute;
    if (endTotal <= start.hour * 60 + start.minute) endTotal += 12 * 60;
    const end = endTotal >= 24 * 60 ? null : hhmm({ hour: Math.floor(endTotal / 60), minute: endTotal % 60 });
    return { time: hhmm(start), end, rest: text.replace(range[0], " "), invalid: false };
  }
  const single = SINGLE_RE.exec(text);
  if (single) {
    const clock = toClock(single[1], single[2]!, single[3], single[4]);
    if (!clock) return { time: null, end: null, rest: text, invalid: true };
    return { time: hhmm(clock), end: null, rest: text.replace(single[0], " "), invalid: false };
  }
  return { time: null, end: null, rest: text, invalid: false };
}

/** Resolves a Korean date expression against the recording time, or returns null. */
export function resolveKoreanDate(raw: string, base: KoreanDateBase): ResolvedDate | null {
  const text = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!text) return null;

  const { time, end, rest, invalid } = extractTime(text);
  if (invalid) return null;

  const { y: Y, m: M, d: D } = localParts(base.recordedAtMs, base.tz);
  const B = dayNumber(Y, M, D);
  const flags: string[] = [];
  let date: number | null = null;
  let rule: string | null = null;
  let match: RegExpExecArray | null;

  if (/이번\s*달\s*말|이달\s*말|월말/.test(rest)) {
    date = lastDayOfMonth(Y, M);
    rule = "end_of_month";
  } else if ((match = /다음\s*달\s*(\d{1,2})\s*일/.exec(rest))) {
    const nextY = M === 12 ? Y + 1 : Y;
    const nextM = M === 12 ? 1 : M + 1;
    date = validDay(nextY, nextM, Number(match[1]));
    if (date === null) return null;
    rule = "next_month_day";
  } else if ((match = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(rest))) {
    const m = Number(match[1]);
    const d = Number(match[2]);
    let candidate = validDay(Y, m, d);
    if (candidate === null) return null;
    if (B - candidate > 31) {
      candidate = validDay(Y + 1, m, d);
      if (candidate === null) return null;
    }
    date = candidate;
    rule = "month_day";
    const said = /([월화수목금토일])요일/.exec(rest);
    if (said && WEEKDAYS.indexOf(said[1]!) !== weekday(date)) flags.push("weekday_mismatch");
  } else if ((match = /(이번|다음)\s*주\s*([월화수목금토일])요일/.exec(rest))) {
    const weeks = match[1] === "다음" ? 1 : 0;
    date = B - weekday(B) + weeks * 7 + WEEKDAYS.indexOf(match[2]!);
    rule = weeks ? "next_week_weekday" : "this_week_weekday";
  } else if ((match = /(\d+)\s*주\s*(?:뒤|후)/.exec(rest))) {
    date = B + Number(match[1]) * 7;
    rule = "weeks_later";
  } else if (/일주일\s*(?:뒤|후)/.test(rest)) {
    date = B + 7;
    rule = "weeks_later";
  } else if ((match = /(\d+)\s*일\s*(?:뒤|후)/.exec(rest))) {
    date = B + Number(match[1]);
    rule = "days_later";
  } else if (rest.includes("글피")) {
    date = B + 3;
    rule = "three_days_later";
  } else if (rest.includes("모레")) {
    date = B + 2;
    rule = "day_after_tomorrow";
  } else if (rest.includes("내일")) {
    date = B + 1;
    rule = "tomorrow";
  } else if (rest.includes("오늘")) {
    date = B;
    rule = "today";
  } else if ((match = /([월화수목금토일])요일/.exec(rest))) {
    const target = WEEKDAYS.indexOf(match[1]!);
    const ahead = (target - weekday(B) + 7) % 7;
    date = B + (ahead === 0 ? 7 : ahead);
    rule = "weekday";
  } else if (time !== null) {
    date = B;
    rule = "time_only";
  } else {
    return null;
  }

  const result: ResolvedDate = { date: fmt(date), time, end_time: end, all_day: time === null, rule };
  if (flags.length > 0) result.flags = flags;
  return result;
}
