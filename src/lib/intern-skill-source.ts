import type { AgentSkill } from "@/types";
import type { AgentRepoSkillSummary } from "@/lib/agent-repo";
import { loadBundledSkills } from "@/lib/bundled-skills";

/** Dex 的员工 / agent id(与 bundled-skills key 对齐)。 */
export const INTERN_EMP = "dex";

/** bundled AgentSkill[] → agent-repo 技能摘要形状(name/description/version)。纯函数。 */
export function bundledToSkillSummaries(skills: AgentSkill[]): AgentRepoSkillSummary[] {
  return skills.map((s) => ({
    name: s.name,
    description: s.description ?? "",
    version: null,
  }));
}

/** Dex 技能列表(bundled)→ 摘要,供技能选择器复用现有渲染。 */
export async function loadInternSkillSummaries(): Promise<AgentRepoSkillSummary[]> {
  return bundledToSkillSummaries(await loadBundledSkills(INTERN_EMP));
}

/** Dex 某技能的 SKILL.md 正文;找不到 → 空串(与 repo 取正文失败同等降级)。 */
export async function loadInternSkillBody(name: string): Promise<string> {
  const skills = await loadBundledSkills(INTERN_EMP);
  return skills.find((s) => s.name === name)?.body ?? "";
}
