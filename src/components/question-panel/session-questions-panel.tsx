/**
 * 右侧面板 —— 当前会话答过的题目列表。
 *
 * 仅当当前活动会话答过题(testedInActiveConv 非空)且未被手动隐藏时,由
 * WorkspaceLayout 在"没有选中题目"的情况下渲染。点某条 → 选中该题(切到
 * 当前任务/打分);顶部「取消显示」隐藏整块(切到没答过题的会话时本就不显示)。
 */

import { useMemo } from "react";
import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/status-indicator";
import { useQAStore } from "@/hooks/use-qa-store";
import { PassKBadge } from "./pass-k-badge";

export function SessionQuestionsPanel() {
  const {
    activeConversation,
    testedInActiveConv,
    questions,
    getQStatusInActiveConv,
    getQLastScoreInActiveConv,
    passKByQInActiveConv,
    setSelectedQuestion,
    setSessionQuestionsHidden,
  } = useQAStore();

  // 本会话答过的题,按"最近作答"倒序(刚答完的排最上)。
  const answered = useMemo(() => {
    const lastIdx = new Map<string, number>();
    activeConversation?.messages.forEach((m, i) => {
      if (
        m.role === "assistant" &&
        m.questionId &&
        testedInActiveConv.has(m.questionId)
      ) {
        lastIdx.set(m.questionId, i);
      }
    });
    return [...testedInActiveConv]
      .map((qid) => questions.find((q) => q.id === qid))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .sort((a, b) => (lastIdx.get(b.id) ?? 0) - (lastIdx.get(a.id) ?? 0));
  }, [activeConversation, testedInActiveConv, questions]);

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-surface/40"
      aria-label="本会话题目"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
          <FileText className="h-3.5 w-3.5" />
          本会话题目
          <span className="font-mono text-[11px] text-muted-foreground">
            ({answered.length})
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
          onClick={() => setSessionQuestionsHidden(true)}
          title="隐藏本会话题目面板(可在对话头部重新打开)"
        >
          <X className="h-3.5 w-3.5" /> 取消显示
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="space-y-1.5 p-3">
          {answered.length === 0 ? (
            <li className="px-2 py-10 text-center text-[11.5px] text-muted-foreground">
              本会话还没有答过题。
            </li>
          ) : (
            answered.map((q) => {
              const score = getQLastScoreInActiveConv(q.id);
              const passK = passKByQInActiveConv.get(q.id);
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedQuestion(q.id)}
                    className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left transition-colors hover:border-foreground/30"
                  >
                    <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                      #{q.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                      {q.title}
                    </span>
                    {passK ? (
                      <PassKBadge summary={passK} />
                    ) : (
                      typeof score === "number" && (
                        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                          {score.toFixed(1)}
                        </span>
                      )
                    )}
                    <StatusBadge value={getQStatusInActiveConv(q.id)} />
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </ScrollArea>
    </section>
  );
}
