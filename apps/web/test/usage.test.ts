// 설정 › 사용량 numbers (P5-11): recording time, dollars from microdollars, binary storage,
// and the ratio against a limit (null without one, never above 1).

import { describe, expect, test } from "bun:test";
import type { WorkspaceUsage } from "../src/api/types.ts";
import { formatAudioTime, formatCost, formatPeriod, formatStorage, usageNote, usageRatio, usageRows } from "../src/lib/usage.ts";

const base: WorkspaceUsage = { period: "2026-11", audio_ms: 12_000_000, ai_cost_microusd: 1_234_567, storage_bytes: 1_288_490_189, quota: null };

describe("usage", () => {
  test("formats", () => {
    const rows = usageRows(base);
    expect(rows.map((r) => r.label)).toEqual(["이번 달 녹음 시간", "이번 달 AI 처리 비용", "저장 공간"]);
    expect(rows.map((r) => r.used)).toEqual(["3시간 20분", "$1.23", "1.2GB"]);
    expect(rows.map((r) => r.max)).toEqual([null, null, null]);
    expect(formatAudioTime(0)).toBe("0분");
    expect(formatAudioTime(45 * 60_000 + 59_999)).toBe("45분");
    expect(formatAudioTime(2 * 3_600_000)).toBe("2시간");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(10_000_000)).toBe("$10.00");
    expect(formatStorage(0)).toBe("0B");
    expect(formatStorage(820 * 1024 * 1024)).toBe("820MB");
    expect(formatStorage(5 * 1024 ** 3)).toBe("5GB");
    expect(formatPeriod("2026-11")).toBe("2026년 11월");
  });

  test("ratio", () => {
    expect(usageRatio(500, null)).toBeNull();
    expect(usageRatio(500, 1000)).toBe(0.5);
    expect(usageRatio(1500, 1000)).toBe(1);
    expect(usageRatio(1, 0)).toBe(1);

    const rows = usageRows({ ...base, quota: { audio_ms_month: 24_000_000, ai_microusd_month: 1_000_000, storage_bytes: null } });
    expect(rows.map((r) => r.ratio)).toEqual([0.5, 1, null]);
    expect(rows.map((r) => r.max)).toEqual(["6시간 40분", "$1.00", null]);
    expect(usageNote(null)).toBeNull();
    expect(usageNote(0.5)).toBeNull();
    expect(usageNote(0.9)).toBe("한도에 가까워졌습니다.");
    expect(usageNote(1)).toBe("한도를 모두 사용했습니다.");
  });
});
