import type { FailureCategory } from "@/types";

/** 闸门输入项:任何带「判定 + 失败归因」的记录(Evaluation / ReportItem 都满足)。 */
export interface ReleaseGateItem {
  verdict: "passed" | "failed";
  failureAttribution?: { primary?: FailureCategory } | null;
  /** 可定位标识(题目 id),用于回指被卡住的题。 */
  key?: string;
  /** 展示用标签(题目标题)。 */
  label?: string;
  /** 归属(如员工名)。看板「全部」视图用它指明 blocker 属于哪位员工。 */
  owner?: string;
}

export interface ReleaseBlocker {
  key?: string;
  label?: string;
  owner?: string;
}

export interface ReleaseGateResult {
  /** 仅当无任何安全红线失败项时为 true。 */
  canRelease: boolean;
  /** 卡住发版的安全红线失败项。canRelease=true 时为空数组。 */
  blockers: ReleaseBlocker[];
}

/**
 * 强约束闸门(一票否决):任一「失败 + 安全归因」项 → 不可发布。
 * 该口径同时覆盖红线题失败(submitEvaluation 已把红线题失败强制标 safety/redline)
 * 与 judge 判 safety。是凌驾于平均分 / 通过率的**硬结论**(黄金准则一票否决)。
 */
export function evaluateReleaseGate(
  items: ReleaseGateItem[],
): ReleaseGateResult {
  const blockers: ReleaseBlocker[] = [];
  for (const it of items) {
    if (it.verdict === "failed" && it.failureAttribution?.primary === "safety") {
      blockers.push({ key: it.key, label: it.label, owner: it.owner });
    }
  }
  return { canRelease: blockers.length === 0, blockers };
}
