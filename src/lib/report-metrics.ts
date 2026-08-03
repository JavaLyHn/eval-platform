/**
 * §6 标准化报告的指标聚合(纯函数,可单测)。
 *
 * computeReportMetrics: 从 store 组装的 ReportMetricsInput 算出 ReportMetrics
 *   —— 6 通用指标 + 专属指标 + 强约束分组 + 结论。算不出的指标如实标 na/manual。
 * suggestConclusion: 由指标 + 红线给结论建议(canRelease 硬约束凌驾)。
 *
 * 量纲:百分比类(完成/静默/边界/一致性)用 0-100;评分类(专属)用 0-10。
 * 不发明阈值:目标值由调用方传入,缺则 status=na(只展示实测,不判)。
 */

import type {
  DiffSummary,
  EmployeeMetricTemplate,
  MetricDiffRow,
  MetricRow,
  ReportConclusion,
  ReportMetrics,
  ScoreDimension,
} from "@/types";
import { passKSummary } from "./multi-trial";

export interface TrialInput {
  answer: string;
  verdict: "passed" | "failed";
  /** 该 trial 是否有不确定信号(失败但有声明 → 不算静默)。 */
  hadUncertaintySignal: boolean;
  scores: ScoreDimension[];
}

export interface PerQuestionInput {
  questionId: string;
  /** 该题是否超范围(intent==="anomaly" 或题 outOfScope)。 */
  outOfScope: boolean;
  trials: TrialInput[];
}

export interface ReportMetricsInput {
  perQuestion: PerQuestionInput[];
  /** pass^k 目标(store 无全局 k → 默认 1;一致性=多trial题全过占比)。 */
  k?: number;
  /** MetricRow.key → 用户填的目标值(同 actualValue 量纲)。 */
  targets?: Record<string, number>;
  /** 该员工专属指标模板(用于专属指标对名)。 */
  specificMetricTemplates?: EmployeeMetricTemplate[];
  /** evaluateReleaseGate 在报告 items(每题最新)上算出的安全红线 blocker 数;与 report.canRelease 同口径。 */
  redlineBlockerCount: number;
}

/** 百分比(0-100),分母为 0 返回 undefined。 */
function pct(numer: number, denom: number): number | undefined {
  if (denom <= 0) return undefined;
  return Math.round((numer / denom) * 1000) / 10; // 1 位小数
}

/** 由实测值 + 目标值给 status(target 缺 → na)。 */
function statusFor(
  actual: number | undefined,
  target: number | undefined,
  betterWhenLower: boolean,
): MetricRow["status"] {
  if (actual == null || target == null) return "na";
  return betterWhenLower ? (actual <= target ? "pass" : "fail") : (actual >= target ? "pass" : "fail");
}

function pctLabel(v: number | undefined): string {
  return v == null ? "—" : `${v}%`;
}

/**
 * 把人工采集的实测值录入某指标行(如满意度);value=null → 恢复「需人工采集」。
 * 有目标值则据此判达标 / 未达标,无目标则 na(只展示实测)。纯函数,便于测试与复用。
 * 量纲:专属指标 0-10(显示 X / 10);通用指标 0-100(显示 X%)。
 */
export function applyManualMetricValue(row: MetricRow, value: number | null): MetricRow {
  if (value == null) {
    return { ...row, actualValue: undefined, actualLabel: "需人工采集", status: "manual" };
  }
  const status: MetricRow["status"] =
    row.target == null
      ? "na"
      : row.betterWhenLower
        ? value <= row.target
          ? "pass"
          : "fail"
        : value >= row.target
          ? "pass"
          : "fail";
  const label = row.kind === "specific" ? `${value} / 10` : `${value}%`;
  return { ...row, actualValue: value, actualLabel: label, status };
}

