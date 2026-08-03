import type { Evaluation } from "@/types";

/**
 * 把评测收窄到「某会话」:只保留 messageId 落在该会话消息集合里的评测。
 * 用于数据看板「按当前会话」模式 —— 评测↔会话靠 messageId → 消息 → 会话 关联。
 */
export function scopeEvaluationsToConversation(
  evaluations: Evaluation[],
  convMessageIds: Set<string>,
): Evaluation[] {
  return evaluations.filter((e) => convMessageIds.has(e.messageId));
}
