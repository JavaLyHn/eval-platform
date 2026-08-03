import { describe, it, expect } from "vitest";
import { estimateTokens } from "./token-estimate";

describe("estimateTokens", () => {
  it("空串返回 0", () => {
    expect(estimateTokens("")).toBe(0);
  });
  it("CJK 约 1 token/字", () => {
    expect(estimateTokens("你好世界")).toBe(4);
  });
  it("ASCII 约 4 字/token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
  it("非空至少 1 token", () => {
    expect(estimateTokens("a")).toBe(1);
  });
  it("CJK + ASCII 混合:2 CJK + 8 ASCII = ceil(2 + 8/4) = 4", () => {
    expect(estimateTokens("你好abcdefgh")).toBe(4);
  });
});
