import { describe, it, expect } from "vitest";
import { probeStat, buildFloorReport } from "./floor-report-logic";
import type { Evaluation, FloorElement, Question } from "@/types";

const ev = (
  questionId: string,
  verdict: "passed" | "failed",
  extra: Partial<Evaluation> = {},
): Evaluation =>
  ({
    id: `e_${questionId}_${verdict}_${Math.round(0)}_${extra.agreementRate ?? ""}`,
    questionId,
    messageId: "m",
    scores: [],
    notes: "",
    verdict,
    submittedAt: "2026-06-01T00:00:00.000Z",
    ...extra,
  }) as Evaluation;

const elem = (
  id: string,
  isRedLine: boolean,
): FloorElement =>
  ({
    id,
    employeeId: "aria",
    layer: "L2",
    category: "audit-security",
    title: id,
    passForm: "p",
    failForm: "f",
    isRedLine,
    source: "manual",
    createdAt: "t",
  }) as FloorElement;

const q = (id: string, elementIds: string[]): Question =>
  ({
    id,
    number: id,
    title: id,
    prompt: "",
    categories: [],
    difficulty: "medium",
    tags: [],
    status: "tested",
    criteria: [],
    createdAt: "t",
    floorElementIds: elementIds,
  }) as Question;

describe("probeStat", () => {
  it("3 次全过、k=3 → passPowerK 真、passAtK 真", () => {
    const s = probeStat(
      "q1",
      [ev("q1", "passed"), ev("q1", "passed"), ev("q1", "passed")],
      3,
    );
    expect(s.trials).toBe(3);
    expect(s.passed).toBe(3);
    expect(s.passPowerK).toBe(true);
    expect(s.passAtK).toBe(true);
  });

  it("3 次里 1 次挂 → passPowerK 假、passAtK 真", () => {
    const s = probeStat(
      "q1",
      [ev("q1", "passed"), ev("q1", "failed"), ev("q1", "passed")],
      3,
    );
    expect(s.passPowerK).toBe(false);
    expect(s.passAtK).toBe(true);
  });

  it("trial 数 < k → passPowerK 假（覆盖不足）", () => {
    const s = probeStat("q1", [ev("q1", "passed")], 3);
    expect(s.trials).toBe(1);
    expect(s.passPowerK).toBe(false);
  });

  it("任一 trial agreementRate<85 → lowConfidence 真", () => {
    const s = probeStat(
      "q1",
      [ev("q1", "passed"), ev("q1", "passed", { agreementRate: 70 })],
      2,
    );
    expect(s.lowConfidence).toBe(true);
  });

  it("autoScore 过半未满（全挂）→ partialScore 真、passAtK 假", () => {
    const s = probeStat(
      "q1",
      [
        ev("q1", "failed", { autoScore: 7 }),
        ev("q1", "failed", { autoScore: 7 }),
        ev("q1", "failed", { autoScore: 7 }),
      ],
      3,
    );
    expect(s.passAtK).toBe(false);
    expect(s.partialScore).toBe(true);
  });
});

describe("buildFloorReport", () => {
  const base = { employeeId: "aria", k: 3 };

  it("红线要素：探针 3/3 过 → 绿；整体达标", () => {
    const r = buildFloorReport({
      ...base,
      elements: [elem("E1", true)],
      questions: [q("q1", ["E1"])],
      evaluations: [ev("q1", "passed"), ev("q1", "passed"), ev("q1", "passed")],
    });
    expect(r.elements[0].status).toBe("green");
    expect(r.verdict).toBe("达标");
  });

  it("红线要素：任一 trial 破 → 红（一票否决）；整体未达且点名", () => {
    const r = buildFloorReport({
      ...base,
      elements: [elem("E1", true)],
      questions: [q("q1", ["E1"])],
      evaluations: [ev("q1", "passed"), ev("q1", "failed"), ev("q1", "passed")],
    });
    expect(r.elements[0].status).toBe("red");
    expect(r.verdict).toBe("未达");
    expect(r.reasons.join()).toContain("E1");
  });

  it("非红线：pass@k 过但 pass^k 不过（2/3）→ 黄（部分/不稳定）→ 未达", () => {
    const r = buildFloorReport({
      ...base,
      elements: [elem("E2", false)],
      questions: [q("q2", ["E2"])],
      evaluations: [ev("q2", "passed"), ev("q2", "failed"), ev("q2", "passed")],
    });
    expect(r.elements[0].status).toBe("partial");
    expect(r.verdict).toBe("未达");
  });

  it("非红线：0/3 全挂 → 红", () => {
    const r = buildFloorReport({
      ...base,
      elements: [elem("E2", false)],
      questions: [q("q2", ["E2"])],
      evaluations: [ev("q2", "failed"), ev("q2", "failed"), ev("q2", "failed")],
    });
    expect(r.elements[0].status).toBe("red");
  });

  it("无探针 / trial<k → 未覆盖（⚪）→ 未达", () => {
    const noProbe = buildFloorReport({
      ...base,
      elements: [elem("E3", false)],
      questions: [],
      evaluations: [],
    });
    expect(noProbe.elements[0].status).toBe("uncovered");
    expect(noProbe.verdict).toBe("未达");
  });

  it("非红线：3/3 全过 → 绿", () => {
    const r = buildFloorReport({
      ...base,
      elements: [elem("E2", false)],
      questions: [q("q2", ["E2"])],
      evaluations: [ev("q2", "passed"), ev("q2", "passed"), ev("q2", "passed")],
    });
    expect(r.elements[0].status).toBe("green");
    expect(r.verdict).toBe("达标");
  });

  it("非红线：全挂但 autoScore 过半 → 黄（partialScore 触发）", () => {
    const r = buildFloorReport({
      ...base,
      elements: [elem("E2", false)],
      questions: [q("q2", ["E2"])],
      evaluations: [
        ev("q2", "failed", { autoScore: 7 }),
        ev("q2", "failed", { autoScore: 7 }),
        ev("q2", "failed", { autoScore: 7 }),
      ],
    });
    expect(r.elements[0].status).toBe("partial");
  });

  it("按 agentProfileId 过滤评测", () => {
    const r = buildFloorReport({
      ...base,
      elements: [elem("E1", true)],
      questions: [q("q1", ["E1"])],
      evaluations: [
        ev("q1", "passed", { agentProfileId: "pA" }),
        ev("q1", "passed", { agentProfileId: "pA" }),
        ev("q1", "passed", { agentProfileId: "pA" }),
        ev("q1", "failed", { agentProfileId: "pB" }),
      ],
      agentProfileId: "pA",
    });
    expect(r.elements[0].status).toBe("green");
  });
});
