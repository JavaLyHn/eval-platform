import { useMemo } from "react";
import { StatusBadge } from "@/components/status-indicator";
import { PassKBadge } from "./pass-k-badge";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";

/**
 * 本会话题目清单(题目 / 打分 / 结果 三个 tab 复用):
 * 本会话答过的题(最近作答在前);没答过且允许回退时用当前批量选择。
 */
export function useSessionQuestionList(fallbackToSelection = false) {
  const { questions, selection, testedInActiveConv, activeConversation } =
    useQAStore();
  return useMemo(() => {
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
    const answered = [...testedInActiveConv]
      .map((qid) => questions.find((q) => q.id === qid))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .sort((a, b) => (lastIdx.get(b.id) ?? 0) - (lastIdx.get(a.id) ?? 0));
    if (answered.length > 0) return answered;
    return fallbackToSelection
      ? questions.filter((q) => selection.has(q.id))
      : [];
  }, [
    activeConversation,
    testedInActiveConv,
    questions,
    selection,
    fallbackToSelection,
  ]);
}

/**
 * 本会话题目清单条:一排可点的题目(题号 / 标题 / 分数或 pass^k / 状态),
 * 点一条 → 由 onPick(默认 setSelectedQuestion)切换下方内容。
 * 与「题目」tab 同一套交互,打分 / 结果 tab 也用它来选题。
 */
export function SessionQuestionStrip({
  onPick,
  fallbackToSelection = false,
  title = "本会话题目",
}: {
  /** 点击行的处理;默认 setSelectedQuestion(会跳回「题目」tab,打分/结果 tab 传自己的)。 */
  onPick?: (id: string) => void;
  /** 本会话还没答过题时,是否回退显示当前批量选择(题目 tab 用)。 */
  fallbackToSelection?: boolean;
  /** 清单标题,按场景命名(题目=本会话题目 / 打分=选择要打分的题 / 结果=选择要查看结果的题)。 */
  title?: string;
}) {
  const {
    selectedQuestionId,
    setSelectedQuestion,
    getQStatusInActiveConv,
    getQLastScoreInActiveConv,
    passKByQInActiveConv,
  } = useQAStore();
  const sessionList = useSessionQuestionList(fallbackToSelection);

  if (sessionList.length === 0) return null;
  const pick = onPick ?? setSelectedQuestion;

  return (
    <div className="shrink-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        {title} <span className="font-mono">({sessionList.length})</span>
      </div>
      <ul className="max-h-40 divide-y divide-border/60 overflow-y-auto">
        {sessionList.map((q) => {
          const active = q.id === selectedQuestionId;
          const score = getQLastScoreInActiveConv(q.id);
          const passK = passKByQInActiveConv.get(q.id);
          return (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => pick(q.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
                  active
                    ? "bg-accent/15 font-medium text-foreground"
                    : "text-foreground/85 hover:bg-accent/5",
                )}
              >
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  #{q.number}
                </span>
                <span className="min-w-0 flex-1 truncate">{q.title}</span>
                {passK ? (
                  <PassKBadge summary={passK} />
                ) : (
                  typeof score === "number" && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {score.toFixed(1)}
                    </span>
                  )
                )}
                <StatusBadge value={getQStatusInActiveConv(q.id)} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
