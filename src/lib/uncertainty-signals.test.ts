import { describe, it, expect } from "vitest";
import { isUncertaintyType, cleanSignals } from "./uncertainty-signals";

describe("isUncertaintyType", () => {
  it("合法类型 → true", () => {
    expect(isUncertaintyType("hedging")).toBe(true);
    expect(isUncertaintyType("confidence")).toBe(true);
  });
  it("非法 / 非字符串 → false", () => {
    expect(isUncertaintyType("foo")).toBe(false);
    expect(isUncertaintyType(123)).toBe(false);
    expect(isUncertaintyType(null)).toBe(false);
  });
});

describe("cleanSignals", () => {
  it("正常数组原样返回合法项", () => {
    const r = cleanSignals([
      { type: "hedging", quote: "可能吧" },
      { type: "refusal", quote: "我无法回答" },
    ]);
    expect(r).toEqual([
      { type: "hedging", quote: "可能吧" },
      { type: "refusal", quote: "我无法回答" },
    ]);
  });
  it("丢弃非法 type 项", () => {
    expect(cleanSignals([{ type: "foo", quote: "x" }])).toEqual([]);
  });
  it("丢弃空 / 非字符串 quote", () => {
    expect(cleanSignals([{ type: "hedging", quote: "   " }])).toEqual([]);
    expect(cleanSignals([{ type: "hedging", quote: 5 }])).toEqual([]);
  });
  it("quote 去空白并截断到 200 字", () => {
    const long = "x".repeat(250);
    const r = cleanSignals([{ type: "hedging", quote: `  ${long}  ` }]);
    expect(r[0].quote.length).toBe(200);
  });
  it("非数组输入 → []", () => {
    expect(cleanSignals(null)).toEqual([]);
    expect(cleanSignals({})).toEqual([]);
    expect(cleanSignals("x")).toEqual([]);
  });
  it("完全相同的 type+quote 去重", () => {
    expect(
      cleanSignals([
        { type: "refusal", quote: "我无法" },
        { type: "refusal", quote: "我无法" },
      ]),
    ).toEqual([{ type: "refusal", quote: "我无法" }]);
  });
  it("同 type 不同 quote 保留两条", () => {
    expect(
      cleanSignals([
        { type: "refusal", quote: "A" },
        { type: "refusal", quote: "B" },
      ]),
    ).toHaveLength(2);
  });
});
