import type { ChatMessage } from "@/types";

export interface AnsweredTurn {
  userPrompt: string;
  assistant: ChatMessage;
}

/**
 * 某会话消息流里、某题的全部「已答完」回合:把每个 user 消息与紧随其后的非 streaming
 * assistant 配对。遇到不属于该题的消息会清掉当前 pending user(与 runLLMJudge 原逻辑一致)。
 */
export function answeredTurns(
  messages: ChatMessage[],
  questionId: string,
): AnsweredTurn[] {
  const turns: AnsweredTurn[] = [];
  let pendingUser: ChatMessage | null = null;
  for (const m of messages) {
    if (m.questionId !== questionId) {
      pendingUser = null;
      continue;
    }
    if (m.role === "user") {
      pendingUser = m;
    } else if (m.role === "assistant" && !m.isStreaming) {
      if (pendingUser) turns.push({ userPrompt: pendingUser.content, assistant: m });
      pendingUser = null;
    }
  }
  return turns;
}

/** 最新一个已答完回合;无则 null。 */
export function latestAnsweredTurn(
  messages: ChatMessage[],
  questionId: string,
): AnsweredTurn | null {
  const turns = answeredTurns(messages, questionId);
  return turns.length > 0 ? turns[turns.length - 1] : null;
}

/**
 * 按 trialIndex 把某题的已答回合分组:多 trial 多步题里,每个 trial 的多轮各自成一组。
 * 非多 trial(trialIndex 缺省)全部归到 key=-1 的单组,组内顺序与 answeredTurns 一致。
 * 依赖 trial 串行派发 → 同题各 trial 的消息在流里连续排列,answeredTurns 的逐轮配对不会跨 trial 串味。
 */
export function answeredTurnsByTrial(
  messages: ChatMessage[],
  questionId: string,
): Map<number, AnsweredTurn[]> {
  const out = new Map<number, AnsweredTurn[]>();
  for (const t of answeredTurns(messages, questionId)) {
    const ti = t.assistant.trialIndex ?? -1;
    const arr = out.get(ti);
    if (arr) arr.push(t);
    else out.set(ti, [t]);
  }
  return out;
}
