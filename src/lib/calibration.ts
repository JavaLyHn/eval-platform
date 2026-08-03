import type { Evaluation } from "@/types";

/** 校准放量门禁阈值(与现有 R2 多裁判 agreementRate 的 ≥85 口径一致)。 */
export const CALIBRATION_THRESHOLD = 85;

type Verdict = "passed" | "failed";

/** 一条评测来自人工还是自动判官:有 judgeProfileId → auto,否则 human。 */
export function evalSource(e: Evaluation): "human" | "auto" {
  return e.judgeProfileId ? "auto" : "human";
}

export interface CalibrationPair {
  questionId: string;
  messageId: string;
  human: Verdict;
  auto: Verdict;
  agree: boolean;
}

export interface CalibrationResult {
  /** 配对数(同一回答既有人工判又有自动判)。 */
  n: number;
  /** 一致率 %(0-100);n===0 → null。 */
  agreementPct: number | null;
  /** n>0 且 一致率 ≥ 阈值。 */
  gatePass: boolean;
  disagreements: CalibrationPair[];
}

/**
 * 按 messageId(同一份回答)配对「最新人工判」与「最新自动判」,算人 vs 自动一致率。
 * 纯函数;只比同一回答,保证可比。
 */
export function computeCalibration(evaluations: Evaluation[]): CalibrationResult {
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

  const pairs: CalibrationPair[] = [];
  for (const [messageId, list] of byMsg) {
    const h = latest(list, "human");
    const a = latest(list, "auto");
    if (!h || !a) continue;
    pairs.push({
      questionId: h.questionId,
      messageId,
      human: h.verdict,
      auto: a.verdict,
      agree: h.verdict === a.verdict,
    });
  }

  const n = pairs.length;
  const agreeCount = pairs.filter((p) => p.agree).length;
  const agreementPct = n === 0 ? null : Math.round((agreeCount / n) * 100);
  const gatePass = agreementPct !== null && agreementPct >= CALIBRATION_THRESHOLD;
  return { n, agreementPct, gatePass, disagreements: pairs.filter((p) => !p.agree) };
}
