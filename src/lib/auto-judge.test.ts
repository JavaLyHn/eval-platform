import { describe, expect, it } from "vitest";

import { planAutoJudge, type AutoJudgeConfig } from "./auto-judge";

const cfg: AutoJudgeConfig = { judgeProfileIds: ["llm-1"], mode: "skip" };

const base = {
  queueRunning: false,
  autoJudge: cfg,
  judgeRunning: false,
  completed: [{ questionId: "q1" }, { questionId: "q2" }],
  queueConversationId: "conv-A",
  activeConversationId: "conv-A",
};

describe("planAutoJudge", () => {
  it("正常:队列已停 + 有 autoJudge + 同会话 + 有完成题 → 触发,去重 questionIds + 原 config", () => {
    const r = planAutoJudge({
      ...base,
      completed: [{ questionId: "q1" }, { questionId: "q1" }, { questionId: "q2" }],
    });
    expect(r).not.toBeNull();
    expect(r!.questionIds).toEqual(["q1", "q2"]);
    expect(r!.config).toBe(cfg);
  });

  it("队列还在跑 → null", () => {
    expect(planAutoJudge({ ...base, queueRunning: true })).toBeNull();
  });

  it("没勾 autoJudge(null)→ null", () => {
    expect(planAutoJudge({ ...base, autoJudge: null })).toBeNull();
  });

  it("已有评分在跑 → null", () => {
    expect(planAutoJudge({ ...base, judgeRunning: true })).toBeNull();
  });

  it("跨会话(用户切走)→ null", () => {
    expect(planAutoJudge({ ...base, activeConversationId: "conv-B" })).toBeNull();
  });

  it("完成题为空(全失败)→ null", () => {
    expect(planAutoJudge({ ...base, completed: [] })).toBeNull();
  });
});
