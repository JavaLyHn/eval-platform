import type { ChatMessage, Evaluation } from "@/types";
import { answeredTurns, latestAnsweredTurn, type AnsweredTurn } from "./conversation-turns";

export interface BatchJudgeTarget {
  questionId: string;
  turn: AnsweredTurn;
  /** 该回答所在会话(跨会话批量评分用;每题独立会话后,题不一定在当前会话里)。 */
  conversationId?: string;
}
export interface BatchJudgePartition {
  eligible: BatchJudgeTarget[];
  alreadyEvaluated: BatchJudgeTarget[];
  unanswered: string[];
}

/** 按「题」聚合的计数(展示用)。多 trial 同题只算一次,与「选中题数」同口径。 */
export interface BatchJudgeQuestionCounts {
  /** 有未评 trial 的题(skip 模式会评到的题数)。 */
  eligible: number;
  /** 全部 trial 都已评、无待评 trial 的题。 */
  alreadyEvaluated: number;
  /** 未答的题。 */
  unanswered: number;
  /** 已答的题(eligible ∪ alreadyEvaluated)= redo 模式会评到的题数。 */
  answered: number;
}

/**
 * 把 trial 级分区折算成题级计数。
 * 一题若部分 trial 已评、部分未评 → 仍算「可评」(skip 模式会补评其未评 trial)。
 */
export function questionCounts(part: BatchJudgePartition): BatchJudgeQuestionCounts {
  const eligibleQ = new Set(part.eligible.map((t) => t.questionId));
  const evaluatedQ = new Set(part.alreadyEvaluated.map((t) => t.questionId));
  let fullyEvaluated = 0;
  for (const qid of evaluatedQ) if (!eligibleQ.has(qid)) fullyEvaluated += 1;
  const answered = new Set([...eligibleQ, ...evaluatedQ]).size;
  return {
    eligible: eligibleQ.size,
    alreadyEvaluated: fullyEvaluated,
    unanswered: part.unanswered.length,
    answered,
  };
}

/**
 * 一轮回答是否「可评」。干净完成、或 agent 主动反问暂停(present_options 等,完整一轮)
 * 都算可评;只有真·未完成(超时 / 上游失败,部分文本)才排除。
 * 旧数据只有 interrupted=true 而无 interruptKind 时按可评处理。
 */
function isJudgeable(m: ChatMessage): boolean {
  return m.interruptKind !== "timeout" && m.interruptKind !== "error";
}

/**
 * 「已评」只认 LLM judge / 人工评测。答题完成时自动落库的确定性 ground-truth
 * 评测(evaluator.role="deterministic",无 judgeProfileId)不算 —— 否则挂了
 * check 的题一答完就被标「已评」,「跳过已评」模式下永远轮不到 LLM 评分。
 */
function isJudgedEvaluation(e: Evaluation): boolean {
  if (e.judgeProfileId) return true; // LLM judge 产物
  // 仅排除确定性自动判分;人工评测(evaluator 可能未设用户档案而为空)一律算已评。
  return e.evaluator?.role !== "deterministic";
}

/**
 * 批量 LLM 评分落库:redo(全部重评)会对同一 (messageId, subIndex) 再判一次 —— 前插新 eval
 * 前先删掉**上一版 LLM 评测**,避免重复 eval 累积(否则看板失败总数 / 失败归因环 / 评测 chip
 * 等未按 messageId 去重的计数会被双算)。只删同类 LLM 评测(judgeProfileId 存在),保留确定性
 * 自动判分 / 人工评测 —— 它们对同一条消息可与 LLM 评测并存,不该被顶掉。
 */
export function upsertBatchJudgeEvaluation(
  prev: Evaluation[],
  ev: Evaluation,
): Evaluation[] {
  return [
    ev,
    ...prev.filter(
      (e) =>
        !(
          e.messageId === ev.messageId &&
          (e.subIndex ?? null) === (ev.subIndex ?? null) &&
          !!e.judgeProfileId
        ),
    ),
  ];
}

/**
 * 判分进度按「题」折算:困难题多轮 = 1 条(其所有判分单元都判完,该题才算完成)。
 * 底层仍逐轮判(每轮各出 verdict),但展示口径回到「题」——与「选择要打分的题」清单一致。
 * 返回题级 已完成/总数,以及真实单元(轮)总数供次要展示。
 */
export function judgeQuestionProgress(
  plan: Array<{ key: string; questionId: string }> | undefined,
  doneKeys: string[] | undefined,
): { doneQ: number; totalQ: number; totalUnits: number } {
  const p = plan ?? [];
  const done = new Set(doneKeys ?? []);
  const unitsByQ = new Map<string, string[]>();
  for (const u of p) {
    const arr = unitsByQ.get(u.questionId);
    if (arr) arr.push(u.key);
    else unitsByQ.set(u.questionId, [u.key]);
  }
  let doneQ = 0;
  for (const keys of unitsByQ.values()) if (keys.every((k) => done.has(k))) doneQ += 1;
  return { doneQ, totalQ: unitsByQ.size, totalUnits: p.length };
}

