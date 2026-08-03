/**
 * 「答完即评」自动链的判定纯函数:批量答题队列完成后,是否应自动接批量 LLM 评分。
 * 抽成纯函数以便单测,并避免把判定逻辑塞进 store 里敏感的队列状态更新 effect。
 *
 * 任一条件不满足 → 返回 null(不自动开评,优雅降级回手动):
 *  1. 队列已停(running=false)        —— 还在答题不评
 *  2. 本批确实勾了「答完即评」(autoJudge 非空)
 *  3. 当前没有评分在跑               —— 不并发两个评分
 *  4. 用户仍停在这批的 run 会话      —— 中途切走则不自动(不抢用户的右栏)
 *  5. 去重后的完成题 > 0             —— 全失败则不评
 */
export type AutoJudgeConfig = { judgeProfileIds: string[]; mode: "skip" | "redo" };

export function planAutoJudge(args: {
  queueRunning: boolean;
  autoJudge: AutoJudgeConfig | null;
  judgeRunning: boolean;
  completed: { questionId: string }[];
  queueConversationId: string | null;
  activeConversationId: string | null;
}): { questionIds: string[]; config: AutoJudgeConfig } | null {
  if (args.queueRunning) return null;
  if (!args.autoJudge) return null;
  if (args.judgeRunning) return null;
  if (args.queueConversationId !== args.activeConversationId) return null;
  const questionIds = [...new Set(args.completed.map((c) => c.questionId))];
  if (questionIds.length === 0) return null;
  return { questionIds, config: args.autoJudge };
}
