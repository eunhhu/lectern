import { describe, expect, test } from "bun:test";
import { escapeIcsText, foldLine, type IcsEvent, renderIcs } from "../src/calendar/ics.ts";

// The ICS renderer (P4-01): exact bytes for a timed and an all-day event, escaping, folding.

const timed: IcsEvent = {
  id: "evc_1",
  title: "과제 제출, 3장",
  startAt: Date.UTC(2026, 9, 27, 6, 0, 0),
  endAt: Date.UTC(2026, 9, 27, 7, 0, 0),
  allDay: false,
  tz: "Asia/Seoul",
  updatedAt: Date.UTC(2026, 9, 19, 5, 0, 0),
  recordingTitle: "자료구조 7주차",
};
const allDay: IcsEvent = {
  id: "evc_2",
  title: "중간고사",
  startAt: Date.UTC(2026, 10, 2, 15, 0, 0),
  endAt: null,
  allDay: true,
  tz: "Asia/Seoul",
  updatedAt: Date.UTC(2026, 9, 19, 5, 0, 0),
  recordingTitle: null,
};

const EXPECTED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Lectern//Calendar//KO",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Lectern",
  "BEGIN:VEVENT",
  "UID:evc_1@lectern",
  "DTSTAMP:20261019T050000Z",
  "DTSTART:20261027T060000Z",
  "DTEND:20261027T070000Z",
  "SUMMARY:과제 제출\\, 3장",
  "DESCRIPTION:녹음: 자료구조 7주차",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evc_2@lectern",
  "DTSTAMP:20261019T050000Z",
  "DTSTART;VALUE=DATE:20261103",
  "DTEND;VALUE=DATE:20261104",
  "SUMMARY:중간고사",
  "END:VEVENT",
  "END:VCALENDAR",
]
  .map((l) => `${l}\r\n`)
  .join("");

const octets = (s: string) => new TextEncoder().encode(s).length;

describe("renderIcs", () => {
  test("renders a timed and an all-day event", () => {
    expect(renderIcs([timed, allDay])).toBe(EXPECTED);
  });

  test("escapes text", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    expect(escapeIcsText("x\r\ny")).toBe("x\\ny");
  });

  test("folds long lines without splitting characters", () => {
    const ics = renderIcs([{ ...timed, title: "가".repeat(60), recordingTitle: null }]);
    const physical = ics.split("\r\n").filter((l) => l !== "");
    for (const line of physical) expect(octets(line)).toBeLessThanOrEqual(75);
    const start = physical.findIndex((l) => l.startsWith("SUMMARY:"));
    expect(physical[start + 1]!.startsWith(" ")).toBe(true);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`SUMMARY:${"가".repeat(60)}\r\n`);
    expect(ics).not.toContain("�");
  });

  test("foldLine leaves short lines alone and folds at 75 octets", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
    const folded = foldLine(`X:${"a".repeat(200)}`);
    const lines = folded.split("\r\n");
    expect(lines[0]).toHaveLength(75);
    expect(lines.slice(1).every((l) => l.startsWith(" ") && octets(l) <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(`X:${"a".repeat(200)}`);
  });

  test("end defaults to one hour", () => {
    const ics = renderIcs([{ ...timed, endAt: null }]);
    expect(ics).toContain("DTSTART:20261027T060000Z\r\n");
    expect(ics).toContain("DTEND:20261027T070000Z\r\n");
  });

  test("an all-day event with an end runs through its last day", () => {
    const ics = renderIcs([{ ...allDay, endAt: Date.UTC(2026, 10, 4, 15, 0, 0) }]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261103\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20261106\r\n");
  });

  test("sorted by start then id", () => {
    const at = Date.UTC(2026, 9, 27, 6, 0, 0);
    const events: IcsEvent[] = [
      { ...timed, id: "evc_c", startAt: at + 2 * 3_600_000, endAt: null },
      { ...timed, id: "evc_b", startAt: at, endAt: null },
      { ...timed, id: "evc_a", startAt: at, endAt: null },
    ];
    const uids = [...renderIcs(events).matchAll(/^UID:(.+)\r$/gm)].map((m) => m[1]);
    expect(uids).toEqual(["evc_a@lectern", "evc_b@lectern", "evc_c@lectern"]);
  });

  test("the same events give the same bytes", () => {
    expect(renderIcs([allDay, timed])).toBe(renderIcs([timed, allDay]));
  });
});
