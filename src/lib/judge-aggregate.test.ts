import { describe, expect, it } from "vitest";
import { aggregateJudgeSnapshots, agreementRateOf, type JudgeSnap } from "./judge-aggregate";
import type { ScoringCriterion } from "@/types";

const criteria: ScoringCriterion[] = [
  { key: "acc", label: "准确性", weight: 0.6 },
  { key: "tone", label: "语气", weight: 0.4 },
];
function snap(verdict: "passed" | "failed", acc: number, tone: number, extra: Partial<JudgeSnap> = {}): JudgeSnap {
  return {
    judgeProfileId: "j" + acc,
    scores: [
      { key: "acc", label: "准确性", max: 10, value: acc },
      { key: "tone", label: "语气", max: 10, value: tone },
    ],
    verdict, notes: "n", raw: "r", ...extra,
  };
}

describe("aggregateJudgeSnapshots", () => {
  it("单裁判:分数透传 + verdict 不变", () => {
    const agg = aggregateJudgeSnapshots([snap("passed", 8, 6)], criteria);
    expect(agg.scores.find((s) => s.key === "acc")?.value).toBe(8);
    expect(agg.verdict).toBe("passed");
  });
  it("多裁判:各维度取均值(保留 1 位)", () => {
    const agg = aggregateJudgeSnapshots([snap("passed", 8, 6), snap("passed", 7, 7)], criteria);
    expect(agg.scores.find((s) => s.key === "acc")?.value).toBe(7.5);
    expect(agg.scores.find((s) => s.key === "tone")?.value).toBe(6.5);
  });
  it("多数判定:2 passed 1 failed → passed", () => {
    expect(aggregateJudgeSnapshots([snap("passed", 8, 8), snap("passed", 8, 8), snap("failed", 2, 2)], criteria).verdict).toBe("passed");
  });
  it("平票 → failed(严格)", () => {
    expect(aggregateJudgeSnapshots([snap("passed", 8, 8), snap("failed", 2, 2)], criteria).verdict).toBe("failed");
  });
  it("多裁判 notes 带校准头", () => {
    const agg = aggregateJudgeSnapshots([snap("passed", 8, 8), snap("failed", 2, 2)], criteria);
    expect(agg.notes).toContain("校准 2 位裁判");
    expect(agg.passCount).toBe(1);
  });
  it("nameOf 解析裁判名 + 中文判定,不再出现 profile id 代号", () => {
    const agg = aggregateJudgeSnapshots(
      [snap("passed", 8, 8, { judgeProfileId: "ap_zlgwek7p" }), snap("failed", 2, 2, { judgeProfileId: "ap_other" })],
      criteria,
      (id) => (id === "ap_zlgwek7p" ? "DeepSeek-V3" : "GPT-4o"),
    );
    expect(agg.notes).toContain("[DeepSeek-V3] 通过");
    expect(agg.notes).toContain("[GPT-4o] 失败");
    expect(agg.notes).not.toContain("ap_zlgwek7p");
    expect(agg.notes).not.toContain("#1");
  });
});

describe("agreementRateOf", () => {
  it("≤1 裁判 → undefined", () => {
    expect(agreementRateOf([snap("passed", 8, 8)])).toBeUndefined();
  });
  it("3 裁判 2:1 → 67", () => {
    expect(agreementRateOf([snap("passed", 8, 8), snap("passed", 8, 8), snap("failed", 2, 2)])).toBe(67);
  });
});
