/**
 * 报告「对比版本」控件 — 放在报告页头部(复制 Markdown 同列下方)。
 * 选一个历史版本即弹窗,弹窗内高亮给出两版差异;选「对比版本…」清空则收起。
 * compareId / compareReport 仍由 ReportPreviewPage 持有(导出 MD 也用同一选择)。
 */

import { useMemo, useState } from "react";
import { Columns2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { diffReportMetrics, summarizeDiff } from "@/lib/report-metrics";
import type { EvaluationReport, MetricDiffRow, DiffSummary } from "@/types";

const DIFF_META: Record<DiffSummary, string> = {
  improved: "提升",
  declined: "下降",
  flat: "持平",
  mixed: "有升有降",
};

/** 差异表数值按量纲补单位:百分比类加 %,评分类原样(0-10)。 */
function fmtDiffValue(v: number | undefined, kind: "general" | "specific"): string {
  if (v == null) return "—";
  return kind === "general" ? `${v}%` : `${v}`;
}

export function ReportCompareControl({
  report,
  candidates,
  compareId,
  onCompareChange,
}: {
  report: EvaluationReport;
  /** 可对比的历史版本(同 Agent、带指标聚合、非自身)。 */
  candidates: EvaluationReport[];
  compareId: string;
  onCompareChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const m = report.metrics;
  const compareReport = candidates.find((c) => c.id === compareId) ?? null;
  const diff = useMemo(() => {
    if (!m || !compareReport?.metrics) return null;
    const rows = diffReportMetrics(m, compareReport.metrics);
    return { rows, summary: summarizeDiff(rows) };
  }, [m, compareReport]);

  // 没指标聚合 / 没可对比版本 → 不渲染(老报告或仅此一版)。
  if (!m || candidates.length === 0) return null;

  // 选版本 → 选中即弹窗;选「对比版本…」(空)则关窗。
  const handleSelect = (id: string) => {
    onCompareChange(id);
    setOpen(id !== "");
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Columns2 className="h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={compareId}
          onChange={(e) => handleSelect(e.target.value)}
          className="h-7 max-w-[12rem] rounded-md border border-border bg-card px-2 text-[11.5px] text-foreground"
          title="选择要对比的历史版本"
        >
          <option value="">对比版本…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}（{new Date(c.createdAt).toLocaleDateString()}）
            </option>
          ))}
        </select>
        {compareReport && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted"
          >
            查看对比
          </button>
        )}
      </div>

      {/* 对比弹窗:两边差异高亮给出 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 text-[14px]">
              版本对比
              {diff && (
                <Badge variant="outline" className="text-[10px] normal-case">
                  整体:{DIFF_META[diff.summary]}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* 可在弹窗内切换基线版本 */}
          <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
            对比版本
            <select
              value={compareId}
              onChange={(e) => onCompareChange(e.target.value)}
              className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-[12px] text-foreground"
            >
              <option value="">请选择…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}（{new Date(c.createdAt).toLocaleDateString()}）
                </option>
              ))}
            </select>
          </label>

          {diff && compareReport ? (
            <CompareDiff rows={diff.rows} compareTitle={compareReport.title} />
          ) : (
            <p className="rounded-md border border-dashed border-border/60 py-8 text-center text-[12px] text-muted-foreground">
              选择一个历史版本以查看两版差异。
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * 版本差异表(渲染在对比弹窗内):每行「上版 → 本版」,变化行整行染色 +
 * 本版值变色 + 右侧彩色变化角标(↑/↓ delta 变好/变差),让两边差别一眼可见。
 */
function CompareDiff({
  rows,
  compareTitle,
}: {
  rows: MetricDiffRow[];
  compareTitle: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        基线:<span className="text-foreground">{compareTitle}</span>(上版) → 本版(当前报告)
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-muted/40 text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-1.5 text-left font-medium">指标</th>
              <th className="px-3 py-1.5 text-right font-medium">上版</th>
              <th className="w-6 px-1 py-1.5 text-center font-medium" />
              <th className="px-3 py-1.5 text-right font-medium">本版</th>
              <th className="px-3 py-1.5 text-center font-medium">变化</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const changed = r.direction === "up" || r.direction === "down";
              const better =
                (r.direction === "up" && !r.betterWhenLower) ||
                (r.direction === "down" && r.betterWhenLower);
              const arrow = r.direction === "up" ? "↑" : r.direction === "down" ? "↓" : "";
              return (
                <tr
                  key={`${r.kind}-${r.key}`}
                  className={cn(
                    "border-t border-border/60",
                    changed && (better ? "bg-success/5" : "bg-destructive/5"),
                  )}
                >
                  <td className="px-3 py-1.5 text-foreground/90">{r.label}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {fmtDiffValue(r.prevValue, r.kind)}
                  </td>
                  <td className="px-1 text-center text-muted-foreground">→</td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono font-semibold tabular-nums",
                      changed ? (better ? "text-success" : "text-destructive") : "text-foreground",
                    )}
                  >
                    {fmtDiffValue(r.currValue, r.kind)}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {r.direction === "na" ? (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    ) : r.direction === "flat" ? (
                      <span className="text-[10px] text-muted-foreground">持平</span>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          better ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                        )}
                      >
                        {arrow}
                        {r.delta != null ? `${r.delta > 0 ? "+" : ""}${r.delta}` : ""}
                        <span className="ml-0.5">{better ? "变好" : "变差"}</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
