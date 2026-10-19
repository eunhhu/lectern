// Calendar helpers: group timed items by local day (Asia/Seoul) and build week ranges.
// Pure, so the grouping rules are unit-tested.

import { DEFAULT_TIME_ZONE } from "./format.ts";

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** "2026-10-21": the local calendar day of an instant (all-day events use their start). */
export function dayKey(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  let fmt = dayFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(iso));
}

export interface CalendarItem {
  id: string;
  kind: "event" | "suggestion" | "task";
  title: string;
  /** Start (events) or due time (tasks), ISO UTC. */
  at: string;
  end: string | null;
  allDay: boolean;
  /** Event kind label or "할 일". */
  label: string;
  recordingId: string;
  recordingTitle: string;
  done?: boolean;
  synced?: boolean;
}

/** Items grouped by local day, each day sorted: all-day first, then by time, then title. */
export function groupByDay(items: readonly CalendarItem[], timeZone = DEFAULT_TIME_ZONE): Map<string, CalendarItem[]> {
  const days = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = dayKey(item.at, timeZone);
    days.set(key, [...(days.get(key) ?? []), item]);
  }
  for (const list of days.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.at.localeCompare(b.at) || a.title.localeCompare(b.title, "ko"));
  }
  return days;
}

/** The seven "YYYY-MM-DD" days of the Sunday-first week containing `day`. */
export function weekOf(day: string): string[] {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const base = Date.UTC(y, m - 1, d);
  const sunday = base - new Date(base).getUTCDay() * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => new Date(sunday + i * 86_400_000).toISOString().slice(0, 10));
}

/** "YYYY-MM-DD" shifted by `days`. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}
