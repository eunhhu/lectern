// The admin console's table sort (P5-12): numbers, strings and nulls mixed; nulls go last
// in both directions and equal values keep their order (a stable sort).

import { describe, expect, test } from "bun:test";
import { sortRows, type Column } from "../src/routes/admin/DataTable.tsx";
import { formatElapsed, formatUsd, jobElapsedMs, recentPeriods, stageElapsedMs } from "../src/routes/admin/format.ts";

interface Row {
  id: string;
  n: number | null;
  s: string | null;
}

const rows: Row[] = [
  { id: "a", n: 3, s: "나" },
  { id: "b", n: null, s: "가" },
  { id: "c", n: 1, s: null },
  { id: "d", n: 3, s: "다" },
  { id: "e", n: 2, s: "가" },
  { id: "f", n: null, s: null },
];
const num: Column<Row> = { key: "n", header: "n", cell: (r) => r.n, sortValue: (r) => r.n, align: "right" };
const str: Column<Row> = { key: "s", header: "s", cell: (r) => r.s, sortValue: (r) => r.s };
const ids = (list: Row[]) => list.map((r) => r.id).join("");

describe("admin-table", () => {
  test("sortRows", () => {
    expect(ids(sortRows(rows, num, "asc"))).toBe("ceadbf");
    expect(ids(sortRows(rows, num, "desc"))).toBe("adecbf");
    expect(ids(sortRows(rows, str, "asc"))).toBe("beadcf");
    expect(ids(sortRows(rows, str, "desc"))).toBe("dabecf");
    // Not sortable: as given, and never the same array.
    const plain: Column<Row> = { key: "x", header: "x", cell: () => null };
    const same = sortRows(rows, plain, "asc");
    expect(ids(same)).toBe("abcdef");
    expect(same).not.toBe(rows);
  });

  test("formatUsd", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(12_300)).toBe("$0.0123");
    expect(formatUsd(41_870)).toBe("$0.0419");
    expect(formatUsd(1_234_567)).toBe("$1.23");
    expect(formatUsd(10_000_000)).toBe("$10.00");
  });

  test("formatElapsed", () => {
    expect(formatElapsed(0)).toBe("0초");
    expect(formatElapsed(400)).toBe("0.4초");
    expect(formatElapsed(12_000)).toBe("12초");
    expect(formatElapsed(182_000)).toBe("3분 2초");
    expect(formatElapsed(3_840_000)).toBe("1시간 4분");
  });

  test("elapsed times", () => {
    const created = "2026-11-15T01:00:00.000Z";
    const updated = "2026-11-15T01:07:00.000Z";
    expect(jobElapsedMs({ state: "failed", created_at: created, updated_at: updated })).toBe(420_000);
    expect(jobElapsedMs({ state: "running", created_at: created, updated_at: updated })).toBeNull();
    expect(stageElapsedMs({ started_at: null, finished_at: null })).toBeNull();
    expect(stageElapsedMs({ started_at: created, finished_at: null }, Date.parse(updated))).toBe(420_000);
  });

  test("recentPeriods are Seoul months", () => {
    // 2026-12-31 20:00 UTC is already 2027-01-01 in Seoul.
    expect(recentPeriods(Date.parse("2026-12-31T20:00:00Z"), 3)).toEqual(["2027-01", "2026-12", "2026-11"]);
    expect(recentPeriods(Date.parse("2026-03-15T00:00:00Z"))).toEqual(["2026-03", "2026-02", "2026-01", "2025-12", "2025-11", "2025-10", "2025-09"]);
  });
});
