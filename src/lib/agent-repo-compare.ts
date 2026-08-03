import type { AgentRepoSkillSummary } from "./agent-repo";

/** repo 目录名 → 标准员工 id(STANDARD_EMPLOYEES 的 id);无平台对应 → null。 */
const REPO_TO_STANDARD: Record<string, string | null> = {
  aria: "aria",
  "sam-user": "sam",
  dex: "dex",
  "sam-customer": null,
  duncan: null,
};

export function repoEmpToStandardId(dir: string): string | null {
  return dir in REPO_TO_STANDARD ? REPO_TO_STANDARD[dir] : null;
}

/** 标准员工 id → repo 目录名(repoEmpToStandardId 的反查);无对应 → null。 */
export function standardIdToRepoEmp(stdId: string): string | null {
  for (const [dir, sid] of Object.entries(REPO_TO_STANDARD)) {
    if (sid === stdId) return dir;
  }
  return null;
}

export type SkillStatus = "both-same" | "both-version-diff" | "repo-only" | "platform-only";

export interface ReconcileRow {
  name: string;
  repoVersion: string | null;
  platformVersion: string | null;
  status: SkillStatus;
}

interface PlatformLike {
  name: string;
  version?: string | null;
}

const norm = (s: string) => s.trim().toLowerCase();

export function reconcileSkills(repo: AgentRepoSkillSummary[], platform: PlatformLike[]): ReconcileRow[] {
  // 假设:同一来源内 normalized name 唯一(repo 技能目录名/platform 技能名各自不重)。
  // 若 platform 有重名,Map 保留最后一条;若 repo 有重名,会产出多行同名 row。
  const platformByName = new Map(platform.map((s) => [norm(s.name), s]));
  const seen = new Set<string>();
  const rows: ReconcileRow[] = [];

  for (const r of repo) {
    const key = norm(r.name);
    seen.add(key);
    const o = platformByName.get(key);
    const rv = r.version ?? null;
    if (!o) {
      rows.push({ name: r.name, repoVersion: rv, platformVersion: null, status: "repo-only" });
      continue;
    }
    const ov = o.version ?? null;
    const status: SkillStatus = rv !== null && ov !== null && rv !== ov ? "both-version-diff" : "both-same";
    rows.push({ name: r.name, repoVersion: rv, platformVersion: ov, status });
  }
  for (const o of platform) {
    if (!seen.has(norm(o.name))) {
      rows.push({ name: o.name, repoVersion: null, platformVersion: o.version ?? null, status: "platform-only" });
    }
  }
  return rows;
}

export interface ReconcileSummary {
  total: number;
  same: number;
  versionDiff: number;
  repoOnly: number;
  platformOnly: number;
}

export function reconcileSummary(rows: ReconcileRow[]): ReconcileSummary {
  return {
    total: rows.length,
    same: rows.filter((r) => r.status === "both-same").length,
    versionDiff: rows.filter((r) => r.status === "both-version-diff").length,
    repoOnly: rows.filter((r) => r.status === "repo-only").length,
    platformOnly: rows.filter((r) => r.status === "platform-only").length,
  };
}
