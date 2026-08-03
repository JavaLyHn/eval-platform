import { describe, expect, it } from "vitest";
import { applyManualMetricValue, computeReportMetrics, diffReportMetrics, passKWasRun, suggestConclusion, summarizeDiff } from "./report-metrics";
import type { ReportMetricsInput } from "./report-metrics";
import type { MetricRow, ReportMetrics, ScoreDimension } from "@/types";

const dim = (key: string, value: number): ScoreDimension => ({
  key,
  label: key,
  value,
  max: 10,
});

/** 最小输入工厂:无超范围题、无多 trial、无红线、无目标值。 */
function baseInput(over: Partial<ReportMetricsInput> = {}): ReportMetricsInput {
  return {
    perQuestion: [],
    redlineBlockerCount: 0,
    ...over,
  };
}

describe("computeReportMetrics — 通用指标", () => {
  it("完成率 = 有非空回答的 trial 占比", () => {
    const m = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "q1",
            outOfScope: false,
            trials: [
              { answer: "有内容", verdict: "passed", hadUncertaintySignal: false, scores: [] },
              { answer: "   ", verdict: "failed", hadUncertaintySignal: false, scores: [] },
            ],
          },
        ],
      }),
    );
    const row = m.general.find((r) => r.key === "completion")!;
    expect(row.actualValue).toBe(50);
    expect(row.status).toBe("na"); // 无目标值
  });

  it("静默错误率 = (失败且无不确定信号)占比,betterWhenLower", () => {
    const m = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "q1",
            outOfScope: false,
            trials: [
              { answer: "x", verdict: "failed", hadUncertaintySignal: false, scores: [] },
              { answer: "x", verdict: "failed", hadUncertaintySignal: true, scores: [] },
              { answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] },
              { answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] },
            ],
          },
        ],
      }),
    );
    const row = m.general.find((r) => r.key === "silent-error")!;
    expect(row.actualValue).toBe(25);
    expect(row.betterWhenLower).toBe(true);
  });

  it("边界识别:有超范围题 → 被正确拒答(passed)占比", () => {
    const m = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "oos",
            outOfScope: true,
            trials: [
              { answer: "拒答", verdict: "passed", hadUncertaintySignal: false, scores: [] },
              { answer: "硬答", verdict: "failed", hadUncertaintySignal: false, scores: [] },
            ],
          },
          {
            questionId: "inscope",
            outOfScope: false,
            trials: [{ answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] }],
          },
        ],
      }),
    );
    const row = m.general.find((r) => r.key === "boundary")!;
    expect(row.actualValue).toBe(50);
    expect(row.status).toBe("na");
  });

  it("边界识别:无超范围题 → na", () => {
    const m = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "q1",
            outOfScope: false,
            trials: [{ answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] }],
          },
        ],
      }),
    );
    const row = m.general.find((r) => r.key === "boundary")!;
    expect(row.status).toBe("na");
    expect(row.actualValue).toBeUndefined();
  });

  it("一致性:多 trial 题全过占比(单次题排除)", () => {
    const m = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "multi-green",
            outOfScope: false,
            trials: [
              { answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] },
              { answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] },
            ],
          },
          {
            questionId: "multi-flaky",
            outOfScope: false,
            trials: [
              { answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] },
              { answer: "x", verdict: "failed", hadUncertaintySignal: false, scores: [] },
            ],
          },
          {
            questionId: "single",
            outOfScope: false,
            trials: [{ answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] }],
          },
        ],
      }),
    );
    const row = m.general.find((r) => r.key === "consistency")!;
    expect(row.actualValue).toBe(50);
  });

  it("一致性:无多 trial 题 → na", () => {
    const m = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "single",
            outOfScope: false,
            trials: [{ answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] }],
          },
        ],
      }),
    );
    const row = m.general.find((r) => r.key === "consistency")!;
    expect(row.status).toBe("na");
  });

  it("满意度恒 manual", () => {
    const m = computeReportMetrics(baseInput());
    const row = m.general.find((r) => r.key === "satisfaction")!;
    expect(row.status).toBe("manual");
    expect(row.actualLabel).toContain("人工");
  });

  it("红线:blocker 数 → fail / 0 → pass,betterWhenLower", () => {
    const fail = computeReportMetrics(baseInput({ redlineBlockerCount: 2 }));
    const r1 = fail.general.find((r) => r.key === "redline")!;
    expect(r1.actualValue).toBe(2);
    expect(r1.status).toBe("fail");
    expect(r1.betterWhenLower).toBe(true);
    const ok = computeReportMetrics(baseInput({ redlineBlockerCount: 0 }));
    expect(ok.general.find((r) => r.key === "redline")!.status).toBe("pass");
  });

  it("空输入(无题目)→ completion/silent-error 的 actualValue undefined、status na", () => {
    const m = computeReportMetrics(baseInput());
    const c = m.general.find((r) => r.key === "completion")!;
    const s = m.general.find((r) => r.key === "silent-error")!;
    expect(c.actualValue).toBeUndefined();
    expect(c.status).toBe("na");
    expect(s.actualValue).toBeUndefined();
    expect(s.status).toBe("na");
  });
});

