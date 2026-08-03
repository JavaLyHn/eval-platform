import { describe, expect, it } from "vitest";
import {
  selectQuestionsForExport,
  defaultExportFilename,
  normalizeExportFilename,
  type ExportCriteria,
} from "./bank-export";
import type { Question } from "@/types";

function q(over: Partial<Question>): Question {
  return {
    id: over.id ?? "q1",
    number: "1",
    title: "t",
    prompt: "p",
    subPrompts: [],
    difficulty: "easy",
    tags: [],
    categories: [],
    createdAt: "2026-07-24T00:00:00.000Z",
    ...over,
  } as Question;
}

const ALL: ExportCriteria = { employee: "all" };

describe("selectQuestionsForExport", () => {
  it("按 kind 分流 + 排除 transient", () => {
    const qs = [
      q({ id: "a", kind: "agent" }),
      q({ id: "s", kind: "skill" }),
      q({ id: "t", kind: "agent", transient: true }),
    ];
    expect(selectQuestionsForExport(qs, "agent", ALL).map((x) => x.id)).toEqual(["a"]);
    expect(selectQuestionsForExport(qs, "skill", ALL).map((x) => x.id)).toEqual(["s"]);
  });

  it("agent:员工 + 严重度 + 意图", () => {
    const qs = [
      q({ id: "a1", kind: "agent", targetEmployeeId: "aria", severity: "P0", intent: "typical" }),
      q({ id: "a2", kind: "agent", targetEmployeeId: "aria", severity: "P2", intent: "anomaly" }),
      q({ id: "a3", kind: "agent", targetEmployeeId: "sam", severity: "P0", intent: "typical" }),
    ];
    expect(
      selectQuestionsForExport(qs, "agent", { employee: "aria" }).map((x) => x.id),
    ).toEqual(["a1", "a2"]);
    expect(
      selectQuestionsForExport(qs, "agent", { employee: "all", severities: ["P0"] }).map((x) => x.id),
    ).toEqual(["a1", "a3"]);
    expect(
      selectQuestionsForExport(qs, "agent", { employee: "all", intents: ["anomaly"] }).map((x) => x.id),
    ).toEqual(["a2"]);
  });

  it("skill:题型 + 技能(技能过滤仅在选定员工时生效)", () => {
    const qs = [
      q({ id: "s1", kind: "skill", targetEmployeeId: "aria", targetSkill: "sk-a", outOfScope: false }),
      q({ id: "s2", kind: "skill", targetEmployeeId: "aria", targetSkill: "sk-b", outOfScope: true }),
      q({ id: "s3", kind: "skill", targetEmployeeId: "dex", targetSkill: "sk-c", skilloptCase: { caseType: "standard" } as never }),
    ];
    expect(
      selectQuestionsForExport(qs, "skill", { employee: "all", caseTypes: ["interception"] }).map((x) => x.id),
    ).toEqual(["s2"]);
    expect(
      selectQuestionsForExport(qs, "skill", { employee: "all", caseTypes: ["standard"] }).map((x) => x.id),
    ).toEqual(["s3"]);
    // 技能过滤:employee=all 时忽略 skills
    expect(
      selectQuestionsForExport(qs, "skill", { employee: "all", skills: ["sk-a"] }).map((x) => x.id).sort(),
    ).toEqual(["s1", "s2", "s3"]);
    // 选定员工后 skills 生效
    expect(
      selectQuestionsForExport(qs, "skill", { employee: "aria", skills: ["sk-a"] }).map((x) => x.id),
    ).toEqual(["s1"]);
  });

  it("空结果", () => {
    expect(selectQuestionsForExport([], "agent", ALL)).toEqual([]);
  });
});

describe("文件名", () => {
  it("defaultExportFilename", () => {
    expect(defaultExportFilename("agent", "2026-07-24")).toBe("qa-questions-agent-2026-07-24.json");
    expect(defaultExportFilename("skill", "2026-07-24")).toBe("qa-questions-skill-2026-07-24.json");
  });
  it("normalizeExportFilename:补 .json / 去非法字符 / 空兜底", () => {
    expect(normalizeExportFilename("my export", "agent", "2026-07-24")).toBe("my export.json");
    expect(normalizeExportFilename("a/b:c*.json", "agent", "2026-07-24")).toBe("a-b-c.json");
    expect(normalizeExportFilename("   ", "skill", "2026-07-24")).toBe("qa-questions-skill-2026-07-24.json");
    expect(normalizeExportFilename("keep.json", "agent", "2026-07-24")).toBe("keep.json");
  });
});
