// Korean UI formatting (DESIGN.md §6.4). Every function is pure; callers pass `now` and
// the time zone so tests and fixtures stay deterministic.

export const DEFAULT_TIME_ZONE = "Asia/Seoul";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Transcript timestamp: "23:45", or "1:23:45" from one hour on. */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** Spoken form for screen readers and accessible names: "12분 30초", "1시간 23분 45초". */
export function formatSpokenTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}시간`);
  if (m) parts.push(`${m}분`);
  if (s || parts.length === 0) parts.push(`${s}초`);
  return parts.join(" ");
}

/** Length of a recording: "1시간 23분", "23분", "45초". */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin === 0) return `${Math.max(0, Math.round(ms / 1000))}초`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/** "1,204" */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("ko-KR").format(n);
}

/** Decimal units with a space before the unit: "820 KB", "37 MB", "1.4 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits).replace(/\.0$/, "")} ${units[unit]}`;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(date: Date, timeZone: string): ZonedParts {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("ko-KR", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      weekday: "short",
    });
    partsFormatters.set(timeZone, fmt);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => fmt.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

/** "10월 19일 (일)" in the same year as `now`, otherwise "2025년 10월 19일". */
export function formatDate(iso: string, now: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const d = zonedParts(new Date(iso), timeZone);
  const n = zonedParts(now, timeZone);
  return d.year === n.year ? `${d.month}월 ${d.day}일 (${d.weekday})` : `${d.year}년 ${d.month}월 ${d.day}일`;
}

/** "오후 3:05" */
export function formatTimeOfDay(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  const { hour, minute } = zonedParts(new Date(iso), timeZone);
  const half = hour < 12 ? "오전" : "오후";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${half} ${h12}:${pad2(minute)}`;
}

/** Absolute date and time for tooltips: "10월 19일 (일) 오후 3:05". */
export function formatDateTime(iso: string, now: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return `${formatDate(iso, now, timeZone)} ${formatTimeOfDay(iso, timeZone)}`;
}

function dayNumber(p: ZonedParts): number {
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

/** "방금 전", "3분 전", "2시간 전", "어제", "3일 전", then the date. */
export function formatRelative(iso: string, now: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  if (diff < 0) return formatDateTime(iso, now, timeZone);
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  const days = dayNumber(zonedParts(now, timeZone)) - dayNumber(zonedParts(then, timeZone));
  if (days === 0) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return formatDate(iso, now, timeZone);
}

/** UTC instant of a wall-clock time in `timeZone` (no DST library needed). */
export function zonedTimeToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone = DEFAULT_TIME_ZONE,
): Date {
  const wanted = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wanted - shown;
  }
  return new Date(guess);
}