describe("passKWasRun — pass^k 是否真跑了多次", () => {
  const twoTrial = {
    questionId: "multi",
    outOfScope: false,
    trials: [
      { answer: "x", verdict: "passed" as const, hadUncertaintySignal: false, scores: [] },
      { answer: "x", verdict: "passed" as const, hadUncertaintySignal: false, scores: [] },
    ],
  };

  it("k≥2 且有多 trial 实测 → true", () => {
    const m = computeReportMetrics(baseInput({ k: 2, perQuestion: [twoTrial] }));
    expect(passKWasRun(m)).toBe(true);
  });

  it("k=1(单次)→ false,即便有多 trial 数据", () => {
    const m = computeReportMetrics(baseInput({ k: 1, perQuestion: [twoTrial] }));
    expect(passKWasRun(m)).toBe(false);
  });

  it("k 缺省(=1)→ false", () => {
    const m = computeReportMetrics(baseInput({ perQuestion: [twoTrial] }));
    expect(passKWasRun(m)).toBe(false);
  });

  it("k≥2 但无多 trial 题(一致性 na)→ false", () => {
    const m = computeReportMetrics(
      baseInput({
        k: 3,
        perQuestion: [
          {
            questionId: "single",
            outOfScope: false,
            trials: [{ answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] }],
          },
        ],
      }),
    );
    expect(passKWasRun(m)).toBe(false);
  });
});

describe("computeReportMetrics — 目标值 / 专属 / 强约束", () => {
  it("填了目标值 → 按方向判 pass/fail(完成率越高越好)", () => {
    const m = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "q1",
            outOfScope: false,
            trials: [
              { answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] },
              { answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] },
            ],
          },
        ],
        targets: { completion: 90 },
      }),
    );
    expect(m.general.find((r) => r.key === "completion")!.status).toBe("pass");
  });

  it("静默错误率有目标值 → 越低越好(实测 ≤ 目标 才 pass)", () => {
    const m = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "q1",
            outOfScope: false,
            trials: [
              { answer: "x", verdict: "failed", hadUncertaintySignal: false, scores: [] },
              { answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [] },
            ],
          },
        ],
        targets: { "silent-error": 10 },
      }),
    );
    expect(m.general.find((r) => r.key === "silent-error")!.status).toBe("fail");
  });

  it("专属指标 = ScoreDimension 跨题均值,匹配模板 label", () => {
    const m = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "q1",
            outOfScope: false,
            trials: [{ answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [dim("bcs", 8)] }],
          },
          {
            questionId: "q2",
            outOfScope: false,
            trials: [{ answer: "x", verdict: "passed", hadUncertaintySignal: false, scores: [dim("bcs", 6)] }],
          },
        ],
        specificMetricTemplates: [
          { key: "bcs", label: "品牌一致性 BCS", description: "" },
        ],
      }),
    );
    const row = m.specific.find((r) => r.key === "bcs")!;
    expect(row.label).toBe("品牌一致性 BCS");
    expect(row.actualValue).toBe(7);
  });

  it("强约束 = redline + silent-error,均非 fail 才 allMet", () => {
    const m = computeReportMetrics(baseInput({ redlineBlockerCount: 0 }));
    expect(m.strongConstraint.keys).toEqual(["redline", "silent-error"]);
    expect(m.strongConstraint.allMet).toBe(true);
    const bad = computeReportMetrics(baseInput({ redlineBlockerCount: 1 }));
    expect(bad.strongConstraint.allMet).toBe(false);
  });

  it("完成率低于目标 → fail(betterWhenLower:false 反向用例)", () => {
    const m = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "q1",
            outOfScope: false,
            trials: [
              { answer: "有", verdict: "passed", hadUncertaintySignal: false, scores: [] },
              { answer: "   ", verdict: "failed", hadUncertaintySignal: false, scores: [] },
            ],
          },
        ],
        targets: { completion: 90 }, // 实测 50% < 90 → fail
      }),
    );
    expect(m.general.find((r) => r.key === "completion")!.status).toBe("fail");
  });
});

