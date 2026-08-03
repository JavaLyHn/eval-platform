import type { EvaluatorRef } from "@/types";
import type { SkillOptCase, SkillOptDoneFrame, SkillOptSummary } from "./skillopt-client";
import { CALIBRATION_THRESHOLD } from "./calibration";

export interface SkillReportMeta {
  targetLabel: string;
  /** 该 skill 归属的员工 / Agent 名(没绑定标准员工时为空)。 */
  employeeLabel?: string;
  targetModel: string;
  optimizerModel: string;
  epochs: number;
  gateMetric?: string;
  skillUpdateMode?: string;
  wallTimeS: number;
  tokens: SkillOptSummary["tokens"];
}

export interface SkillEvalReport {
  id: string;
  createdAt: string;
  title: string;
  owner?: EvaluatorRef;
  meta: SkillReportMeta;
  frame: SkillOptDoneFrame;
  logs: string[];
  audit?: { marks: SkillAuditMark[]; thresholds?: ReleaseGateThresholds };
}

/** 保存时从页面取的配置(模型/gate/updateMode 可空)。 */
export interface SkillReportConfig {
  caseSourceLabel: string;
  /** 该 skill 归属的员工 / Agent 名(可空)。 */
  employeeLabel?: string;
  targetModel?: string;
  optimizerModel?: string;
  epochs: number;
  gateMetric?: string;
  skillUpdateMode?: string;
}

/** 页面配置 + done 帧 summary → 报告元信息(模型留空回落 summary.model)。 */
export function composeSkillReportMeta(config: SkillReportConfig, summary: SkillOptSummary): SkillReportMeta {
  const targetModel = config.targetModel?.trim() || summary.model;
  const optimizerModel = config.optimizerModel?.trim() || targetModel;
  return {
    targetLabel: config.caseSourceLabel,
    employeeLabel: config.employeeLabel?.trim() || undefined,
    targetModel,
    optimizerModel,
    epochs: config.epochs,
    gateMetric: config.gateMetric?.trim() || undefined,
    skillUpdateMode: config.skillUpdateMode?.trim() || undefined,
    wallTimeS: summary.wallTimeS,
    tokens: summary.tokens,
  };
}

/** 预填标题:被测对象 · 模型 · 到分钟(createdAt 取 ISO 前 16 位,T→空格)。 */
export function defaultSkillReportTitle(meta: SkillReportMeta, createdAt: string): string {
  const when = createdAt.slice(0, 16).replace("T", " ");
  return `${meta.targetLabel} · ${meta.targetModel} · ${when}`;
}

export interface SkillReportStats {
  baselineSoft: number | null;
  bestSoft: number | null;
  passN: number;
  total: number;
}

/** 列表行「关键指标」:留出集 soft 基线→最优 + 通过 N/total。 */
export function skillReportStats(r: SkillEvalReport): SkillReportStats {
  const s = r.frame.summary;
  const cases = r.frame.cases;
  return {
    baselineSoft: s.baselineTestSoft,
    bestSoft: s.testSoft,
    passN: cases ? cases.filter((c) => c.bestHard === 1).length : 0,
    total: cases?.length ?? 0,
  };
}

// ── 校准/抽审 + 发版门 ───────────────────────────────────────────────

export interface SkillAuditMark {
  caseId: string;
  autoCorrect: boolean; // 人判:该题 auto 判分(bestHard)对不对
  note?: string;
  reviewer?: EvaluatorRef;
  reviewedAt: string; // ISO
}

export interface ReleaseGateThresholds {
  agreePct: number; // 校准一致率门槛(用户填,默认 85)
  coveragePct: number; // 覆盖门槛(用户填,默认 100 = 审满)
}

export const DEFAULT_GATE_THRESHOLDS: ReleaseGateThresholds = {
  agreePct: CALIBRATION_THRESHOLD, // 85,不重复字面量
  coveragePct: 100,
};

const clampPct = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;

/** 写/覆盖一条 audit 标注(同 caseId 覆盖)。纯函数,不改原报告。 */
export function upsertAuditMark(report: SkillEvalReport, mark: SkillAuditMark): SkillEvalReport {
  const audit = report.audit ?? { marks: [] };
  const marks = [...audit.marks.filter((m) => m.caseId !== mark.caseId), mark];
  return { ...report, audit: { ...audit, marks } };
}

/** 写门槛(clamp 0–100 整数)。纯函数,不改原报告。 */
export function withThresholds(report: SkillEvalReport, t: ReleaseGateThresholds): SkillEvalReport {
  const audit = report.audit ?? { marks: [] };
  return {
    ...report,
    audit: { ...audit, thresholds: { agreePct: clampPct(t.agreePct), coveragePct: clampPct(t.coveragePct) } },
  };
}

export interface CalibrationSummary {
  heldoutTotal: number;
  reviewed: number;
  coveragePct: number | null;
  agreePct: number | null;
  overturns: number;
  redlineOverturns: number;
  thresholds: ReleaseGateThresholds;
  gatePass: boolean;
}

