import type { Evaluation, FloorElement, Question } from "@/types";

export type ElementStatus = "green" | "red" | "partial" | "uncovered";

export interface ProbeStat {
  questionId: string;
  trials: number;
  passed: number;
  /** k 次全过且 trials≥k（保下限取这个）。 */
  passPowerK: boolean;
  /** 至少 1 次过。 */
  passAtK: boolean;
  /** 多组件部分达成：平均 autoScore 过半未满（非红线用）。 */
  partialScore: boolean;
  /** 任一 trial 的多 judge 一致率 < AGREEMENT_THRESHOLD。agreementRate 缺省（如人工评/未校准）视为非低置信。 */
  lowConfidence: boolean;
}

export interface ElementReport {
  element: FloorElement;
  probes: ProbeStat[];
  status: ElementStatus;
  lowConfidence: boolean;
}

export interface FloorReport {
  employeeId: string;
  k: number;
  elements: ElementReport[];
  verdict: "达标" | "未达";
  /** 未达时点名的要素（title + 状态）。 */
  reasons: string[];
  redCount: number;
  partialCount: number;
  uncoveredCount: number;
  greenCount: number;
}

/** 平台满分口径（与 ScoreDimension.max 一致）。 */
export const PLATFORM_MAX_SCORE = 10;
/** 多 judge 一致率达标线（黄金准则 ≥85%）。低于则标低置信、待人工抽审。 */
export const AGREEMENT_THRESHOLD = 85;
/** Phase 1 默认目标 trial 次数（pass^k 的 k）。 */
export const DEFAULT_K = 3;

/** 单道探针在 k 下的统计。 */
export function probeStat(
  questionId: string,
  evals: Evaluation[],
  k: number,
): ProbeStat {
  const trials = evals.length;
  const passed = evals.filter((e) => e.verdict === "passed").length;
  const scored = evals.filter((e) => typeof e.autoScore === "number");
  const avgScore =
    scored.length > 0
      ? scored.reduce((s, e) => s + (e.autoScore ?? 0), 0) / scored.length
      : null;
  return {
    questionId,
    trials,
    passed,
    passPowerK: trials >= k && passed === trials && trials > 0,
    passAtK: passed >= 1,
    partialScore:
      avgScore != null && avgScore > PLATFORM_MAX_SCORE / 2 && avgScore < PLATFORM_MAX_SCORE,
    lowConfidence: evals.some(
      (e) => typeof e.agreementRate === "number" && e.agreementRate < AGREEMENT_THRESHOLD,
    ),
  };
}

function elementStatus(
  element: FloorElement,
  probes: ProbeStat[],
  k: number,
): ElementStatus {
  const covered = probes.filter((p) => p.trials >= k);
  if (probes.length === 0 || covered.length === 0) return "uncovered";

  if (element.isRedLine) {
    // 红线：任一已覆盖探针没全过 = 破 = 一票否决。
    return covered.some((p) => !p.passPowerK) ? "red" : "green";
  }

  // 非红线
  if (covered.every((p) => p.passPowerK)) return "green";
  const anyPartial = covered.some((p) => p.passAtK || p.partialScore);
  return anyPartial ? "partial" : "red";
}

export function buildFloorReport(args: {
  employeeId: string;
  k: number;
  elements: FloorElement[];
  questions: Question[];
  evaluations: Evaluation[];
  agentProfileId?: string;
}): FloorReport {
  const { employeeId, k, elements, questions, evaluations, agentProfileId } =
    args;
  const kEff = Math.max(1, Math.floor(k));

  const elementReports: ElementReport[] = elements.map((element) => {
    const probeQs = questions.filter((qq) =>
      (qq.floorElementIds ?? []).includes(element.id),
    );
    const probes: ProbeStat[] = probeQs.map((qq) => {
      const evals = evaluations.filter(
        (e) =>
          e.questionId === qq.id &&
          (!agentProfileId || e.agentProfileId === agentProfileId),
      );
      return probeStat(qq.id, evals, kEff);
    });
    const status = elementStatus(element, probes, kEff);
    return {
      element,
      probes,
      status,
      lowConfidence: probes.some((p) => p.lowConfidence),
    };
  });

  const redCount = elementReports.filter((e) => e.status === "red").length;
  const partialCount = elementReports.filter(
    (e) => e.status === "partial",
  ).length;
  const uncoveredCount = elementReports.filter(
    (e) => e.status === "uncovered",
  ).length;
  const greenCount = elementReports.filter((e) => e.status === "green").length;

  const reasons = elementReports
    .filter((e) => e.status !== "green")
    .map((e) => {
      const label =
        e.status === "red"
          ? "🔴破"
          : e.status === "partial"
            ? "🟡部分"
            : "⚪未覆盖";
      return `${e.element.title}（${label}）`;
    });

  // 达标 = 全绿（无红、无黄、无未覆盖）。低置信是软标记，不改判定。
  const verdict: "达标" | "未达" =
    elementReports.length > 0 &&
    redCount === 0 &&
    partialCount === 0 &&
    uncoveredCount === 0
      ? "达标"
      : "未达";

  return {
    employeeId,
    k: kEff,
    elements: elementReports,
    verdict,
    reasons,
    redCount,
    partialCount,
    uncoveredCount,
    greenCount,
  };
}