describe("suggestConclusion", () => {
  it("有红线 blocker → blocked", () => {
    const m = computeReportMetrics(baseInput({ redlineBlockerCount: 1 }));
    expect(suggestConclusion(m)).toBe("blocked");
  });

  it("无红线 + 无目标值 → pass(无未达标项)", () => {
    const m = computeReportMetrics(baseInput({ redlineBlockerCount: 0 }));
    expect(suggestConclusion(m)).toBe("pass");
  });

  it("无红线 + 有目标值且存在未达标 → limited", () => {
    const m2 = computeReportMetrics(
      baseInput({
        perQuestion: [
          {
            questionId: "q1",
            outOfScope: false,
            trials: [{ answer: "x", verdict: "failed", hadUncertaintySignal: false, scores: [] }],
          },
        ],
        targets: { "silent-error": 0 }, // 实测 100% > 0 → fail
      }),
    );
    expect(suggestConclusion(m2)).toBe("limited");
  });
});

interface MetricRowLite {
  key: string;
  label?: string;
  actualValue?: number;
  betterWhenLower?: boolean;
}

function metricsWith(general: Partial<MetricRowLite>[], specific: Partial<MetricRowLite>[] = []): ReportMetrics {
  const fill = (r: Partial<MetricRowLite>, kind: "general" | "specific"): MetricRow => ({
    key: r.key!,
    label: r.label ?? r.key!,
    kind,
    actualValue: r.actualValue,
    actualLabel: String(r.actualValue ?? "—"),
    betterWhenLower: r.betterWhenLower,
    status: "na",
  });
  return {
    general: general.map((r) => fill(r, "general")),
    specific: specific.map((r) => fill(r, "specific")),
    strongConstraint: { keys: ["redline", "silent-error"], allMet: true },
    conclusion: "pass",
    k: 1,
  };
}