/**
 * 并发判分分组:把判分单元按「上下文相连」聚成作业组 —— **同一线程串行**跑一组、组间并行。
 * - contextKey:上下文相连键(= questionId + trialIndex)。同键 = 一道多轮题的各轮 /
 *   同一 trial 的各轮 → 必须同线程按顺序评(多轮题上下文相连,绝不拆到多线程)。
 * - order:组内排序键(= subIndex),保证各轮按 0,1,2… 顺序评。
 * 返回每组的单元数组(已排序);组的相对顺序 = 各组首个单元在原数组的出现序(稳定)。
 */
export function groupJudgeUnitsByContext<T>(
  units: T[],
  contextKey: (u: T) => string,
  order: (u: T) => number,
): T[][] {
  const map = new Map<string, T[]>();
  for (const u of units) {
    const k = contextKey(u);
    const arr = map.get(k);
    if (arr) arr.push(u);
    else map.set(k, [u]);
  }
  return [...map.values()].map((arr) =>
    arr.slice().sort((a, b) => order(a) - order(b)),
  );
}

/** 单题分区核心:在给定消息流(某一个会话)里判这道题 eligible / already / unanswered。 */
function partitionOne(
  questionId: string,
  messages: ChatMessage[],
  evaluations: Evaluation[],
  conversationId: string | undefined,
  out: BatchJudgePartition,
): void {
  const judgedFor = (qid: string, messageId: string): boolean =>
    evaluations.some(
      (e) => e.questionId === qid && e.messageId === messageId && isJudgedEvaluation(e),
    );
  const all = answeredTurns(messages, questionId);
  const isMultiTrial = all.some((t) => t.assistant.trialIndex != null);

  if (isMultiTrial) {
    // 多 trial:逐 trial 入队(各自 messageId 判是否已评),全是超时/失败才算未答。
    const finished = all.filter((t) => isJudgeable(t.assistant));
    if (finished.length === 0) {
      out.unanswered.push(questionId);
      return;
    }
    for (const turn of finished) {
      const evaluated = judgedFor(questionId, turn.assistant.id);
      (evaluated ? out.alreadyEvaluated : out.eligible).push({
        questionId,
        turn,
        conversationId,
      });
    }
    return;
  }

  // 普通/多步题:只判最新一轮(现状不变)。
  const turn = latestAnsweredTurn(messages, questionId);
  if (!turn || !isJudgeable(turn.assistant)) {
    out.unanswered.push(questionId);
    return;
  }
  const evaluated = judgedFor(questionId, turn.assistant.id);
  (evaluated ? out.alreadyEvaluated : out.eligible).push({
    questionId,
    turn,
    conversationId,
  });
}

/**
 * 把选中题按「当前会话最新回答 + 是否已评」分区。
 * 「已评」= 存在 questionId + 最新回答 messageId 命中的 **LLM/人工** Evaluation
 * (确定性自动判分不算,见 isJudgedEvaluation)。
 * 超时 / 失败中断的回答(interruptKind=timeout/error)视为未答完;
 * agent 反问暂停(interruptKind=agent-pause)是完整一轮,计入评测。
 */
export function partitionForBatchJudge(
  selectedQuestionIds: string[],
  messages: ChatMessage[],
  evaluations: Evaluation[],
): BatchJudgePartition {
  const out: BatchJudgePartition = { eligible: [], alreadyEvaluated: [], unanswered: [] };
  for (const questionId of selectedQuestionIds)
    partitionOne(questionId, messages, evaluations, undefined, out);
  return out;
}

/**
 * 跨会话分区:每题独立会话后,批量评分不能只看当前会话 —— 每道题去
 * **它最近一次被回答的那个会话**里取最新作答(多个会话答过 → 按回答时间取最新),
 * 再按单题逻辑分区。target 带 conversationId,judge 可回到原会话取整段对话。
 */
export function partitionForBatchJudgeAcrossConvs(
  selectedQuestionIds: string[],
  conversations: Array<{ id: string; messages: ChatMessage[] }>,
  evaluations: Evaluation[],
): BatchJudgePartition {
  const out: BatchJudgePartition = { eligible: [], alreadyEvaluated: [], unanswered: [] };
  for (const questionId of selectedQuestionIds) {
    // 找该题最新作答所在的会话(比较各会话最新一轮回答的 createdAt)。
    let best: { conv: { id: string; messages: ChatMessage[] }; at: number } | null = null;
    for (const conv of conversations) {
      const turn = latestAnsweredTurn(conv.messages, questionId);
      if (!turn) continue;
      const at = new Date(turn.assistant.createdAt ?? 0).getTime() || 0;
      if (!best || at > best.at) best = { conv, at };
    }
    if (!best) {
      out.unanswered.push(questionId);
      continue;
    }
    partitionOne(questionId, best.conv.messages, evaluations, best.conv.id, out);
  }
  return out;
}