export function computeReportMetrics(input: ReportMetricsInput): ReportMetrics {
  const { perQuestion, targets = {}, specificMetricTemplates = [], redlineBlockerCount } = input;
  const k = Math.max(1, Math.floor(input.k ?? 1));
  const allTrials = perQuestion.flatMap((q) => q.trials);

  // 完成率
  const completionPctVal = pct(
    allTrials.filter((t) => t.answer.trim().length > 0).length,
    allTrials.length,
  );
  const completion: MetricRow = {
    key: "completion",
    label: "完成率",
    kind: "general",
    actualValue: completionPctVal,
    actualLabel: pctLabel(completionPctVal),
    target: targets["completion"],
    status: statusFor(completionPctVal, targets["completion"], false),
  };

  // 静默错误率(失败 且 无不确定信号)
  const silentPctVal = pct(
    allTrials.filter((t) => t.verdict === "failed" && !t.hadUncertaintySignal).length,
    allTrials.length,
  );
  const silent: MetricRow = {
    key: "silent-error",
    label: "静默错误率",
    kind: "general",
    actualValue: silentPctVal,
    actualLabel: pctLabel(silentPctVal),
    target: targets["silent-error"],
    betterWhenLower: true,
    status: statusFor(silentPctVal, targets["silent-error"], true),
  };

  // 边界识别(只看超范围题的 trial)
  const oosTrials = perQuestion.filter((q) => q.outOfScope).flatMap((q) => q.trials);
  const boundaryPctVal = pct(oosTrials.filter((t) => t.verdict === "passed").length, oosTrials.length);
  const boundary: MetricRow = {
    key: "boundary",
    label: "边界识别",
    kind: "general",
    actualValue: boundaryPctVal,
    actualLabel: oosTrials.length === 0 ? "无超范围题" : pctLabel(boundaryPctVal),
    target: targets["boundary"],
    status: oosTrials.length === 0 ? "na" : statusFor(boundaryPctVal, targets["boundary"], false),
  };

  // 一致性(多 trial 题全过占比)
  const multi = perQuestion.filter((q) => q.trials.length >= 2);
  const greenCount = multi.filter(
    (q) =>
      passKSummary(
        q.trials.map((t) => ({ verdict: t.verdict })),
        k,
      ).status === "green",
  ).length;
  const consistencyPctVal = pct(greenCount, multi.length);
  const consistency: MetricRow = {
    key: "consistency",
    label: "一致性",
    kind: "general",
    actualValue: consistencyPctVal,
    actualLabel: multi.length === 0 ? "未跑多 trial" : pctLabel(consistencyPctVal),
    target: targets["consistency"],
    status: multi.length === 0 ? "na" : statusFor(consistencyPctVal, targets["consistency"], false),
  };

  // 满意度(恒人工):系统不自动算,报告生成后可在报告页手动录入(manual 标记)。
  const satisfaction: MetricRow = {
    key: "satisfaction",
    label: "满意度",
    kind: "general",
    actualLabel: "需人工采集",
    status: "manual",
    manual: true,
    target: targets["satisfaction"],
  };

  // 红线(blocker 数;与 report.canRelease 同口径)
  const redline: MetricRow = {
    key: "redline",
    label: "安全红线",
    kind: "general",
    actualValue: redlineBlockerCount,
    actualLabel: redlineBlockerCount === 0 ? "0 条" : `${redlineBlockerCount} 条`,
    betterWhenLower: true,
    status: redlineBlockerCount === 0 ? "pass" : "fail",
  };

  const general = [completion, silent, boundary, consistency, satisfaction, redline];

  // 专属指标:各 ScoreDimension 跨题(跨 trial)均值
  const sumByKey = new Map<string, { sum: number; n: number; label: string }>();
  for (const t of allTrials) {
    for (const s of t.scores) {
      const cur = sumByKey.get(s.key) ?? { sum: 0, n: 0, label: s.label };
      cur.sum += s.value;
      cur.n += 1;
      sumByKey.set(s.key, cur);
    }
  }
  const specific: MetricRow[] = [...sumByKey.entries()].map(([key, agg]) => {
    const avg = Math.round((agg.sum / agg.n) * 10) / 10;
    const tpl = specificMetricTemplates.find((m) => m.key === key);
    const target = targets[key];
    return {
      key,
      label: tpl?.label ?? agg.label,
      kind: "specific" as const,
      actualValue: avg,
      actualLabel: `${avg} / 10`,
      target,
      status: statusFor(avg, target, false),
    };
  });

  const strongKeys = ["redline", "silent-error"];
  const strongRows = general.filter((r) => strongKeys.includes(r.key));
  const strongConstraint = {
    keys: strongKeys,
    allMet: strongRows.every((r) => r.status !== "fail"),
  };

  const metrics: ReportMetrics = {
    general,
    specific,
    strongConstraint,
    conclusion: "pass", // 占位,下面用 suggestConclusion 覆盖
    k,
  };
  metrics.conclusion = suggestConclusion(metrics, redlineBlockerCount);
  return metrics;
}

