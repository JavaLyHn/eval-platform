import { aggregatePrimary } from "@/lib/failure-attribution";
import type {
  ScoreDimension,
  ScoringCriterion,
  FailureCategory,
  UncertaintySignal,
} from "@/types";

/** 单个裁判对一条回答的结构化判定。 */
export interface JudgeSnap {
  judgeProfileId: string;
  scores: ScoreDimension[];
  verdict: "passed" | "failed";
  notes: string;
  raw: string;
  failureCategory?: FailureCategory;
  uncertaintySignals?: UncertaintySignal[];
  /** 裁判引用的条款编号(1-based,对应 floorCandidates 顺序)。 */
  citedFloorRefs?: number[];
}

export interface JudgeAggregate {
  scores: ScoreDimension[];
  verdict: "passed" | "failed";
  notes: string;
  passCount: number;
  primary: FailureCategory | null;
}

/**
 * 聚合多裁判快照:均值分 + 多数判定 + 失败归因。与 runLLMJudge 原口径一致。
 * nameOf:把 judgeProfileId 解析成可读模型名,避免 notes 里出现 `[#1 ap_xxx]` 代号。
 */
export function aggregateJudgeSnapshots(
  snaps: JudgeSnap[],
  criteria: ScoringCriterion[],
  nameOf?: (judgeProfileId: string) => string,
): JudgeAggregate {
  const scores: ScoreDimension[] = criteria.map((c) => {
    const dimAvg =
      snaps.reduce((sum, s) => sum + (s.scores.find((x) => x.key === c.key)?.value ?? 0), 0) /
      (snaps.length || 1);
    return { key: c.key, label: c.label, max: 10, value: Math.round(dimAvg * 10) / 10 };
  });
  const passCount = snaps.filter((s) => s.verdict === "passed").length;
  const verdict: "passed" | "failed" = passCount > snaps.length / 2 ? "passed" : "failed";
  const primary = aggregatePrimary(snaps.map((s) => s.failureCategory));
  const label = (s: JudgeSnap) => nameOf?.(s.judgeProfileId) ?? s.judgeProfileId;
  const notes =
    snaps.length > 1
      ? `校准 ${snaps.length} 位裁判 · 通过 ${passCount} / ${snaps.length}\n\n` +
        snaps
          .map((s) => `[${label(s)}] ${s.verdict === "passed" ? "通过" : "失败"}：${s.notes}`)
          .join("\n")
      : (snaps[0]?.notes ?? "");
  return { scores, verdict, notes, passCount, primary };
}

/** 多裁判 Pass/Fail 一致率%(≤1 裁判 → undefined)。 */
export function agreementRateOf(snaps: JudgeSnap[]): number | undefined {
  if (snaps.length <= 1) return undefined;
  const passCount = snaps.filter((s) => s.verdict === "passed").length;
  return Math.round((Math.max(passCount, snaps.length - passCount) / snaps.length) * 100);
}
