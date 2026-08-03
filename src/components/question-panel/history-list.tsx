import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn, formatRelativeTime } from "@/lib/utils";

interface HistoryListProps {
  questionId: string;
}

export function HistoryList({ questionId }: HistoryListProps) {
  const { evaluations, activeConversation } = useQAStore();
  // Scope history to the active conversation — past evals from other convs
  // do not appear here so a fresh conv truly starts clean.
  const history = useMemo(() => {
    const convMsgIds = new Set(
      (activeConversation?.messages ?? []).map((m) => m.id),
    );
    return evaluations
      .filter(
        (e) => e.questionId === questionId && convMsgIds.has(e.messageId),
      )
      .sort(
        (a, b) =>
          new Date(b.submittedAt).getTime() -
          new Date(a.submittedAt).getTime(),
      );
  }, [evaluations, questionId, activeConversation]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const allExpanded =
    history.length > 0 && expandedIds.size === history.length;

  const toggleOne = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setExpandedIds(
      allExpanded ? new Set() : new Set(history.map((e) => e.id)),
    );

  if (history.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/40 px-3 py-4 text-center text-[12px] text-muted-foreground">
        这道题还没有评测记录
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span className="font-mono">共 {history.length} 条记录</span>
        <button
          type="button"
          onClick={toggleAll}
          className="rounded px-1.5 py-0.5 hover:bg-secondary hover:text-foreground"
        >
          {allExpanded ? "全部收起" : "全部展开"}
        </button>
      </div>
      <ul className="space-y-1.5">
        {history.map((ev, idx) => {
          const isOpen = expandedIds.has(ev.id);
          return (
            <li
              key={ev.id}
              className="rounded-md border border-border bg-card text-[12.5px]"
            >
              <button
                type="button"
                onClick={() => toggleOne(ev.id)}
                className="flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-secondary/40"
                aria-expanded={isOpen}
              >
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </span>
                <span className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                  #{history.length - idx}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={ev.verdict === "passed" ? "success" : "destructive"}
                      className="text-[10px]"
                    >
                      {ev.verdict === "passed" ? "通过" : "失败"}
                    </Badge>
                    <span
                      className={cn(
                        "font-mono tabular-nums",
                        ev.autoScore == null
                          ? "text-muted-foreground" // 多 trial 试跑评测不计分
                          : ev.autoScore >= 8
                            ? "text-success"
                            : ev.autoScore >= 5
                              ? "text-foreground"
                              : "text-destructive",
                      )}
                    >
                      {ev.autoScore?.toFixed(2) ?? "—"}
                    </span>
                    {ev.modelVersion && (
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {ev.modelVersion}
                      </span>
                    )}
                    {ev.judgeProfileId ? (
                      <Badge
                        variant="accent"
                        className="h-4 gap-0.5 px-1 text-[9.5px]"
                        title="由 LLM 评分"
                      >
                        🤖 LLM
                      </Badge>
                    ) : (
                      <Badge
                        variant="muted"
                        className="h-4 gap-0.5 px-1 text-[9.5px]"
                        title={
                          ev.evaluator?.name
                            ? `由 ${ev.evaluator.name} 人工评分`
                            : "由人工评分"
                        }
                      >
                        🧑 人工
                      </Badge>
                    )}
                    <span className="ml-auto text-[10.5px] text-muted-foreground">
                      {ev.evaluator?.name && (
                        <span className="mr-1.5">@{ev.evaluator.name}</span>
                      )}
                      {formatRelativeTime(ev.submittedAt)}
                    </span>
                  </div>
                  {!isOpen && ev.notes && (
                    <p className="mt-1 line-clamp-1 text-[12px] text-muted-foreground">
                      {ev.notes}
                    </p>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border px-2.5 py-2 pl-7 text-[12px]">
                  {ev.scores.length > 0 && (
                    <div className="mb-2">
                      <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">
                        评分维度
                      </div>
                      <ul className="space-y-0.5">
                        {ev.scores.map((s) => (
                          <li
                            key={s.key}
                            className="flex items-center justify-between gap-2 font-mono text-[11.5px]"
                          >
                            <span className="truncate text-foreground/85">
                              {s.label}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {s.value.toFixed(2)} / {s.max}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {ev.notes && (
                    <div className="mb-2">
                      <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">
                        评语
                      </div>
                      <p className="whitespace-pre-wrap break-words text-[12px] text-foreground/90">
                        {ev.notes}
                      </p>
                    </div>
                  )}
                  {ev.annotations && ev.annotations.length > 0 && (
                    <div className="mb-2">
                      <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">
                        标注 ({ev.annotations.length})
                      </div>
                      <ul className="space-y-1.5">
                        {ev.annotations.map((a) => (
                          <li
                            key={a.id}
                            className="rounded border-l-2 border-warning bg-warning/5 px-2 py-1 text-[11.5px]"
                          >
                            <div className="break-words text-foreground/85">
                              「{a.quote}」
                            </div>
                            {(a.label || a.note) && (
                              <div className="mt-0.5 text-muted-foreground">
                                {a.label && (
                                  <span className="mr-1.5 font-medium">
                                    [{a.label}]
                                  </span>
                                )}
                                {a.note}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!ev.notes &&
                    ev.scores.length === 0 &&
                    (!ev.annotations || ev.annotations.length === 0) && (
                      <p className="text-[11.5px] italic text-muted-foreground">
                        没有附加细节
                      </p>
                    )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
