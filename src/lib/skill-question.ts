import type { Question, GroundTruthCheckKind } from "@/types";
import type { QuestionDraft } from "@/hooks/use-qa-store";
import type { SkillOptCase } from "./question-to-skillopt-case";
import { ALLOWED_CHECKS } from "./skillopt-case-gen";

/** kind=skill 即技能题(只用于 Skill 评测,不能发给 agent);旧题无 kind → 视为 agent。
 * 集中此处,确保所有"能否发给员工/进选题"判定口径一致。 */
export function isSkillQuestion(q: Pick<Question, "kind">): boolean {
  return (q.kind ?? "agent") === "skill";
}

/** 该技能的已存 skill 题:kind=skill 且 (员工, 技能) 匹配;员工或技能为空 → []。 */
export function filterSkillQuestions(
  questions: Question[],
  employeeId: string,
  skillName: string,
): Question[] {
  if (!employeeId || !skillName) return [];
  return questions.filter(
    (q) => q.kind === "skill" && q.targetEmployeeId === employeeId && q.targetSkill === skillName,
  );
}

/** 生成的 SkillOptCase → skill 题草稿(供 addQuestion 落库)。
 * interception → outOfScope=true(buildCaseSplits 据此还原为拦截题);checks 进 groundTruthChecks。 */
export function skillCaseToQuestionDraft(
  c: SkillOptCase,
  ctx: { employeeId: string; skillName: string },
): QuestionDraft {
  const isIntercept = c.caseType === "interception";
  const title = c.prompt.trim().slice(0, 40) || "(无题面)";
  return {
    kind: "skill",
    targetEmployeeId: ctx.employeeId,
    targetSkill: ctx.skillName,
    title,
    prompt: c.prompt,
    categories: [],
    difficulty: "medium",
    tags: [],
    criteria: [],
    hasGroundTruth: true,
    outOfScope: isIntercept,
    severity: isIntercept ? "P0" : "P2",
    intent: isIntercept ? "anomaly" : "typical",
    // 确定性 check kinds(用于徽标 / 合格判定);约束载荷与 caseType 全在 skilloptCase 里。
    groundTruthChecks: c.groundTruthChecks
      .filter((k): k is GroundTruthCheckKind => (ALLOWED_CHECKS as readonly string[]).includes(k))
      .map((k) => ({ kind: k })),
    // 单一 round-trip 载体:caseType + expected + checks 原样存 → questionToCase 据此三类保真还原
    // (interception / acceptAny+must-include / standard 意图金标都在 expected)。
    skilloptCase: {
      caseType: c.caseType,
      expected: c.expected,
      groundTruthChecks: c.groundTruthChecks,
    },
  };
}

/** skill 题的题型分类(与题库/导出/看板共用):显式 caseType 优先,否则按 outOfScope 兜底。 */
export function skillCaseType(
  q: Pick<Question, "skilloptCase" | "outOfScope">,
): "interception" | "acceptAny" | "standard" {
  return q.skilloptCase?.caseType ?? (q.outOfScope ? "interception" : "acceptAny");
}
