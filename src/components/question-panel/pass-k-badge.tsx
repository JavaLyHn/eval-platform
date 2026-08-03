import type { PassKSummary } from "@/lib/multi-trial";
import { cn } from "@/lib/utils";

const STATUS_CLS: Record<PassKSummary["status"], string> = {
  green: "border-success/40 bg-success/10 text-success",
  partial: "border-warning/40 bg-warning/10 text-warning",
  incomplete: "border-border bg-muted text-muted-foreground",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** pass^k 三态角标:绿=全过达标 / 黄=有过有挂 / 灰=未跑满 / 红=全挂。 */
export function PassKBadge({ summary }: { summary: PassKSummary }) {
  const { passed, trials, k, status } = summary;
  const mark = status === "green" ? " ✓" : status === "red" ? " ✗" : "";
  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums",
        STATUS_CLS[status],
      )}
      title={`pass^${k}:${k} 次全过才算过。本会话 ${passed}/${trials} 次过${
        status === "incomplete" ? `(未跑满 ${k} 次)` : ""
      }`}
    >
      pass^{k} {passed}/{trials}
      {mark}
      {status === "incomplete" ? " 未满" : ""}
    </span>
  );
}
