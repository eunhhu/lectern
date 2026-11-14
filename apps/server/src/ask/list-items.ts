// The data behind the ask `list_items` tool (P4-06, CONTRACTS D-P4-8): events and action
// items extracted from the notes, by period, as plain lines for the model. Read-only. Only
// the recordings the thread's AccessScope allows (the caller's readable recordings within
// the thread's scope) are listed, so another member's private recording never shows up.

import type { ListItemsSource } from "@lectern/ask";
import { db } from "../db.ts";

const LIMIT = 50;
const TZ = "Asia/Seoul";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const EVENT_STATUS_LABEL: Record<string, string> = { suggested: "제안", accepted: "수락됨", synced: "캘린더에 있음" };

/**
 * A period bound in ms, or null when absent or unreadable. Dates without a time are Seoul
 * dates; a date-only `to` covers that whole day.
 */
function bound(value: string | undefined, end: boolean): number | null {
  if (!value) return null;
  const text = value.trim();
  if (DATE_ONLY.test(text)) {
    const start = Date.parse(`${text}T00:00:00+09:00`);
    if (Number.isNaN(start)) return null;
    return end ? start + DAY_MS - 1 : start;
  }
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : at;
}

function parts(at: number, tz: string): Record<string, string> {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  return Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
}

const dateOf = (at: number, tz = TZ) => {
  const p = parts(at, tz);
  return `${p.year}-${p.month}-${p.day}`;
};
const timeOf = (at: number) => {
  const p = parts(at, TZ);
  return `${p.hour}:${p.minute}`;
};

/** One line of text: the tool output is one item per line. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

type EventRow = { title: string; start_at: number; all_day: number; tz: string; status: string; recording_id: string; recording_title: string };
type ItemRow = { text: string; due_at: number | null; recording_id: string; recording_title: string };

export const listItemsSource: ListItemsSource = async (access, args) => {
  const empty = "해당 기간에 항목이 없습니다.";
  if (access.recordingIds.length === 0) return empty;
  const from = bound(args.from, false);
  const to = bound(args.to, true);
  const ids = JSON.stringify(access.recordingIds);
  const title = (row: { recording_id: string; recording_title: string }) =>
    oneLine(access.recordings.get(row.recording_id)?.title ?? row.recording_title);

  let lines: string[];
  if (args.kind === "events") {
    const where = [`e.workspace_id = ?`, `e.recording_id IN (SELECT value FROM json_each(?))`, `e.status IN ('accepted', 'synced', 'suggested')`];
    const params: Array<string | number> = [access.workspaceId, ids];
    if (from !== null) (where.push(`e.start_at >= ?`), params.push(from));
    if (to !== null) (where.push(`e.start_at <= ?`), params.push(to));
    const rows = db
      .query(
        `SELECT e.title, e.start_at, e.all_day, e.tz, e.status, e.recording_id, r.title AS recording_title
         FROM event_candidate e JOIN recording r ON r.id = e.recording_id
         WHERE ${where.join(" AND ")} ORDER BY e.start_at, e.id LIMIT ?`
      )
      .all(...params, LIMIT + 1) as EventRow[];
    lines = rows.map((e) => {
      const when = e.all_day ? dateOf(e.start_at, e.tz) : `${dateOf(e.start_at)} ${timeOf(e.start_at)}`;
      const status = EVENT_STATUS_LABEL[e.status] ?? e.status;
      return `- [일정] ${when} ${oneLine(e.title)} (녹음: ${title(e)}, 상태: ${status}) #rec:${e.recording_id}`;
    });
  } else {
    const where = [`a.workspace_id = ?`, `a.recording_id IN (SELECT value FROM json_each(?))`, `a.status = 'open'`];
    const params: Array<string | number> = [access.workspaceId, ids];
    // With a period, only items due inside it; items without a due date are left out.
    if (from !== null) (where.push(`a.due_at >= ?`), params.push(from));
    if (to !== null) (where.push(`a.due_at <= ?`), params.push(to));
    const rows = db
      .query(
        `SELECT a.text, a.due_at, a.recording_id, r.title AS recording_title
         FROM action_item a JOIN recording r ON r.id = a.recording_id
         WHERE ${where.join(" AND ")} ORDER BY a.due_at IS NULL, a.due_at, a.created_at, a.id LIMIT ?`
      )
      .all(...params, LIMIT + 1) as ItemRow[];
    lines = rows.map((a) => {
      let due = "마감 없음";
      if (a.due_at !== null) {
        const time = timeOf(a.due_at);
        due = `마감 ${dateOf(a.due_at)}${time === "00:00" ? "" : ` ${time}`}`;
      }
      return `- [할 일] ${due} ${oneLine(a.text)} (녹음: ${title(a)}) #rec:${a.recording_id}`;
    });
  }

  if (lines.length === 0) return empty;
  if (lines.length > LIMIT) return [...lines.slice(0, LIMIT), "(이후 항목 생략)"].join("\n");
  return lines.join("\n");
};
