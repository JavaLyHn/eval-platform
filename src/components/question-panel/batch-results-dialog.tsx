import { useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useQAStore } from "@/hooks/use-qa-store";
import { buildBatchResultRows } from "@/lib/batch-results";
import { ResultSummary } from "@/components/question-panel/evaluation-tab";

type Filter = "all" | "passed" | "failed" | "missing";

export function BatchResultsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { lastBatchJudge, evaluations, questions, standardEmployees, profiles } = useQAStore();
  // 按行唯一键(rowKey)选中,而非 questionId —— 多 trial 同题各行才能各自选中/高亮。
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  // 每次打开重置选中,避免指向已被新批次替换/过滤掉的行
  useEffect(() => {
    if (open) setSelectedKey(null);
  }, [open]);

  const rows = useMemo(
    () =>
      lastBatchJudge
        ? buildBatchResultRows(lastBatchJudge, evaluations, questions, standardEmployees, profiles)
        : [],
    [lastBatchJudge, evaluations, questions, standardEmployees, profiles],
  );
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "missing" ? r.missing : !r.missing && r.verdict === filter,
  );
  const selected = shown.find((r) => r.rowKey === selectedKey) ?? shown[0] ?? null;
  const selectedQuestion = selected ? questions.find((q) => q.id === selected.questionId) ?? null : null;

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: `全部 ${rows.length}` },
    { key: "passed", label: "通过" },
    { key: "failed", label: "不通过" },
    { key: "missing", label: "出错/无结果" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>本批评测结果 · {rows.length} 题</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-1 text-[11px]">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn("rounded px-2 py-0.5 transition-colors", filter === f.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex max-h-[70vh] min-h-[320px] gap-3">
          <div className="w-72 shrink-0 space-y-1 overflow-auto border-r border-border pr-2">
            {shown.length === 0 && <div className="p-3 text-[12px] text-muted-foreground">无匹配结果。</div>}
            {shown.map((r) => {
              const active = selected?.rowKey === r.rowKey;
              return (
                <button
                  key={r.rowKey}
                  type="button"
                  onClick={() => setSelectedKey(r.rowKey)}
                  className={cn("flex w-full flex-col gap-0.5 rounded border-l-2 px-2 py-1.5 text-left",
                    active ? "border-l-accent bg-accent/10" : "border-l-transparent hover:bg-secondary/40")}
                >
                  <span className="flex items-center gap-1.5 truncate text-[12px] font-medium">
                    {(r.trialIndex ?? r.subIndex) != null && (
                      <span className="shrink-0 rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
                        第 {((r.trialIndex ?? r.subIndex) as number) + 1} 轮
                      </span>
                    )}
                    <span className="truncate">{r.questionTitle}</span>
                  </span>
                  {/* 逐轮题:显示该轮的子问题,区分各轮(否则标题都一样) */}
                  {r.subPrompt && (
                    <span className="truncate text-[10.5px] text-muted-foreground/90">
                      子问题：{r.subPrompt}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    {r.missing ? (
                      <Badge variant="muted">出错/无结果</Badge>
                    ) : (
                      <>
                        <Badge variant={r.verdict === "passed" ? "success" : "destructive"}>
                          {r.verdict === "passed" ? "通过" : "不通过"}
                        </Badge>
                        {r.autoScore != null && <span className="font-mono tabular-nums">{r.autoScore.toFixed(1)}</span>}
                        {r.agreementRate != null && <span>一致 {r.agreementRate}%</span>}
                      </>
                    )}
                    {r.employeeName && <span className="truncate">· {r.employeeName}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="min-w-0 flex-1 overflow-auto">
            {selected && !selected.missing && selected.evaluation && selectedQuestion ? (
              <>
                {selected.subIndex != null && (
                  <div className="mb-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-[11.5px]">
                    <span className="font-medium text-foreground">
                      第 {selected.subIndex + 1} 轮
                    </span>
                    {selected.subPrompt && (
                      <span className="ml-1.5 text-muted-foreground">
                        · 子问题：{selected.subPrompt}
                      </span>
                    )}
                  </div>
                )}
                <ResultSummary
                  question={selectedQuestion}
                  evals={[selected.evaluation]}
                  profiles={profiles}
                />
              </>
            ) : (
              <div className="p-6 text-center text-[12px] text-muted-foreground">
                {selected ? "该题本批无结果(出错或已删除)。" : "选择左侧一题查看详情。"}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
