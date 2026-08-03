import type { EvaluationRun, EvaluationRunConfig } from "@/types";

/** 复制源 run 的配置(深拷数组),供重跑用。不带 status/result/lineage。 */
export function cloneRunConfig(src: EvaluationRun): EvaluationRunConfig {
  return {
    questionIds: [...src.config.questionIds],
    trialsPerQuestion: src.config.trialsPerQuestion,
    judgeProfileIds: [...src.config.judgeProfileIds],
    judgeMode: src.config.judgeMode,
  };
}

/** 报告里 verdict=failed 的题 id(去重),供"只回归失败题"。 */
export function failedQuestionIdsFromReport(
  report: { items: { questionId: string; verdict: "passed" | "failed" }[] },
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of report.items) {
    if (it.verdict === "failed" && !seen.has(it.questionId)) {
      seen.add(it.questionId);
      out.push(it.questionId);
    }
  }
  return out;
}

/** 两个 run 可否对比:同被测且皆有报告。 */
export function canCompare(a: EvaluationRun, b: EvaluationRun): boolean {
  return (
    a.id !== b.id &&
    a.subjectProfileId === b.subjectProfileId &&
    a.reportId != null &&
    b.reportId != null
  );
}

/** 运行中进度:answered = 本 run 会话的已完成数;total = config 题数×trial。 */
export function deriveRunProgress(
  queue: { running: boolean; completed: unknown[]; total: number; conversationId?: string },
  judge: { done: number },
  runConvId: string | undefined,
): { answered: number; judged: number; total: number } {
  const mine = runConvId != null && queue.conversationId === runConvId;
  return {
    answered: mine ? queue.completed.length : 0,
    judged: judge.done,
    total: mine ? queue.total : 0,
  };
}

/** 答题队列跑完、且属于本 answering run → 该进入判分。 */
export function shouldStartJudging(
  run: EvaluationRun,
  queue: { running: boolean; conversationId?: string },
): boolean {
  return (
    run.status === "answering" &&
    !queue.running &&
    run.runConversationId != null &&
    queue.conversationId === run.runConversationId
  );
}
