import { describe, expect, it } from "vitest";
import { scopeEvaluationsToConversation } from "./dashboard-scope";
import type { Evaluation } from "@/types";

function ev(id: string, messageId: string): Evaluation {
  return {
    id,
    questionId: "q" + id,
    messageId,
    scores: [],
    autoScore: 0,
    verdict: "passed",
    submittedAt: "t",
    notes: "",
  };
}

describe("scopeEvaluationsToConversation", () => {
  const evals = [ev("a", "m1"), ev("b", "m2"), ev("c", "m3")];

  it("只保留 messageId 在会话内的评测", () => {
    const out = scopeEvaluationsToConversation(evals, new Set(["m1", "m3"]));
    expect(out.map((e) => e.id)).toEqual(["a", "c"]);
  });
  it("空会话消息集 → 空", () => {
    expect(scopeEvaluationsToConversation(evals, new Set())).toEqual([]);
  });
  it("无匹配 → 空", () => {
    expect(scopeEvaluationsToConversation(evals, new Set(["zzz"]))).toEqual([]);
  });
  it("空评测列表 → 空", () => {
    expect(scopeEvaluationsToConversation([], new Set(["m1"]))).toEqual([]);
  });
});
