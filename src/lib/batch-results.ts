import type { Evaluation, Question, StandardEmployee } from "@/types";
import type { AgentProfile } from "@/agents/types";

/**
 * 本批每个被评对象(= 一道题的一个 trial)的条目。
 * 多 trial 时同一 questionId 会出现多条,靠 messageId / trialIndex 区分 ——
 * 这正是修复「多 trial 三行塌缩成同一结果」的关键:每条独立锚定自己的 eval。
 */
export interface BatchJudgeEntry {
  questionId: string;
  /** 该 trial 的回答 messageId(同题多 trial 的唯一区分键)。 */
  messageId: string;
  /** 本批为该 trial 产出的 Evaluation.id;失败 / 跳过 = null。 */
  evaluationId: string | null;
  /** 多 trial 序号(0-based);单 trial / 单步题不设。 */
  trialIndex?: number;
  /** 困难题逐轮序号(0-based);单轮题不设。 */
  subIndex?: number;
  /** 该轮的用户提问(逐轮题用,让结果列表能区分各轮)。 */
  subPrompt?: string;
}

/** 上一次批量打分的指针:逐 trial 条目,锚定各自产出的 Evaluation。跑新批覆盖。 */
export interface LastBatchJudge {
  ranAt: string;
  /**
   * 本批所属会话 —— 切到别的 / 新建会话后不展示「查看本批结果」。
   * 可选:升级前遗留的旧指针无此字段,按「非当前会话」处理(自动隐藏)。
   */
  conversationId?: string;
  /** 逐 trial 条目(取代旧的 questionIds/evaluationIds 平行数组,避免错位 / 塌缩)。 */
  entries: BatchJudgeEntry[];
  judgeProfileIds: string[];
  mode?: "skip" | "redo";
}

export interface BatchResultRow {
  /** 行唯一键(= messageId,回退 evaluationId)。弹窗选中 / 高亮按它,而非 questionId。 */
  rowKey: string;
  questionId: string;
  questionTitle: string;
  /** 多 trial 序号(0-based);用于行内「第 N 轮」标签。 */
  trialIndex?: number;
  /** 困难题逐轮序号(0-based);用于行内「第 N 轮」标签。 */
  subIndex?: number;
  /** 该轮的用户提问(逐轮题用,区分各轮)。 */
  subPrompt?: string;
  evaluation: Evaluation | null;
  autoScore: number | null;
  verdict: "passed" | "failed" | null;
  agreementRate: number | null;
  employeeName: string | null;
  judgeNames: string[];
  /** 本批该 trial 无结果(出错未产 / 已被删除)。 */
  missing: boolean;
}

/** 本批每题的 judge 名:多 judge 取 calibrationSnapshots,否则单 judge;未知 id 回退显 id。 */
function judgeNamesOf(ev: Evaluation, profiles: AgentProfile[]): string[] {
  const ids =
    ev.calibrationSnapshots && ev.calibrationSnapshots.length > 0
      ? ev.calibrationSnapshots.map((s) => s.judgeProfileId)
      : ev.judgeProfileId
        ? [ev.judgeProfileId]
        : [];
  return ids.map((id) => profiles.find((p) => p.id === id)?.name ?? id);
}

/** 指针 + evaluations → 列表行(逐 trial / 逐轮一行,保持批内顺序)。
 *  eval 取**该条回答(messageId)的最新一条评测** —— 批量跑完后若单独重评某题,
 *  这里会跟着更新到最新结果,而不是停留在批次冻结的旧 evaluationId。 */
export function buildBatchResultRows(
  last: LastBatchJudge,
  evaluations: Evaluation[],
  questions: Question[],
  employees: StandardEmployee[],
  profiles: AgentProfile[],
): BatchResultRow[] {
  const evalById = new Map(evaluations.map((e) => [e.id, e]));
  // 每条回答(messageId)→ 最新一条评测(submittedAt 最大),供重评后实时更新。
  const latestByMsg = new Map<string, Evaluation>();
  for (const e of evaluations) {
    if (!e.messageId) continue;
    const cur = latestByMsg.get(e.messageId);
    if (!cur || new Date(e.submittedAt).getTime() > new Date(cur.submittedAt).getTime()) {
      latestByMsg.set(e.messageId, e);
    }
  }
  const qById = new Map(questions.map((q) => [q.id, q]));
  return last.entries.map((entry) => {
    // 优先取该回答最新评测;退回批次冻结的 evaluationId(兼容无 messageId 的旧指针)。
    const ev =
      (entry.messageId ? latestByMsg.get(entry.messageId) : undefined) ??
      (entry.evaluationId ? (evalById.get(entry.evaluationId) ?? null) : null) ??
      null;
    const q = qById.get(entry.questionId) ?? null;
    const empId = q?.targetEmployeeId ?? null;
    return {
      rowKey: entry.messageId || entry.evaluationId || entry.questionId,
      questionId: entry.questionId,
      questionTitle: q?.title ?? entry.questionId,
      trialIndex: entry.trialIndex,
      subIndex: entry.subIndex,
      subPrompt: entry.subPrompt,
      evaluation: ev,
      autoScore: ev?.autoScore ?? null,
      verdict: ev?.verdict ?? null,
      agreementRate: ev?.agreementRate ?? null,
      employeeName: empId ? (employees.find((e) => e.id === empId)?.name ?? empId) : null,
      judgeNames: ev ? judgeNamesOf(ev, profiles) : [],
      missing: !ev,
    } satisfies BatchResultRow;
  });
}
