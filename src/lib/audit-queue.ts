import type { Evaluation, Question, QuestionSeverity } from "@/types";
import { evalSource } from "./calibration";

/** 默认抽样比例 15%(0–100% 区间;实际生效值由调用方持久化覆盖)。 */
export const DEFAULT_AUDIT_SAMPLE_RATE = 0.15;

/**
 * 稳定字符串哈希(djb2)→ [0,1)。同输入恒定 → 抽样可复现、可单测。
 * 不用 Math.random:不可复现,且本环境禁用。
 */
export function hashUnit(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; // h*33 + c,保持无符号 32 位
  }
  return h / 0x100000000; // / 2^32 → [0,1)
}

export interface AuditItem {
  evaluationId: string;
  questionId: string;
  messageId: string;
  severity: QuestionSeverity;
  /** LLM(自动判官)对该回答的判定 —— 抽审双向:通过项查漏判、失败项查错杀。 */
  autoVerdict: "passed" | "failed";
  /** P0 或红线(floorElementIds 非空)→ 100% 入队。 */
  forced: boolean;
  /** 同 messageId 已存在人工判。 */
  reviewed: boolean;
  humanVerdict?: "passed" | "failed";
  /** reviewed && 人工判 ≠ LLM 判:人推翻了自动判(放行错杀 / 拦下漏判,两向都算)。 */
  overturned: boolean;
}

export interface AuditQueueResult {
  rate: number; // 钳到 [0,1] 后的实际比例
  autoPassTotal: number; // 池里 LLM 判「通过」的回答数(按 messageId 去重)
  autoFailTotal: number; // 池里 LLM 判「失败」的回答数(按 messageId 去重)
  poolTotal: number; // 有自动判的回答总数(= autoPassTotal + autoFailTotal),空队列判据
  sampledTotal: number; // 抽中数(forced + 比例命中)
  forcedCount: number; // 抽中里的 P0/红线数(含已复核)
  /** 待复核(pending)里的 P0/红线数;pendingForcedCount + (pendingCount - pendingForcedCount) === pendingCount。 */
  pendingForcedCount: number;
  reviewedCount: number;
  pendingCount: number;
  overturnedCount: number;
  pending: AuditItem[];
  reviewed: AuditItem[];
}

/**
 * 自动判人工复核抽样队列(纯派生只读)。**双向抽审**:池 = 按 messageId 取最新自动判
 * (通过 + 失败都收 —— 通过项查漏判、失败项查错杀,TPR/TNR 都需要);P0/红线全抽,
 * 其余按确定性哈希比例抽;"已复核" = 同 messageId 存在人工判;
 * overturned = 最新人工判 ≠ LLM 判(两向都算推翻)。
 */
export function computeAuditQueue(
  evaluations: Evaluation[],
  questions: Question[],
  rate: number,
): AuditQueueResult {
  const r = Math.max(0, Math.min(1, Number.isFinite(rate) ? rate : DEFAULT_AUDIT_SAMPLE_RATE));
  const qById = new Map(questions.map((qq) => [qq.id, qq]));

  const byMsg = new Map<string, Evaluation[]>();
  for (const e of evaluations) {
    if (!e.messageId) continue;
    const arr = byMsg.get(e.messageId) ?? [];
    arr.push(e);
    byMsg.set(e.messageId, arr);
  }

  const latest = (list: Evaluation[], src: "human" | "auto"): Evaluation | undefined =>
    list
      .filter((e) => evalSource(e) === src)
      .sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
      )[0];

  const sampled: AuditItem[] = [];
  let autoPassTotal = 0;
  let autoFailTotal = 0;
  for (const [messageId, list] of byMsg) {
    const auto = latest(list, "auto");
    if (!auto) continue; // 无自动判(如纯人工 / 多 trial 无判)不进池
    const autoVerdict = auto.verdict === "passed" ? "passed" : "failed";
    if (autoVerdict === "passed") autoPassTotal += 1;
    else autoFailTotal += 1;

    const qq = qById.get(auto.questionId);
    const severity: QuestionSeverity = qq?.severity ?? "P2";
    const forced = severity === "P0" || (qq?.floorElementIds?.length ?? 0) > 0;
    if (!forced && hashUnit(messageId) >= r) continue;

    const human = latest(list, "human");
    const reviewed = !!human;
    const humanVerdict = human?.verdict;
    // 双向:人工判与 LLM 判不一致即为「推翻」(LLM 通过被判失败=漏判;LLM 失败被判通过=错杀)。
    const overturned = reviewed && humanVerdict !== autoVerdict;
    sampled.push({
      evaluationId: auto.id,
      questionId: auto.questionId,
      messageId,
      severity,
      autoVerdict,
      forced,
      reviewed,
      humanVerdict,
      overturned,
    });
  }

  const pending = sampled.filter((s) => !s.reviewed);
  const reviewed = sampled.filter((s) => s.reviewed);
  return {
    rate: r,
    autoPassTotal,
    autoFailTotal,
    poolTotal: autoPassTotal + autoFailTotal,
    sampledTotal: sampled.length,
    forcedCount: sampled.filter((s) => s.forced).length,
    pendingForcedCount: pending.filter((s) => s.forced).length,
    reviewedCount: reviewed.length,
    pendingCount: pending.length,
    overturnedCount: sampled.filter((s) => s.overturned).length,
    pending,
    reviewed,
  };
}
