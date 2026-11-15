// iCalendar (RFC 5545) output for the ICS subscription (P4-01, CONTRACTS D-P4-2). Pure
// functions: the same events always give the same bytes (DTSTAMP is the event's own
// updated_at, never "now"), so calendar apps see no change until something changed.

export interface IcsEvent {
  id: string;
  title: string;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
  /** IANA zone the event was resolved in; an all-day event's dates are taken there. */
  tz: string;
  updatedAt: number;
  recordingTitle: string | null;
}

const CRLF = "\r\n";
const MAX_OCTETS = 75;
const HOUR_MS = 3_600_000;

/** TEXT value escaping (RFC 5545 §3.3.11): backslash first, then `;`, `,` and newlines. */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const utf8 = new TextEncoder();
const octets = (s: string) => utf8.encode(s).length;

/**
 * Folds a content line to at most 75 octets per physical line (RFC 5545 §3.1). Continuation
 * lines start with one space, which counts toward their 75. A UTF-8 character is never split.
 */
export function foldLine(line: string): string {
  if (octets(line) <= MAX_OCTETS) return line;
  const lines: string[] = [];
  let current = "";
  let used = 0;
  let limit = MAX_OCTETS;
  for (const ch of line) {
    const size = octets(ch);
    if (used + size > limit) {
      lines.push(current);
      current = "";
      used = 0;
      limit = MAX_OCTETS - 1; // the leading space of a continuation line
    }
    current += ch;
    used += size;
  }
  lines.push(current);
  return lines.join(`${CRLF} `);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `YYYYMMDDTHHMMSSZ` in UTC. */
function utcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** The calendar date of `ms` in `tz` as [year, month, day]; an unknown zone falls back to UTC. */
function dateIn(ms: number, tz: string): [number, number, number] {
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  } catch {
    formatted = new Date(ms).toISOString().slice(0, 10);
  }
  const [y, m, d] = formatted.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

/** `YYYYMMDD` of the date `days` after [y, m, d]. */
function dateValue([y, m, d]: [number, number, number], days = 0): string {
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

function eventLines(e: IcsEvent): string[] {
  const lines = [`BEGIN:VEVENT`, `UID:${e.id}@lectern`, `DTSTAMP:${utcStamp(e.updatedAt)}`];
  if (e.allDay) {
    const start = dateIn(e.startAt, e.tz);
    // DTEND of an all-day event is exclusive: the day after the last day.
    const end = e.endAt === null ? start : dateIn(e.endAt, e.tz);
    lines.push(`DTSTART;VALUE=DATE:${dateValue(start)}`, `DTEND;VALUE=DATE:${dateValue(end, 1)}`);
  } else {
    lines.push(`DTSTART:${utcStamp(e.startAt)}`, `DTEND:${utcStamp(e.endAt ?? e.startAt + HOUR_MS)}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(e.title)}`);
  if (e.recordingTitle) lines.push(`DESCRIPTION:${escapeIcsText(`녹음: ${e.recordingTitle}`)}`);
  lines.push(`END:VEVENT`);
  return lines;
}

/** A VCALENDAR with one VEVENT per event, sorted by start then id; CRLF line ends. */
export function renderIcs(events: IcsEvent[]): string {
  const sorted = [...events].sort((a, b) => a.startAt - b.startAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lectern//Calendar//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Lectern",
    ...sorted.flatMap(eventLines),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
