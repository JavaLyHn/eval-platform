import { describe, expect, it } from "vitest";
import { bucketByDay, summarizeTrend, type TrendItem } from "./trend-buckets";

// 固定「现在」= 2026-07-26 本地正午;date 取当天以落进窗口。
const NOW = new Date(2026, 6, 26, 12, 0, 0);
const dayKey = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
};
const TODAY = dayKey(NOW);
const item = (status: "passed" | "failed", date = `${TODAY}T02:00:00.000Z`): TrendItem => ({
  date,
  status,
});

describe("bucketByDay(按题)", () => {
  it("按题级 status 累计当日通过/失败题数", () => {
    const buckets = bucketByDay(
      [item("passed"), item("passed"), item("failed")],
      30,
      NOW,
    );
    const today = buckets.find((b) => b.date === TODAY)!;
    expect(today.passed).toBe(2);
    expect(today.failed).toBe(1);
  });

  it("窗口外的题不计入", () => {
    const buckets = bucketByDay(
      [item("passed", "2020-01-01T00:00:00.000Z")],
      30,
      NOW,
    );
    expect(buckets.every((b) => b.passed === 0 && b.failed === 0)).toBe(true);
  });
});

describe("summarizeTrend(按题)", () => {
  it("整体通过率 = 通过题 / 已判定题;有数据", () => {
    const s = summarizeTrend(
      bucketByDay([item("passed"), item("passed"), item("failed")], 30, NOW),
    );
    expect(s.hasData).toBe(true);
    expect(s.passRate).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("58 通过 / 41 失败 → 58% 附近(与 KPI 一致)", () => {
    const items = [
      ...Array.from({ length: 58 }, () => item("passed")),
      ...Array.from({ length: 41 }, () => item("failed")),
    ];
    const s = summarizeTrend(bucketByDay(items, 30, NOW));
    expect(Math.round(s.passRate)).toBe(59); // 58/99 ≈ 58.6 → 59
  });

  it("无题 → hasData=false、通过率 0", () => {
    const s = summarizeTrend(bucketByDay([], 30, NOW));
    expect(s.hasData).toBe(false);
    expect(s.passRate).toBe(0);
  });
});
