import { describe, expect, test } from "bun:test";
import { resolveKoreanDate, type KoreanDateBase } from "../src/notes/korean-date.ts";

const at = (date: string): KoreanDateBase => ({ recordedAtMs: Date.parse(`${date}T14:00:00+09:00`), tz: "Asia/Seoul" });
const base0 = at("2026-10-19");

function r(raw: string, base: KoreanDateBase = base0) {
  const out = resolveKoreanDate(raw, base);
  if (!out) return null;
  const { date, time, end_time, all_day, rule } = out;
  return { date, time, end_time, all_day, rule };
}

const day = (date: string, rule: string, time: string | null = null, end_time: string | null = null) => ({
  date,
  time,
  end_time,
  all_day: time === null,
  rule,
});

describe("resolveKoreanDate", () => {
  test("A. the contract table", () => {
    const table: Array<[string, ReturnType<typeof day> | null]> = [
      ["오늘", day("2026-10-19", "today")],
      ["내일", day("2026-10-20", "tomorrow")],
      ["모레", day("2026-10-21", "day_after_tomorrow")],
      ["글피", day("2026-10-22", "three_days_later")],
      ["이번 주 금요일", day("2026-10-23", "this_week_weekday")],
      ["이번 주 일요일", day("2026-10-25", "this_week_weekday")],
      ["다음 주 월요일", day("2026-10-26", "next_week_weekday")],
      ["다음 주 화요일 수업 전까지", day("2026-10-27", "next_week_weekday")],
      ["금요일까지", day("2026-10-23", "weekday")],
      ["월요일까지", day("2026-10-26", "weekday")],
      ["3일 뒤", day("2026-10-22", "days_later")],
      ["2주 뒤", day("2026-11-02", "weeks_later")],
      ["일주일 후", day("2026-10-26", "weeks_later")],
      ["이번 달 말", day("2026-10-31", "end_of_month")],
      ["다음 달 5일", day("2026-11-05", "next_month_day")],
      ["11월 3일", day("2026-11-03", "month_day")],
      ["1월 5일", day("2027-01-05", "month_day")],
      ["10월 15일", day("2026-10-15", "month_day")],
      ["12월 24일 수요일", day("2026-12-24", "month_day")],
      ["오후 3시", day("2026-10-19", "time_only", "15:00")],
      ["내일 오전 9시 반", day("2026-10-20", "tomorrow", "09:30")],
      ["다음 주 수요일 오후 2시", day("2026-10-28", "next_week_weekday", "14:00")],
      ["학기 말쯤", null],
    ];
    expect(table).toHaveLength(23);
    for (const [raw, expected] of table) expect({ raw, out: r(raw) }).toEqual({ raw, out: expected });
    expect(resolveKoreanDate("12월 24일 수요일", base0)!.flags).toEqual(["weekday_mismatch"]);
  });

  test("B. other base days", () => {
    const table: Array<[string, string, string, string]> = [
      ["2026-10-23", "금요일까지", "2026-10-30", "weekday"],
      ["2026-10-23", "이번 주 월요일", "2026-10-19", "this_week_weekday"],
      ["2026-10-23", "다음 주 금요일", "2026-10-30", "next_week_weekday"],
      ["2026-10-23", "내일", "2026-10-24", "tomorrow"],
      ["2026-10-31", "내일", "2026-11-01", "tomorrow"],
      ["2026-10-31", "이번 달 말", "2026-10-31", "end_of_month"],
      ["2026-10-31", "다음 달 5일", "2026-11-05", "next_month_day"],
      ["2026-10-31", "2주 뒤", "2026-11-14", "weeks_later"],
      ["2026-12-31", "내일", "2027-01-01", "tomorrow"],
      ["2026-12-31", "1월 5일", "2027-01-05", "month_day"],
      ["2026-12-31", "다음 달 5일", "2027-01-05", "next_month_day"],
      ["2026-12-31", "다음 주 월요일", "2027-01-04", "next_week_weekday"],
      ["2026-12-31", "12월 31일", "2026-12-31", "month_day"],
      ["2026-10-19", "9월 18일", "2026-09-18", "month_day"],
      ["2026-10-19", "9월 17일", "2027-09-17", "month_day"],
    ];
    for (const [baseDay, raw, date, rule] of table) {
      const out = r(raw, at(baseDay));
      expect({ baseDay, raw, date: out?.date, rule: out?.rule }).toEqual({ baseDay, raw, date, rule });
    }
  });

  test("C. time zones", () => {
    const recordedAtMs = Date.UTC(2026, 9, 19, 20, 0, 0);
    expect(r("오늘", { recordedAtMs, tz: "America/New_York" })!.date).toBe("2026-10-19");
    expect(r("내일", { recordedAtMs, tz: "America/New_York" })!.date).toBe("2026-10-20");
    expect(r("오늘", { recordedAtMs, tz: "Asia/Seoul" })!.date).toBe("2026-10-20");
  });

  test("D. time ranges and notation", () => {
    expect(r("오후 2시부터 4시까지")).toEqual(day("2026-10-19", "time_only", "14:00", "16:00"));
    expect(r("오전 11시부터 1시까지")).toMatchObject({ time: "11:00", end_time: "13:00" });
    expect(r("내일 오후 3시 30분")).toMatchObject({ date: "2026-10-20", time: "15:30" });
    expect(r("오전 12시")!.time).toBe("00:00");
    expect(r("오후 12시")!.time).toBe("12:00");
    expect(r("내일 오후 25시")).toBeNull();
  });

  test("E. unreadable input is null", () => {
    for (const raw of ["", "다음 주", "5일까지", "나중에", "2월 30일", "13월 1일"]) {
      expect({ raw, out: resolveKoreanDate(raw, base0) }).toEqual({ raw, out: null });
    }
  });

  test("F. flags key, determinism, whitespace and full-width digits", () => {
    const out = resolveKoreanDate("내일", base0)!;
    expect("flags" in out).toBe(false);
    expect(resolveKoreanDate("다음 주 화요일", base0)).toEqual(resolveKoreanDate("다음 주 화요일", base0));
    expect(r("  이번   주  금요일 ")).toEqual(r("이번 주 금요일"));
    expect(r("３일 뒤")).toEqual(r("3일 뒤"));
  });
});
