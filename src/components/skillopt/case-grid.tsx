import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { caseTally, type RunStatus } from "@/lib/skillopt-stages";

/** 当前 rollout 的题块网格:通过(绿)/失败(红)/待(灰),当前题脉冲;hover 看 reason。 */
export function CaseGrid({ status }: { status: RunStatus }) {
  if (status.caseTotal == null) return null;
  const t = caseTally(status);
  const results = status.caseResults;
  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>正在跑题</span>
        <span>第 {t.done}/{t.total} 题</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: t.total }).map((_, i) => {
          const r = results[i];
          const current = i === results.length && results.length < t.total;
          const cls = r == null
            ? current ? "border border-accent bg-accent/20 animate-pulse" : "bg-muted/40"
            : r.hard === 1 ? "bg-success" : "bg-destructive";
          return (
            <span
              key={i}
              title={r?.reason ?? (current ? "评测中" : r ? (r.hard === 1 ? "通过" : "失败") : "待测")}
              className={cn("h-3.5 w-3.5 rounded-sm", cls)}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success" />通过 {t.pass}</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-destructive" />失败 {t.fail}</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />待 {t.pending}</span>
      </div>
    </Card>
  );
}
