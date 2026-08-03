import { describe, expect, it } from "vitest";
import { evalScoreFields, passKSummary, passKSummaryByTrial } from "./multi-trial";
import type { Evaluation, ScoreDimension } from "@/types";

// 测试只关心 verdict,其余字段强转。
const ev = (verdict: "passed" | "failed"): Evaluation =>
  ({ verdict }) as Evaluation;

describe("passKSummary", () => {
  it("3/3 全过且达 k=3 → green, passPowerK", () => {
    const s = passKSummary([ev("passed"), ev("passed"), ev("passed")], 3);
    expect(s).toMatchObject({
      trials: 3,
      passed: 3,
      k: 3,
      passPowerK: true,
      passAtK: true,
      status: "green",
    });
  });

  it("2/3(2 过 1 挂)→ partial,passPowerK=false", () => {
    const s = passKSummary([ev("passed"), ev("passed"), ev("failed")], 3);
    expect(s).toMatchObject({ trials: 3, passed: 2, passPowerK: false, passAtK: true, status: "partial" });
  });

  it("0/3 全挂 → red,passAtK=false", () => {
    const s = passKSummary([ev("failed"), ev("failed"), ev("failed")], 3);
    expect(s).toMatchObject({ passed: 0, passAtK: false, status: "red" });
  });

  it("2/2 全过但未跑满 k=3 → incomplete,passPowerK=false", () => {
    const s = passKSummary([ev("passed"), ev("passed")], 3);
    expect(s).toMatchObject({ trials: 2, passed: 2, passPowerK: false, status: "incomplete" });
  });

  it("1/2 已挂 + 未满 k=3 → partial(pass^k 已破)", () => {
    const s = passKSummary([ev("passed"), ev("failed")], 3);
    expect(s.status).toBe("partial");
  });

  it("空数组 → trials=0, status=red", () => {
    expect(passKSummary([], 3)).toMatchObject({ trials: 0, passed: 0, status: "red" });
  });

  it("k 取整下限:3.7 → 3;0 → 1", () => {
    expect(passKSummary([ev("passed")], 3.7).k).toBe(3);
    expect(passKSummary([ev("passed")], 0).k).toBe(1);
  });
});

describe("evalScoreFields(多 trial 只计 verdict 不计分)", () => {
  const dims: ScoreDimension[] = [
    { key: "a", label: "A", value: 8, max: 10 },
    { key: "b", label: "B", value: 6, max: 10 },
  ];

  it("单次问答(trialIndex 缺省)→ 分数照常落账", () => {
    expect(evalScoreFields(undefined, dims, 7.2)).toEqual({
      scores: dims,
      autoScore: 7.2,
    });
  });

  it("多 trial 试跑(trialIndex=0 也算)→ scores 置空、autoScore 置 undefined", () => {
    const r = evalScoreFields(0, dims, 7.2);
    expect(r).toEqual({ trialIndex: 0, scores: [], autoScore: undefined });
  });

  it("trialIndex=2 → 带 trialIndex 标,仍不计分", () => {
    const r = evalScoreFields(2, dims, 9.9);
    expect(r.trialIndex).toBe(2);
    expect(r.scores).toEqual([]);
    expect(r.autoScore).toBeUndefined();
  });

  it("试跑评测会被平均分统计排除(autoScore != null 分母口径)", () => {
    const evs = [
      { ...evalScoreFields(undefined, dims, 8) },
      { ...evalScoreFields(0, dims, 2) }, // trial:不应拉低均分
      { ...evalScoreFields(1, dims, 2) },
    ];
    const scored = evs.filter((e) => e.autoScore != null);
    expect(scored).toHaveLength(1);
    expect(scored[0].autoScore).toBe(8);
  });
});

describe("passKSummaryByTrial(多步题按 trial 收敛)", () => {
  const t = (trialIndex: number, verdict: "passed" | "failed") => ({ trialIndex, verdict });

  it("每个 trial 全轮过 × K → green", () => {
    // 3 个 trial,每 trial 2 轮全过
    const evals = [
      t(0, "passed"), t(0, "passed"),
      t(1, "passed"), t(1, "passed"),
      t(2, "passed"), t(2, "passed"),
    ];
    expect(passKSummaryByTrial(evals, 3)).toMatchObject({
      trials: 3, passed: 3, passPowerK: true, status: "green",
    });
  });

  it("某 trial 有一轮挂 → 该 trial 挂 → partial", () => {
    const evals = [
      t(0, "passed"), t(0, "passed"),
      t(1, "passed"), t(1, "failed"), // trial 1 挂
      t(2, "passed"), t(2, "passed"),
    ];
    expect(passKSummaryByTrial(evals, 3)).toMatchObject({
      trials: 3, passed: 2, passPowerK: false, passAtK: true, status: "partial",
    });
  });

  it("trial 数 < k 但全过 → incomplete", () => {
    const evals = [t(0, "passed"), t(0, "passed"), t(1, "passed"), t(1, "passed")];
    expect(passKSummaryByTrial(evals, 3)).toMatchObject({
      trials: 2, passed: 2, passPowerK: false, status: "incomplete",
    });
  });

  it("单 prompt 多 trial(每 trial 1 轮)与 passKSummary 等价(回归)", () => {
    const byTrial = passKSummaryByTrial([t(0, "passed"), t(1, "passed"), t(2, "failed")], 3);
    const flat = passKSummary([{ verdict: "passed" }, { verdict: "passed" }, { verdict: "failed" }], 3);
    expect(byTrial).toEqual(flat);
  });

  it("空输入 → red", () => {
    expect(passKSummaryByTrial([], 3)).toMatchObject({ trials: 0, passed: 0, status: "red" });
  });

  it("多步题某 trial 缺一轮(超时/未判)→ 该 trial 未过 → 非 green", () => {
    // 2 轮题 K=3;trial1 只判了 1 轮(第 2 轮超时无评测)
    const evals = [
      t(0, "passed"), t(0, "passed"),
      t(1, "passed"),               // 缺 turn1
      t(2, "passed"), t(2, "passed"),
    ];
    expect(passKSummaryByTrial(evals, 3, 2)).toMatchObject({
      trials: 3, passed: 2, passPowerK: false, status: "partial",
    });
  });

  it("多步题每 trial 齐轮全过(turnsPerTrial=2)→ green", () => {
    const evals = [
      t(0, "passed"), t(0, "passed"),
      t(1, "passed"), t(1, "passed"),
      t(2, "passed"), t(2, "passed"),
    ];
    expect(passKSummaryByTrial(evals, 3, 2)).toMatchObject({
      trials: 3, passed: 3, passPowerK: true, status: "green",
    });
  });
});
