import { describe, it, expect } from "vitest";
import { costFromSplit, normalizeTokens } from "./model-pricing";

describe("costFromSplit", () => {
  it("input/output 分别按单价计(opus 15/75)", () => {
    expect(costFromSplit("claude-opus-4-7", 1_000_000, 0)).toBeCloseTo(15, 6);
    expect(costFromSplit("claude-opus-4-7", 0, 1_000_000)).toBeCloseTo(75, 6);
  });
  it("同 total 全输入 vs 全输出在 opus 上差 5x", () => {
    const allIn = costFromSplit("claude-opus-4-7", 1000, 0)!;
    const allOut = costFromSplit("claude-opus-4-7", 0, 1000)!;
    expect(allOut / allIn).toBeCloseTo(5, 6);
  });
  it("无匹配定价 → null", () => {
    expect(costFromSplit("totally-unknown-model", 100, 100)).toBeNull();
  });
  it("undefined 模型 → null", () => {
    expect(costFromSplit(undefined, 100, 100)).toBeNull();
  });
  it("零 token → 0", () => {
    expect(costFromSplit("claude-opus-4-7", 0, 0)).toBe(0);
  });
});

describe("normalizeTokens", () => {
  it("真实 in/out → measured", () => {
    expect(normalizeTokens({ tokensIn: 100, tokensOut: 50 })).toEqual({
      input: 100, output: 50, total: 150, basis: "measured",
    });
  });
  it("estimated 标志 → estimated", () => {
    expect(
      normalizeTokens({ tokensIn: 100, tokensOut: 50 }, { estimated: true }),
    ).toEqual({ input: 100, output: 50, total: 150, basis: "estimated" });
  });
  it("只有 total → legacy", () => {
    expect(normalizeTokens({ tokens: 200 })).toEqual({
      input: 0, output: 0, total: 200, basis: "legacy",
    });
  });
  it("没有可用数据 → null", () => {
    expect(normalizeTokens({})).toBeNull();
    expect(normalizeTokens({ tokens: 0 })).toBeNull();
  });
});
