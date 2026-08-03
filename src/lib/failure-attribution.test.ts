import { describe, it, expect } from "vitest";
import {
  FAILURE_CATEGORIES,
  FAILURE_CATEGORY_META,
  isFailureCategory,
  cleanSecondary,
  aggregatePrimary,
  resolveFailureAttribution,
} from "./failure-attribution";

describe("枚举与元数据", () => {
  it("6 类固定顺序 + 每类有 label/color/fixHint", () => {
    expect(FAILURE_CATEGORIES).toEqual([
      "knowledge", "tool", "param", "planning", "style", "safety",
    ]);
    for (const c of FAILURE_CATEGORIES) {
      const m = FAILURE_CATEGORY_META[c];
      expect(m.label).toBeTruthy();
      expect(m.color).toBeTruthy();
      expect(m.fixHint).toBeTruthy();
    }
  });
  it("isFailureCategory 校验", () => {
    expect(isFailureCategory("tool")).toBe(true);
    expect(isFailureCategory("nope")).toBe(false);
    expect(isFailureCategory(3)).toBe(false);
    expect(isFailureCategory(null)).toBe(false);
    expect(isFailureCategory(undefined)).toBe(false);
  });
});

describe("cleanSecondary", () => {
  it("过滤非法 + 去重 + 去掉 primary;空→undefined", () => {
    expect(cleanSecondary("tool", ["param", "param", "tool", "x", "style"]))
      .toEqual(["param", "style"]);
    expect(cleanSecondary("tool", [])).toBeUndefined();
    expect(cleanSecondary("tool", ["tool"])).toBeUndefined();
    expect(cleanSecondary("tool", "nope")).toBeUndefined();
    expect(cleanSecondary("tool", null)).toBeUndefined();
  });
});

describe("aggregatePrimary", () => {
  it("多数票", () => {
    expect(aggregatePrimary(["tool", "param", "tool"])).toBe("tool");
  });
  it("平票取首个出现", () => {
    expect(aggregatePrimary(["param", "tool"])).toBe("param");
    expect(aggregatePrimary(["tool", "param", "param", "tool"])).toBe("tool");
  });
  it("忽略空值;全空→null", () => {
    expect(aggregatePrimary([null, "style", undefined])).toBe("style");
    expect(aggregatePrimary([null, undefined])).toBeNull();
    expect(aggregatePrimary([])).toBeNull();
  });
});

describe("resolveFailureAttribution", () => {
  it("真踩红线(引用了红线条款)→ 强制 safety(source=redline),judge 非 safety 主因降次因", () => {
    const a = resolveFailureAttribution({
      redLineViolated: true,
      judgePrimary: "tool",
      judgeSecondary: ["param"],
    });
    expect(a).toEqual({ primary: "safety", source: "redline", secondary: ["tool", "param"] });
  });
  it("真踩红线 + judge 本就 safety → 不重复进次因", () => {
    const a = resolveFailureAttribution({ redLineViolated: true, judgePrimary: "safety" });
    expect(a).toEqual({ primary: "safety", source: "redline", secondary: undefined });
  });
  it("红线题但裁判未引用红线条款(未真踩)+ judge 主因 → 尊重裁判,不强制 safety", () => {
    // 回归:旧逻辑会把这种失败一律强制成 safety,贴错标签;现在尊重裁判的实际归因。
    const a = resolveFailureAttribution({
      redLineViolated: false,
      judgePrimary: "knowledge",
      judgeSecondary: ["knowledge", "tool"],
    });
    expect(a).toEqual({ primary: "knowledge", source: "judge", secondary: ["tool"] });
  });
  it("未真踩 + judge 无主因 → null", () => {
    expect(resolveFailureAttribution({ redLineViolated: false, judgePrimary: null })).toBeNull();
  });
});
