import type { AgentSkill } from "@/types";

/**
 * 内置技能集 —— 随代码打包的静态技能数据(含 SKILL.md 完整正文)。用于没有
 * live skills API 的 agent(如经 Gateway 网关接入的 demo 员工 Dex)。
 *
 * key = agent / 员工 id(二者对齐,如 "dex")。动态 import → 每个大 JSON
 * (含正文)单独打包,不压 main bundle。provider 的 listSkills 与「员工」卡的
 * 仓库技能块共用本模块,避免各写一份加载/映射逻辑。
 */

interface RawBundledSkill {
  id: string;
  name: string;
  description?: string;
  category?: string;
  body?: string;
  files?: Array<{ path: string; content: string }>;
}

const BUNDLED_SKILL_SETS: Record<string, () => Promise<unknown>> = {
  dex: () => import("@/data/dex-skills.json"),
};

/** 该 agent / 员工 是否有内置技能集。 */
export function hasBundledSkills(key: string): boolean {
  return key in BUNDLED_SKILL_SETS;
}

/** 加载内置技能集为 AgentSkill[](含完整正文 body);未知 key → 空数组。 */
export async function loadBundledSkills(key: string): Promise<AgentSkill[]> {
  const loader = BUNDLED_SKILL_SETS[key];
  if (!loader) return [];
  const mod = (await loader()) as {
    default?: { agent?: string; skills?: RawBundledSkill[] };
    agent?: string;
    skills?: RawBundledSkill[];
  };
  const data = mod.default ?? mod;
  return (data.skills ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    body: s.body,
    files: s.files,
  }));
}
