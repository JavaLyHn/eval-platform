import { describe, it, expect } from "vitest";
import {
  resolveQuestionType,
  TYPE_CRITERIA,
  QUESTION_TYPE_META,
  questionIsRedLine,
  criteriaForQuestion,
} from "./question-type";
import type { FloorElement } from "@/types";

describe("resolveQuestionType", () => {
  it("红线优先级最高", () => {
    expect(resolveQuestionType({ outOfScope: true, hasGroundTruth: true }, true)).toBe("redline");
  });
  it("超范围(非红线)", () => {
    expect(resolveQuestionType({ outOfScope: true, hasGroundTruth: true }, false)).toBe("outOfScope");
  });
  it("客观(非红线非超范围)", () => {
    expect(resolveQuestionType({ hasGroundTruth: true }, false)).toBe("groundTruth");
  });
  it("默认能力题", () => {
    expect(resolveQuestionType({}, false)).toBe("capability");
  });
});

describe("TYPE_CRITERIA / META", () => {
  it("每题型维度权重和≈1", () => {
    for (const t of ["redline", "outOfScope", "groundTruth", "capability"] as const) {
      const sum = TYPE_CRITERIA[t].reduce((s, c) => s + c.weight, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    }
  });
  it("每题型有 label 与 primaryRule", () => {
    for (const t of ["redline", "outOfScope", "groundTruth", "capability"] as const) {
      expect(QUESTION_TYPE_META[t].label.length).toBeGreaterThan(0);
      expect(QUESTION_TYPE_META[t].primaryRule.length).toBeGreaterThan(0);
    }
  });
});

describe("questionIsRedLine(集中红线判定)", () => {
  const redLineEl = { id: "f1", isRedLine: true } as unknown as FloorElement;
  const normalEl = { id: "f2", isRedLine: false } as unknown as FloorElement;

  it("显式 isRedLine=true → 红线(不依赖 floor)", () => {
    expect(questionIsRedLine({ isRedLine: true }, [])).toBe(true);
  });
  it("挂了红线下限要素 → 红线", () => {
    expect(questionIsRedLine({ floorElementIds: ["f1"] }, [redLineEl])).toBe(true);
  });
  it("只挂非红线要素 + 无显式标志 → 不是红线", () => {
    expect(questionIsRedLine({ floorElementIds: ["f2"] }, [normalEl])).toBe(false);
  });
  it("两者皆无 → 不是红线", () => {
    expect(questionIsRedLine({}, [])).toBe(false);
  });
});

describe("criteriaForQuestion(题型↔维度对齐唯一来源)", () => {
  const redLineEl = { id: "f1", isRedLine: true } as unknown as FloorElement;
  const keys = (q: Parameters<typeof criteriaForQuestion>[0], fes: FloorElement[]) =>
    criteriaForQuestion(q, fes).map((c) => c.key);

  it("显式红线 → 红线维度(拒绝到位/零泄露/合规引导)", () => {
    expect(keys({ isRedLine: true }, [])).toEqual(TYPE_CRITERIA.redline.map((c) => c.key));
  });
  it("outOfScope=true(非红线) → 超范围维度,而非能力维度", () => {
    expect(keys({ outOfScope: true }, [])).toEqual(TYPE_CRITERIA.outOfScope.map((c) => c.key));
  });
  it("hasGroundTruth → 客观题维度", () => {
    expect(keys({ hasGroundTruth: true }, [])).toEqual(TYPE_CRITERIA.groundTruth.map((c) => c.key));
  });
  it("普通题 → 能力维度", () => {
    expect(keys({}, [])).toEqual(TYPE_CRITERIA.capability.map((c) => c.key));
  });
  it("红线优先于 outOfScope(同时命中取红线维度)", () => {
    expect(keys({ outOfScope: true, floorElementIds: ["f1"] }, [redLineEl])).toEqual(
      TYPE_CRITERIA.redline.map((c) => c.key),
    );
  });
});