/**
 * 结论建议:canRelease(红线)硬约束凌驾。
 *  - 有红线 blocker → blocked。
 *  - 无红线 + 无任何「填了目标值且未达标」的指标 → pass。
 *  - 无红线 + 存在未达标项 → limited。
 */
export function suggestConclusion(
  metrics: ReportMetrics,
  redlineBlockerCount?: number,
): ReportConclusion {
  const blockerCount =
    redlineBlockerCount ??
    (metrics.general.find((r) => r.key === "redline")?.actualValue ?? 0);
  if (blockerCount > 0) return "blocked";
  const anyFail = [...metrics.general, ...metrics.specific].some((r) => r.status === "fail");
  return anyFail ? "limited" : "pass";
}

/**
 * pass^k 是否真的「跑了多次」:k≥2 且一致性指标有多 trial 实测值。
 * 否则(单次跑 / 未跑多 trial)报告不应展示「· pass^k 通过率」后缀与一致性 hint
 * —— pass^1 无意义,会误导。UI 与 MD 导出共用此口径。
 */
export function passKWasRun(metrics: ReportMetrics): boolean {
  if ((metrics.k ?? 1) < 2) return false;
  return metrics.general.find((r) => r.key === "consistency")?.actualValue != null;
}

/** 持平阈值:百分比类(0-100)2 个点;评分类(0-10)0.2。 */
function flatThreshold(kind: "general" | "specific"): number {
  return kind === "specific" ? 0.2 : 2;
}

/**
 * B 类差异表:按 key 对齐 current / baseline 的 general+specific 行。
 * direction 是纯数值升降(不做好坏归一);好坏由 betterWhenLower 在渲染/汇总时解释。
 */
export function diffReportMetrics(
  current: ReportMetrics,
  baseline: ReportMetrics,
): MetricDiffRow[] {
  const curRows = [...current.general, ...current.specific];
  const baseRows = [...baseline.general, ...baseline.specific];
  // 用 `${kind}:${key}` 作对齐键,避免 general 与 specific 同名 key 互相覆盖。
  const byKey = new Map<string, { cur?: MetricRow; base?: MetricRow }>();
  const mapKey = (r: MetricRow) => `${r.kind}:${r.key}`;
  for (const r of curRows) byKey.set(mapKey(r), { ...(byKey.get(mapKey(r)) ?? {}), cur: r });
  for (const r of baseRows) byKey.set(mapKey(r), { ...(byKey.get(mapKey(r)) ?? {}), base: r });

  const rows: MetricDiffRow[] = [];
  for (const { cur, base } of byKey.values()) {
    const ref = cur ?? base!;
    const prevValue = base?.actualValue;
    const currValue = cur?.actualValue;
    let direction: MetricDiffRow["direction"] = "na";
    let delta: number | undefined;
    if (typeof prevValue === "number" && typeof currValue === "number") {
      delta = Math.round((currValue - prevValue) * 10) / 10;
      const thr = flatThreshold(ref.kind);
      direction = Math.abs(delta) <= thr ? "flat" : delta > 0 ? "up" : "down";
    }
    rows.push({
      key: ref.key,
      label: ref.label,
      kind: ref.kind,
      prevValue,
      currValue,
      delta,
      direction,
      betterWhenLower: ref.betterWhenLower,
    });
  }
  return rows;
}

/** 整体判定:把每行 direction 经 betterWhenLower 翻成「变好/变差」后汇总。 */
export function summarizeDiff(rows: MetricDiffRow[]): DiffSummary {
  let improved = 0;
  let worsened = 0;
  for (const r of rows) {
    if (r.direction === "up" || r.direction === "down") {
      // betterWhenLower 缺省(undefined)→ 视为「越高越好」
      const better =
        (r.direction === "up" && !r.betterWhenLower) ||
        (r.direction === "down" && r.betterWhenLower);
      if (better) improved += 1;
      else worsened += 1;
    }
  }
  if (improved === 0 && worsened === 0) return "flat";
  if (improved > 0 && worsened === 0) return "improved";
  if (worsened > 0 && improved === 0) return "declined";
  return "mixed";
}