/** 对留出集 best rollout 统计抽审覆盖 + 校准一致 + 红线翻案;门槛取报告 thresholds 或默认。 */
export function calibrationSummary(report: SkillEvalReport): CalibrationSummary {
  const cases: SkillOptCase[] = report.frame.cases ?? [];
  const heldoutTotal = cases.length;
  const thresholds = report.audit?.thresholds ?? DEFAULT_GATE_THRESHOLDS;
  const caseTypeById = new Map(cases.map((c) => [c.id, c.caseType]));
  // 只计落在本报告留出题集内的标注(快照不变,caseId 稳定;防御性过滤)
  const filtered = (report.audit?.marks ?? []).filter((m) => caseTypeById.has(m.caseId));
  // 防御去重:同 caseId 取最后一条(正常路径 upsertAuditMark 已去重,这里兜住异常写入/合并)
  const marks = [...new Map(filtered.map((m) => [m.caseId, m])).values()];
  const reviewed = marks.length;
  const agreeCount = marks.filter((m) => m.autoCorrect).length;
  const overturns = reviewed - agreeCount;
  const redlineOverturns = marks.filter(
    (m) => !m.autoCorrect && caseTypeById.get(m.caseId) === "interception",
  ).length;
  const coveragePct = heldoutTotal === 0 ? null : Math.round((reviewed / heldoutTotal) * 100);
  const agreePct = reviewed === 0 ? null : Math.round((agreeCount / reviewed) * 100);
  const gatePass =
    coveragePct !== null &&
    coveragePct >= thresholds.coveragePct &&
    agreePct !== null &&
    agreePct >= thresholds.agreePct &&
    redlineOverturns === 0;
  return { heldoutTotal, reviewed, coveragePct, agreePct, overturns, redlineOverturns, thresholds, gatePass };
}

// ── releaseVerdict ────────────────────────────────────────────────────

export type ReleaseTier = "recommend" | "caution" | "reject" | "pending-review";

export interface ReleaseVerdict {
  tier: ReleaseTier;
  reasons: string[];
  calibration: CalibrationSummary;
  heldout: {
    baselineHard: number | null;
    bestHard: number | null;
    baselineSoft: number | null;
    bestSoft: number | null;
    regressed: boolean;
  };
}

/** 融合①留出②校准 → 发版结论。瑞士奶酪硬门:校准没过封顶 pending-review。 */
export function releaseVerdict(report: SkillEvalReport): ReleaseVerdict {
  const s = report.frame.summary;
  const cal = calibrationSummary(report);
  const hb = s.baselineTestHard;
  const hh = s.testHard;
  const sb = s.baselineTestSoft;
  const sh = s.testSoft;
  const hardCmp = hb != null && hh != null ? Math.sign(hh - hb) : null; // -1/0/1/null
  const softCmp = sb != null && sh != null ? Math.sign(sh - sb) : null;
  const improved = hardCmp === 1 || (hardCmp === 0 && softCmp === 1);
  const regressed = hardCmp === -1 || (hardCmp === 0 && softCmp === -1);
  const heldout = { baselineHard: hb, bestHard: hh, baselineSoft: sb, bestSoft: sh, regressed };

  if (cal.heldoutTotal === 0) {
    return { tier: "caution", reasons: ["未跑留出集,无法做发版判断"], calibration: cal, heldout };
  }
  if (!cal.gatePass) {
    const reasons: string[] = [];
    if (cal.coveragePct === null || cal.coveragePct < cal.thresholds.coveragePct) {
      reasons.push(`抽审覆盖不足(已审 ${cal.reviewed}/${cal.heldoutTotal},需 ≥${cal.thresholds.coveragePct}%)`);
    }
    if (cal.agreePct !== null && cal.agreePct < cal.thresholds.agreePct) {
      reasons.push(`校准一致率不达标(${cal.agreePct}% < ${cal.thresholds.agreePct}%)`);
    }
    if (cal.redlineOverturns > 0) {
      reasons.push(`红线(拦截)题人审翻案 ${cal.redlineOverturns} 处,判分器对红线不可信`);
    }
    if (reasons.length === 0) reasons.push("校准一致率无法计算(未完成任何抽审)");
    return { tier: "pending-review", reasons, calibration: cal, heldout };
  }
  if (hb == null || hh == null) {
    return { tier: "caution", reasons: ["留出 hard 指标缺失,无法做分数比较"], calibration: cal, heldout };
  }
  if (regressed) return { tier: "reject", reasons: ["留出集回归(优化后不如基线)"], calibration: cal, heldout };
  if (improved) return { tier: "recommend", reasons: ["留出集有提升,校准通过"], calibration: cal, heldout };
  return { tier: "caution", reasons: ["无回归但收益有限"], calibration: cal, heldout };
}
