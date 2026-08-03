import { describe, expect, it } from "vitest";

import {
  nextQuestionNumber,
  normalizeQuestionNumbers,
  questionNumberPrefix,
} from "./question-number";

const q = (number: string, kind?: "agent" | "skill", createdAt = "2026-06-01T00:00:00Z") => ({
  number,
  kind,
  createdAt,
});

describe("questionNumberPrefix", () => {
  it("agent / 缺省 → A;skill → S", () => {
    expect(questionNumberPrefix("agent")).toBe("A");
    expect(questionNumberPrefix(undefined)).toBe("A");
    expect(questionNumberPrefix("skill")).toBe("S");
  });
});

describe("nextQuestionNumber", () => {
  it("空库从 001 起", () => {
    expect(nextQuestionNumber([], "agent")).toBe("A-001");
    expect(nextQuestionNumber([], "skill")).toBe("S-001");
  });

  it("两个序列互不干扰,取同前缀最大 +1", () => {
    const qs = [q("A-002", "agent"), q("A-007", "agent"), q("S-003", "skill")];
    expect(nextQuestionNumber(qs, "agent")).toBe("A-008");
    expect(nextQuestionNumber(qs, "skill")).toBe("S-004");
  });

  it("旧 Q- 号不计入序列", () => {
    expect(nextQuestionNumber([q("Q-047", "agent")], "agent")).toBe("A-001");
  });

  it("临时题不占库序列(算 max 时跳过)", () => {
    const qs = [q("A-005", "agent"), { ...q("A-009", "agent"), transient: true }];
    expect(nextQuestionNumber(qs, "agent")).toBe("A-006");
  });
});

describe("normalizeQuestionNumbers", () => {
  it("已密集且与顺序一致 → 原样返回(幂等)", () => {
    const qs = [q("A-001", "agent"), q("S-001", "skill"), q("A-002", "agent")];
    const r = normalizeQuestionNumbers(qs);
    expect(r.changed).toBe(false);
    expect(r.questions).toBe(qs);
  });

  it("旧 Q- 全局号 → 按数组顺序分种类密集重排", () => {
    const qs = [q("Q-003", "agent"), q("Q-001", "agent"), q("Q-002", "skill")];
    const r = normalizeQuestionNumbers(qs);
    expect(r.changed).toBe(true);
    expect(r.questions.map((x) => x.number)).toEqual(["A-001", "A-002", "S-001"]);
  });

  it("删中间留空号 → 重排回填,后面序号前移", () => {
    // [A-001, A-002, A-003] 删掉 A-002 → 入参 [A-001, A-003]
    const r = normalizeQuestionNumbers([q("A-001", "agent"), q("A-003", "agent")]);
    expect(r.changed).toBe(true);
    expect(r.questions.map((x) => x.number)).toEqual(["A-001", "A-002"]);
  });

  it("题号随数组顺序(手动重排后号跟着变)", () => {
    const r = normalizeQuestionNumbers([q("A-003", "agent"), q("A-001", "agent"), q("A-002", "agent")]);
    expect(r.changed).toBe(true);
    expect(r.questions.map((x) => x.number)).toEqual(["A-001", "A-002", "A-003"]);
  });

  it("前缀与 kind 不符 / 重号 也触发重排", () => {
    const dupe = normalizeQuestionNumbers([q("A-001", "agent"), q("A-001", "agent")]);
    expect(dupe.changed).toBe(true);
    expect(dupe.questions.map((x) => x.number)).toEqual(["A-001", "A-002"]);

    const wrongPrefix = normalizeQuestionNumbers([q("A-001", "skill")]);
    expect(wrongPrefix.changed).toBe(true);
    expect(wrongPrefix.questions[0].number).toBe("S-001");
  });

  it("临时题不占库序列:不计数、库号清空,非临时题仍密集(修复题库空号)", () => {
    // 中间夹一个临时题(老数据带号 A-002)→ 它不算库号、清空;前后非临时题密集 A-001 / A-002
    const r = normalizeQuestionNumbers([
      q("A-001", "agent"),
      { ...q("A-002", "agent"), transient: true },
      q("A-003", "agent"),
    ]);
    expect(r.changed).toBe(true);
    expect(r.questions.map((x) => x.number)).toEqual(["A-001", "", "A-002"]);
  });
});
