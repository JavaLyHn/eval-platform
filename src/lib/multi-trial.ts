import type { Evaluation, ScoreDimension } from "@/types";

/** green=pass^k 成立 / partial=有过有挂 / incomplete=全过但未跑满 k / red=0 过或无数据。 */
export type PassKStatus = "green" | "partial" | "incomplete" | "red";

/**
 * 评测的分数字段(按是否多 trial 试跑分流)。
 * 多 trial 专测稳定性/通过率:试跑评测**只计 verdict,不计分** —— trialIndex
 * 非空时分数字段置空(scores=[]、autoScore=undefined),从而自动被一切
 * 平均分统计排除(均以 autoScore != null 为分母);单次问答评分照常落账。
 */
export function evalScoreFields(
  trialIndex: number | undefined,
  scores: ScoreDimension[],
  autoScore: number,
): Pick<Evaluation, "trialIndex" | "scores" | "autoScore"> {
  return trialIndex != null
    ? { trialIndex, scores: [], autoScore: undefined }
    : { scores, autoScore };
}

export interface PassKSummary {
  trials: number; // 实际评测条数
  passed: number; // verdict==="passed" 条数
  k: number; // 目标次数(取整下限 ≥1)
  passPowerK: boolean; // trials>=k && passed===trials && trials>0
  passAtK: boolean; // passed>=1
  status: PassKStatus;
}

/**
 * 把某题在一次 run 内的若干条 Evaluation 汇成 pass^k 摘要。
 * 口径对齐 floor-report-logic.probeStat(passPowerK 公式一致)。
 */
export function passKSummary(evals: { verdict: "passed" | "failed" }[], k: number): PassKSummary {
  const kEff = Math.max(1, Math.floor(k));
  const trials = evals.length;
  const passed = evals.filter((e) => e.verdict === "passed").length;
  const passPowerK = trials >= kEff && passed === trials && trials > 0;
  const passAtK = passed >= 1;

  let status: PassKStatus;
  if (trials === 0) {
    status = "red";
  } else if (passed === trials) {
    // 全过:够 k 次 → 达标;不够 → 未跑满
    status = trials >= kEff ? "green" : "incomplete";
  } else if (passed >= 1) {
    status = "partial";
  } else {
    status = "red";
  }
  return { trials, passed, k: kEff, passPowerK, passAtK, status };
}

/**
 * 多步题的 pass^k:多步题一个 trial 有多轮 = 多条 Evaluation(同 trialIndex、不同 messageId)。
 * 先按 trialIndex 分组,**每个 trial 全部轮 passed 才算 passed(AND),任一 failed → failed**,
 * 收敛成每 trial 一个 verdict 后复用 passKSummary 的 pass^k 归约。
 * 单 prompt 多 trial(每 trial 恰好 1 条)→ 分组后与直接 passKSummary 结果一致。
 */
export function passKSummaryByTrial(
  evals: { trialIndex?: number; verdict: "passed" | "failed" }[],
  k: number,
  turnsPerTrial = 1,
): PassKSummary {
  const t = Math.max(1, Math.floor(turnsPerTrial));
  const byTrial = new Map<number, { verdict: "passed" | "failed" }[]>();
  for (const e of evals) {
    const ti = e.trialIndex ?? -1;
    const arr = byTrial.get(ti);
    if (arr) arr.push(e);
    else byTrial.set(ti, [e]);
  }
  const trialVerdicts: { verdict: "passed" | "failed" }[] = [];
  for (const turns of byTrial.values()) {
    if (turns.length === 0) continue;
    // 一个 trial「过」= 它的每一轮(共 turnsPerTrial 轮)都被判且都 passed。
    // 轮数不足(某轮超时/出错→无评测,或尚未判完)→ 该 trial 视为未过(保下限):
    // 缺席的轮当「没过」而非「不存在」,避免多步题某轮超时却算出 pass^k 假绿。
    // 注:调用方需保证 evals 已按「每轮一条」去重(同一轮的重复评测会骗过轮数判断)。
    const allPassed = turns.length >= t && turns.every((x) => x.verdict === "passed");
    trialVerdicts.push({ verdict: allPassed ? "passed" : "failed" });
  }
  return passKSummary(trialVerdicts, k);
}
