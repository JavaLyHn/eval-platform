import { describe, it, expect } from "vitest";
import {
  cloneRunConfig,
  failedQuestionIdsFromReport,
  canCompare,
  deriveRunProgress,
  shouldStartJudging,
} from "./evaluation-run";
import type { EvaluationRun } from "@/types";

const baseRun: EvaluationRun = {
  id: "run_1",
  createdAt: "2026-06-23T00:00:00.000Z",
  updatedAt: "2026-06-23T00:00:00.000Z",
  subjectProfileId: "p_aria",
  versionLabel: "v1",
  config: { questionIds: ["q1", "q2"], trialsPerQuestion: 1, judgeProfileIds: ["j1"], judgeMode: "skip" },
  status: "done",
  progress: { answered: 2, judged: 2, total: 2 },
  runConversationId: "conv_1",
};

describe("cloneRunConfig", () => {
  it("深拷 config、questionIds 不共享引用", () => {
    const cfg = cloneRunConfig(baseRun);
    expect(cfg).toEqual(baseRun.config);
    expect(cfg.questionIds).not.toBe(baseRun.config.questionIds);
    expect(cfg.judgeProfileIds).not.toBe(baseRun.config.judgeProfileIds);
  });
});

describe("failedQuestionIdsFromReport", () => {
  it("只取 verdict=failed 的题,去重", () => {
    const report = { items: [
      { questionId: "q1", verdict: "failed" as const },
      { questionId: "q2", verdict: "passed" as const },
      { questionId: "q1", verdict: "failed" as const },
    ] };
    expect(failedQuestionIdsFromReport(report)).toEqual(["q1"]);
  });
  it("无失败 → []", () => {
    expect(failedQuestionIdsFromReport({ items: [{ questionId: "q1", verdict: "passed" as const }] })).toEqual([]);
  });
});

describe("canCompare", () => {
  it("同被测且皆有 reportId → true", () => {
    const a = { ...baseRun, id: "a", reportId: "r1" };
    const b = { ...baseRun, id: "b", reportId: "r2" };
    expect(canCompare(a, b)).toBe(true);
  });
  it("异被测 → false", () => {
    const a = { ...baseRun, id: "a", reportId: "r1" };
    const b = { ...baseRun, id: "b", reportId: "r2", subjectProfileId: "p_bob" };
    expect(canCompare(a, b)).toBe(false);
  });
  it("缺报告 → false", () => {
    const a = { ...baseRun, id: "a", reportId: "r1" };
    const b = { ...baseRun, id: "b" };
    expect(canCompare(a, b)).toBe(false);
  });
});

describe("deriveRunProgress", () => {
  it("answered=本 run 会话的 completed 数,total=config", () => {
    const p = deriveRunProgress(
      { running: true, completed: [1, 2, 3], total: 5, conversationId: "conv_1" },
      { done: 1 },
      "conv_1",
    );
    expect(p).toEqual({ answered: 3, judged: 1, total: 5 });
  });
  it("队列不属于本 run → answered=0", () => {
    const p = deriveRunProgress(
      { running: true, completed: [1, 2], total: 5, conversationId: "other" },
      { done: 0 },
      "conv_1",
    );
    expect(p.answered).toBe(0);
  });
});

describe("shouldStartJudging", () => {
  it("status=answering 且队列已停且会话匹配 → true", () => {
    const run = { ...baseRun, status: "answering" as const, runConversationId: "conv_1" };
    expect(shouldStartJudging(run, { running: false, conversationId: "conv_1" })).toBe(true);
  });
  it("队列仍在跑 → false", () => {
    const run = { ...baseRun, status: "answering" as const, runConversationId: "conv_1" };
    expect(shouldStartJudging(run, { running: true, conversationId: "conv_1" })).toBe(false);
  });
  it("会话不匹配 → false", () => {
    const run = { ...baseRun, status: "answering" as const, runConversationId: "conv_1" };
    expect(shouldStartJudging(run, { running: false, conversationId: "other" })).toBe(false);
  });
  it("非 answering 状态 → false", () => {
    expect(shouldStartJudging(baseRun, { running: false, conversationId: "conv_1" })).toBe(false);
  });
});
