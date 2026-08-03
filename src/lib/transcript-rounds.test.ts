import { describe, expect, it } from "vitest";
import { lastRoundSteps, roundCount } from "./transcript-rounds";
import type { TranscriptStep } from "@/types";

const u = (c: string): TranscriptStep => ({ role: "user", content: c });
const a = (c: string): TranscriptStep => ({ role: "assistant", content: c });
const t = (name: string): TranscriptStep => ({ role: "tool", content: "", toolName: name });

describe("lastRoundSteps", () => {
  it("多轮:取最后一个 user 步到结尾(含该轮 user/assistant/tool)", () => {
    const steps = [u("q1"), a("a1"), u("q2"), t("send"), a("a2")];
    expect(lastRoundSteps(steps)).toEqual([u("q2"), t("send"), a("a2")]);
  });
  it("单轮:取全部", () => {
    const steps = [u("q1"), a("a1")];
    expect(lastRoundSteps(steps)).toEqual(steps);
  });
  it("无 user 步:原样返回", () => {
    const steps = [a("only"), t("x")];
    expect(lastRoundSteps(steps)).toEqual(steps);
  });
  it("空数组:返回空", () => {
    expect(lastRoundSteps([])).toEqual([]);
  });
});

describe("roundCount", () => {
  it("数 user 步", () => {
    expect(roundCount([u("a"), a("x"), u("b"), a("y")])).toBe(2);
    expect(roundCount([a("x")])).toBe(0);
    expect(roundCount([])).toBe(0);
  });
});
