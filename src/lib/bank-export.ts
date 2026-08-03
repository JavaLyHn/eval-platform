import type { Question } from "@/types";
import { skillCaseType } from "./skill-question";

/** 导出分类条件(agent 用 severities/intents;skill 用 caseTypes/skills)。空数组/未给 = 不限。 */
export interface ExportCriteria {
  employee: string; // "all" | employeeId
  severities?: string[];
  intents?: string[];
  caseTypes?: string[];
  skills?: string[];
}

/**
 * 从题库选出要导出的子集:排除 transient、按 kind + 分类过滤。
 * 分类判定与 LibraryPage 的 filtered 中「员工 + severity/intent(agent)/ caseType/skill(skill)」逐条一致。
 * 技能(skills)过滤只在选定具体员工(employee !== "all")时生效 —— 与页面一致。
 */
export function selectQuestionsForExport(
  questions: Question[],
  kind: "agent" | "skill",
  c: ExportCriteria,
): Question[] {
  return questions.filter((q) => {
    if (q.transient) return false;
    if ((q.kind ?? "agent") !== kind) return false;
    if (c.employee !== "all" && q.targetEmployeeId !== c.employee) return false;
    if (kind === "agent") {
      if (c.severities?.length && !c.severities.includes(q.severity ?? "")) return false;
      if (c.intents?.length && !c.intents.includes(q.intent ?? "")) return false;
    } else {
      if (c.caseTypes?.length && !c.caseTypes.includes(skillCaseType(q))) return false;
      if (c.employee !== "all" && c.skills?.length && !c.skills.includes(q.targetSkill ?? ""))
        return false;
    }
    return true;
  });
}

/** 默认导出文件名:qa-questions-<kind>-<YYYY-MM-DD>.json。 */
export function defaultExportFilename(kind: "agent" | "skill", isoDate: string): string {
  return `qa-questions-${kind}-${isoDate}.json`;
}

/** 清洗用户输入的文件名:去文件系统非法字符、保证 .json 后缀、空则回默认名。 */
export function normalizeExportFilename(
  name: string,
  kind: "agent" | "skill",
  isoDate: string,
): string {
  let base = name.trim();
  // 去掉已有 .json 再统一补(避免 a.json.json / 大小写)
  base = base.replace(/\.json$/i, "");
  // 文件系统非法字符 / 斜杠 / 冒号 / 星号等 → 连字符,并收敛连续连字符,去掉首尾连字符
  base = base.replace(/[\\/:*?"<>|]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  if (!base) return defaultExportFilename(kind, isoDate);
  return `${base}.json`;
}
