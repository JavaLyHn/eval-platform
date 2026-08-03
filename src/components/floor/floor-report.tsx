import { useMemo, useState } from "react";
import { ListTree } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TranscriptViewerDialog } from "@/components/agent-panel/transcript-viewer-dialog";
import { useQAStore } from "@/hooks/use-qa-store";
import { buildFloorReport, DEFAULT_K, type ElementStatus } from "@/lib/floor-report-logic";
import { FLOOR_CATEGORY_LABELS } from "@/lib/floor-elements";
import { cn } from "@/lib/utils";
import type { AgentTranscript } from "@/types";

const STATUS_META: Record<ElementStatus, { icon: string; label: string; cls: string }> = {
  green: { icon: "🟢", label: "在位", cls: "text-success" },
  red: { icon: "🔴", label: "破", cls: "text-destructive" },
  partial: { icon: "🟡", label: "部分/不稳定", cls: "text-warning" },
  uncovered: { icon: "⚪", label: "未覆盖", cls: "text-muted-foreground" },
};

export function FloorReport({ employeeId }: { employeeId: string }) {
  const {
    floorElements,
    questions,
    evaluations,
    conversations,
    employeeProfileMap,
    standardEmployees,
  } = useQAStore();

  const employee = standardEmployees.find((e) => e.id === employeeId);
  const agentProfileId =
    employeeProfileMap[employeeId] ?? employee?.associatedProfileId ?? undefined;

  const K = DEFAULT_K;

  const report = useMemo(
    () =>
      buildFloorReport({
        employeeId,
        k: K,
        elements: floorElements.filter((f) => f.employeeId === employeeId),
        questions,
        evaluations,
        agentProfileId,
      }),
    [employeeId, floorElements, questions, evaluations, agentProfileId],
  );

  const transcriptByQuestion = useMemo(() => {
    const map = new Map<string, AgentTranscript>();
    for (const c of conversations) {
      const msgs = c.messages ?? [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.questionId && m.transcript && !map.has(m.questionId)) {
          map.set(m.questionId, m.transcript);
        }
      }
    }
    return map;
  }, [conversations]);

  const [viewing, setViewing] = useState<AgentTranscript | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-[13px] font-semibold",
          report.verdict === "达标"
            ? "border-success/40 bg-success/10 text-success"
            : "border-destructive/40 bg-destructive/10 text-destructive",
        )}
      >
        {report.verdict === "达标" ? "✅ 达标" : "❌ 未达"}
        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
          🟢{report.greenCount} 🔴{report.redCount} 🟡{report.partialCount} ⚪
          {report.uncoveredCount}
        </span>
      </div>

      <p className="text-[10.5px] leading-snug text-muted-foreground">
        "达标"= 探针集内、按输出判、pass^k（k={K}）下零缺口，非绝对零缺口。
        {report.elements.some((e) => e.probes.some((p) => p.trials < K)) &&
          " ⚠️ 部分探针 trial 数 < k，pass^k 待多 trial 接入。"}
      </p>

      {report.verdict === "未达" && report.reasons.length > 0 && (
        <div className="rounded border border-border bg-card px-2.5 py-1.5 text-[11px]">
          <span className="text-muted-foreground">未达点名：</span>
          {report.reasons.join("、")}
        </div>
      )}

      <ScrollArea className="-mx-1 flex-1">
        <ul className="space-y-1 px-1 pb-2">
          {report.elements.length === 0 && (
            <li className="px-2 py-6 text-center text-[11.5px] text-muted-foreground">
              该员工还没有下限要素。先去「下限清单」生成种子。
            </li>
          )}
          {report.elements.map((er) => {
            const meta = STATUS_META[er.status];
            const totalTrials = er.probes.reduce((s, p) => s + p.trials, 0);
            const passPowerKCount = er.probes.filter((p) => p.passPowerK).length;
            const probeWithTranscript = er.probes
              .map((p) => transcriptByQuestion.get(p.questionId))
              .find(Boolean);
            return (
              <li
                key={er.element.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-[12.5px]"
              >
                <span className={cn("text-[14px]", meta.cls)} title={meta.label}>
                  {meta.icon}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">
                      {er.element.title}
                    </span>
                    {er.element.isRedLine && (
                      <Badge variant="destructive" className="text-[9.5px]">
                        红线
                      </Badge>
                    )}
                    {er.lowConfidence && (
                      <Badge variant="muted" className="text-[9.5px]">
                        ⚠️ 低置信
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {er.element.layer} · {FLOOR_CATEGORY_LABELS[er.element.category]} ·{" "}
                    探针 {er.probes.length} · pass^k {passPowerKCount}/
                    {er.probes.length} · 共 {totalTrials} trial
                  </div>
                </div>
                {probeWithTranscript && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-6 w-6 text-muted-foreground"
                    onClick={() => setViewing(probeWithTranscript)}
                    title="查看轨迹"
                  >
                    <ListTree className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      {viewing && (
        <TranscriptViewerDialog
          transcript={viewing}
          open={!!viewing}
          onOpenChange={(o) => !o && setViewing(null)}
        />
      )}
    </div>
  );
}