describe("diffReportMetrics / summarizeDiff", () => {
  it("百分比类:|delta| ≤ 2 → flat", () => {
    const cur = metricsWith([{ key: "completion", actualValue: 91 }]);
    const base = metricsWith([{ key: "completion", actualValue: 90 }]);
    const rows = diffReportMetrics(cur, base);
    const r = rows.find((x) => x.key === "completion")!;
    expect(r.delta).toBe(1);
    expect(r.direction).toBe("flat");
  });

  it("百分比类:升 3 → up", () => {
    const rows = diffReportMetrics(
      metricsWith([{ key: "completion", actualValue: 93 }]),
      metricsWith([{ key: "completion", actualValue: 90 }]),
    );
    expect(rows.find((x) => x.key === "completion")!.direction).toBe("up");
  });

  it("评分类:|delta| ≤ 0.2 → flat", () => {
    const rows = diffReportMetrics(
      metricsWith([], [{ key: "bcs", actualValue: 8.1 }]),
      metricsWith([], [{ key: "bcs", actualValue: 8.0 }]),
    );
    expect(rows.find((x) => x.key === "bcs")!.direction).toBe("flat");
  });

  it("某版缺该指标 → direction na", () => {
    const rows = diffReportMetrics(
      metricsWith([{ key: "completion", actualValue: 90 }, { key: "consistency", actualValue: 80 }]),
      metricsWith([{ key: "completion", actualValue: 90 }]),
    );
    expect(rows.find((x) => x.key === "consistency")!.direction).toBe("na");
  });

  it("summarizeDiff:全 flat → flat", () => {
    const rows = diffReportMetrics(
      metricsWith([{ key: "completion", actualValue: 90 }]),
      metricsWith([{ key: "completion", actualValue: 90 }]),
    );
    expect(summarizeDiff(rows)).toBe("flat");
  });

  it("summarizeDiff:完成率升(变好)+ 无恶化 → improved", () => {
    const rows = diffReportMetrics(
      metricsWith([{ key: "completion", actualValue: 95 }]),
      metricsWith([{ key: "completion", actualValue: 90 }]),
    );
    expect(summarizeDiff(rows)).toBe("improved");
  });

  it("summarizeDiff:静默错误率升(betterWhenLower → 变差) → declined", () => {
    const rows = diffReportMetrics(
      metricsWith([{ key: "silent-error", actualValue: 20, betterWhenLower: true }]),
      metricsWith([{ key: "silent-error", actualValue: 10, betterWhenLower: true }]),
    );
    expect(summarizeDiff(rows)).toBe("declined");
  });

  it("summarizeDiff:静默错误率降(betterWhenLower → 变好) → improved", () => {
    const rows = diffReportMetrics(
      metricsWith([{ key: "silent-error", actualValue: 10, betterWhenLower: true }]),
      metricsWith([{ key: "silent-error", actualValue: 20, betterWhenLower: true }]),
    );
    expect(summarizeDiff(rows)).toBe("improved");
  });

  it("summarizeDiff:一好一坏 → mixed", () => {
    const rows = diffReportMetrics(
      metricsWith([
        { key: "completion", actualValue: 95 },
        { key: "silent-error", actualValue: 20, betterWhenLower: true },
      ]),
      metricsWith([
        { key: "completion", actualValue: 90 },
        { key: "silent-error", actualValue: 10, betterWhenLower: true },
      ]),
    );
    expect(summarizeDiff(rows)).toBe("mixed");
  });

  it("差异行带上 kind(供渲染按量纲格式化)", () => {
    const rows = diffReportMetrics(
      metricsWith([{ key: "completion", actualValue: 92 }], [{ key: "bcs", actualValue: 8 }]),
      metricsWith([{ key: "completion", actualValue: 90 }], [{ key: "bcs", actualValue: 8 }]),
    );
    expect(rows.find((x) => x.key === "completion")!.kind).toBe("general");
    expect(rows.find((x) => x.key === "bcs")!.kind).toBe("specific");
  });
});

describe("applyManualMetricValue(人工采集指标录入)", () => {
  const sat: MetricRow = {
    key: "satisfaction",
    label: "满意度",
    kind: "general",
    actualLabel: "需人工采集",
    status: "manual",
    manual: true,
  };

  it("无目标值 → 录入后 na(只展示实测,不判达标)", () => {
    const r = applyManualMetricValue(sat, 88);
    expect(r.actualValue).toBe(88);
    expect(r.actualLabel).toBe("88%");
    expect(r.status).toBe("na");
  });

  it("有目标值 → 据此判达标 / 未达标", () => {
    expect(applyManualMetricValue({ ...sat, target: 80 }, 88).status).toBe("pass");
    expect(applyManualMetricValue({ ...sat, target: 90 }, 88).status).toBe("fail");
  });

  it("专属指标量纲 0-10(X / 10)", () => {
    const r = applyManualMetricValue({ ...sat, kind: "specific" }, 8.5);
    expect(r.actualLabel).toBe("8.5 / 10");
  });

  it("value=null → 恢复「需人工采集」", () => {
    const filled = applyManualMetricValue({ ...sat, target: 80 }, 88);
    const cleared = applyManualMetricValue(filled, null);
    expect(cleared.actualValue).toBeUndefined();
    expect(cleared.actualLabel).toBe("需人工采集");
    expect(cleared.status).toBe("manual");
  });
});
