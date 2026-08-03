import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";
import type { EvaluationRun, EvaluationRunStatus } from "@/types";

const IN_FLIGHT: EvaluationRunStatus[] = ["queued", "answering", "judging", "reporting"];
const TERMINAL: EvaluationRunStatus[] = ["done", "partial", "failed"];

/**
 * 跨页全局顶栏:评测运行在途时,任意页面顶部常驻一条「阶段 + 进度」;点击跳 /runs;
 * 跑完(done/partial/failed)显示结果条 4s 后淡出。解决"切到别的页 / 错过时机就看不见"。
 */
export function EvaluationRunBanner() {
  const { evaluationRuns, queue, judgeQueue, profiles } = useQAStore();
  const navigate = useNavigate();

  // 同一时刻至多一个在途 run。
  const active = evaluationRuns.find((r) => IN_FLIGHT.includes(r.status));
  const activeId = active?.id ?? null;

  const [finished, setFinished] = useState<EvaluationRun | null>(null);
  const lastActiveIdRef = useRef<string | null>(null);

  // 跟踪在途 run;它转终态(从在途列表消失)时,捕获最终态显示一会儿。
  useEffect(() => {
    if (activeId) {
      lastActiveIdRef.current = activeId;
      setFinished(null);
      return;
    }
    const lastId = lastActiveIdRef.current;
    if (!lastId) return;
    const done = evaluationRuns.find((r) => r.id === lastId);
    if (done && TERMINAL.includes(done.status)) {
      lastActiveIdRef.current = null;
      setFinished(done);
    }
  }, [activeId, evaluationRuns]);

  // 结果条 4s 后淡出。
  useEffect(() => {
    if (!finished) return;
    const t = window.setTimeout(() => setFinished(null), 4000);
    return () => window.clearTimeout(t);
  }, [finished?.id]);

  const nameOf = (pid: string) => profiles.find((p) => p.id === pid)?.name ?? pid;

  if (active) {
    const label = `${nameOf(active.subjectProfileId)} · ${active.versionLabel}`;
    let stage = "排队";
    let cur = 0;
    let tot = active.progress.total;
    let indeterminate = true;
    if (active.status === "answering") {
      stage = "答题中";
      cur = queue.completed.length;
      tot = queue.total || active.progress.total;
      indeterminate = false;
    } else if (active.status === "judging") {
      stage = "评分中";
      cur = judgeQueue.done;
      tot = judgeQueue.total || active.progress.total;
      indeterminate = false;
    } else if (active.status === "reporting") {
      stage = "出报告";
      indeterminate = true;
    }
    const pct = !indeterminate && tot ? Math.round((cur / tot) * 100) : 0;
    return (
      <button
        type="button"
        onClick={() => navigate("/runs")}
        className="relative flex w-full items-center gap-2 overflow-hidden border-b border-accent/30 bg-accent/10 px-3 py-1 text-left text-[11.5px] hover:bg-accent/15"
      >
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
        <span className="shrink-0 font-medium text-accent">评测运行</span>
        <span className="min-w-0 flex-1 truncate text-foreground/80">
          {label} — {stage}
          {indeterminate ? "…" : ` ${cur}/${tot}`}
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground">查看 →</span>
        <span
          className={cn("absolute bottom-0 left-0 h-0.5 bg-accent transition-all", indeterminate && "animate-pulse")}
          style={{ width: indeterminate ? "100%" : `${pct}%` }}
        />
      </button>
    );
  }

  if (finished) {
    const label = `${nameOf(finished.subjectProfileId)} · ${finished.versionLabel}`;
    const tone =
      finished.status === "done" ? "success" : finished.status === "partial" ? "warning" : "destructive";
    const Icon = finished.status === "failed" ? X : finished.status === "partial" ? AlertTriangle : Check;
    const word = finished.status === "done" ? "完成" : finished.status === "partial" ? "部分完成" : "失败";
    return (
      <button
        type="button"
        onClick={() => navigate("/runs")}
        className={cn(
          "flex w-full items-center gap-2 overflow-hidden border-b px-3 py-1 text-left text-[11.5px]",
          tone === "success" && "border-success/30 bg-success/10",
          tone === "warning" && "border-warning/30 bg-warning/10",
          tone === "destructive" && "border-destructive/30 bg-destructive/10",
        )}
      >
        <Icon
          className={cn(
            "h-3 w-3 shrink-0",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "destructive" && "text-destructive",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-foreground/80">
          评测运行{word} · {label}
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground">
          {finished.reportId ? "查看报告 →" : "查看 →"}
        </span>
      </button>
    );
  }

  return null;
}
