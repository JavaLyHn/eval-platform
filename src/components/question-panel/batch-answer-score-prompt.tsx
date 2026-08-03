import { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQAStore } from "@/hooks/use-qa-store";
import { BulkJudgeDialog } from "./bulk-judge-dialog";

/**
 * 批量答题完成后,在「打分」tab 顶层展示的引导面板:
 * 一眼看清答完了哪些题,主操作是「批量 LLM 评分」,也可逐题人工打分或稍后。
 * 批量答题完成会自动跳到打分 tab(question-panel),这里就是落地页。
 */
export function BatchAnswerScorePrompt() {
  const {
    queue,
    questions,
    clearQueueResults,
    setSelectedQuestion,
    standardEmployees,
  } = useQAStore();
  const [judgeOpen, setJudgeOpen] = useState(false);

  // 去重:一题多 agent 会展开成多条队列项,这里每题只显示一行。
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return queue.completed.filter((it) => {
      if (seen.has(it.questionId)) return false;
      seen.add(it.questionId);
      return true;
    });
  }, [queue.completed]);

  const questionIds = useMemo(() => rows.map((r) => r.questionId), [rows]);
  const erroredCount = queue.errored.length;
  const empName = (eid?: string) =>
    eid ? standardEmployees.find((e) => e.id === eid)?.name : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 头部:渐变高亮卡 */}
      <div className="overflow-hidden rounded-xl border border-success/30 shadow-sm">
        <div className="flex items-start gap-3 bg-gradient-to-br from-success/15 via-success/5 to-accent/5 px-4 py-3.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 className="h-5 w-5 text-success" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-foreground">
                批量答题完成
              </span>
              <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-success">
                {rows.length} 道
              </span>
              {erroredCount > 0 && (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-mono text-[11px] tabular-nums text-destructive">
                  {erroredCount} 失败
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              这些题都已作答完成。要用 LLM 给它们批量打分吗?也可以逐题人工打分,或稍后再说。
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={clearQueueResults}
            aria-label="关闭"
            title="稍后再打分"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 主操作 */}
        <div className="flex items-center gap-2 border-t border-success/20 bg-card px-4 py-2.5">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setJudgeOpen(true)}
            disabled={questionIds.length === 0}
          >
            <Bot className="h-3.5 w-3.5" />
            批量 LLM 评分 · {questionIds.length} 题
          </Button>
          <span className="text-[11px] text-muted-foreground">
            <Sparkles className="mr-0.5 inline h-3 w-3" />
            多裁判校准 · 自动落库
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-[11.5px] text-muted-foreground"
            onClick={clearQueueResults}
          >
            稍后
          </Button>
        </div>
      </div>

      {/* 逐题清单:点「打分」进入这道题的人工打分 */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        <div className="border-b border-border bg-muted/30 px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
          逐题打分
        </div>
        <ul className="divide-y divide-border/60">
          {rows.map((it) => {
            const q = questions.find((qq) => qq.id === it.questionId);
            if (!q) return null;
            const errored = queue.errored.some(
              (e) => e.questionId === it.questionId && e.profileId === it.profileId,
            );
            const who = empName(q.targetEmployeeId);
            return (
              <li
                key={`${it.questionId}-${it.profileId}`}
                className="flex items-center gap-2 px-3 py-2 text-[12px]"
              >
                {errored ? (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                )}
                <span className="flex-1 truncate text-foreground/90">{q.title}</span>
                {who && (
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {who}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 shrink-0 gap-1 px-2 text-[10.5px]"
                  onClick={() => {
                    // 进入这道题的人工打分:选中它并清掉批量完成态(让位给 EvaluationTab)。
                    setSelectedQuestion(it.questionId);
                    clearQueueResults();
                  }}
                  title="逐题人工打分"
                >
                  <ClipboardCheck className="h-3 w-3" /> 打分
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      <BulkJudgeDialog
        open={judgeOpen}
        onOpenChange={setJudgeOpen}
        questionIds={questionIds}
      />
    </div>
  );
}
