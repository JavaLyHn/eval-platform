/**
 * §6 指标聚合块 — 渲染在 ReportPreviewPage 逐题明细之上。
 * 报告头 + 通用指标表 + 专属指标表 + 强约束 + 结论。
 * 对比版本入口已上移到报告页头部(见 ReportCompareControl)。
 * 老报告(无 report.metrics)→ 返回 null(不渲染)。
 */

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { passKWasRun } from "@/lib/report-metrics";
import { useQAStore } from "@/hooks/use-qa-store";
import type { EvaluationReport, MetricRow, ReportConclusion } from "@/types";

const CONCLUSION_META: Record<ReportConclusion, { label: string; cls: string }> = {
  pass: { label: "通过全量发布", cls: "bg-success/15 text-success" },
  limited: { label: "限定通过", cls: "bg-warning/15 text-warning" },
  blocked: { label: "未通过(不可全量发布)", cls: "bg-destructive/15 text-destructive" },
};

/** 通用指标的精简解释(渲染在指标名下方,降低专有名词理解门槛)。 */
const METRIC_HINT: Record<string, string> = {
  completion: "有实质回答的题占比(空答 / 中断不计)",
  "silent-error": "答错却没声明「不确定」的占比,越低越好",
  boundary: "超范围题里正确拒答 / 反问 / 升级的占比",
  consistency: "多 trial 题里「重跑 k 次全过」的占比 = pass^k 通过率(保下限)",
  satisfaction: "需人工采集,系统不自动计算",
  redline: "触碰安全红线的失败条数,>0 即一票否决、不可发布",
};

function statusBadge(s: MetricRow["status"]) {
  switch (s) {
    case "pass":
      return <Badge variant="success" className="text-[10px]">达标</Badge>;
    case "fail":
      return <Badge variant="destructive" className="text-[10px]">未达标</Badge>;
    case "manual":
      return <Badge variant="muted" className="text-[10px]">需人工</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">N/A</Badge>;
  }
}

function MetricTable({
  rows,
  title,
  hints = METRIC_HINT,
  onEditManual,
}: {
  rows: MetricRow[];
  title: string;
  /** 指标名下方的精简解释;省略则用默认全集。传入裁剪过的 map 可隐藏个别 hint。 */
  hints?: Record<string, string>;
  /** 人工采集指标(row.manual)点「录入 / 改」回调;缺省则不显示录入入口(如导出预览)。 */
  onEditManual?: (row: MetricRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-muted/40 text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-1.5 text-left font-medium">指标</th>
              <th className="px-3 py-1.5 text-right font-medium">目标</th>
              <th className="px-3 py-1.5 text-right font-medium">实测</th>
              <th className="px-3 py-1.5 text-center font-medium">判定</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border/60">
                <td className="px-3 py-1.5 text-foreground/90">
                  {r.label}
                  {hints[r.key] && (
                    <span className="mt-0.5 block text-[10px] font-normal leading-snug text-muted-foreground">
                      {hints[r.key]}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                  {r.target == null ? "—" : r.kind === "specific" ? `${r.target}/10` : `${r.target}%`}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-foreground">
                  {r.manual && onEditManual ? (
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span>{r.actualLabel}</span>
                      <button
                        type="button"
                        onClick={() => onEditManual(r)}
                        className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 font-sans text-[10px] text-accent hover:bg-accent/10"
                        title="手动录入人工采集的实测值"
                      >
                        <Pencil className="h-3 w-3" />
                        {r.actualValue != null ? "改" : "录入"}
                      </button>
                    </span>
                  ) : (
                    r.actualLabel
                  )}
                </td>
                <td className="px-3 py-1.5 text-center">{statusBadge(r.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ReportMetricsBlock({ report }: { report: EvaluationReport }) {
  const { setReportManualMetric } = useQAStore();
  const [editRow, setEditRow] = useState<MetricRow | null>(null);
  const m = report.metrics;
  if (!m) return null;
  const concl = CONCLUSION_META[m.conclusion];
  const h = report.header;

  // pass^k 是否真的跑了多次(k≥2 且有多 trial 实测)。没跑就整行隐藏「一致性」——
  // 单次跑出来的 pass^1 / 「未跑多 trial」没有意义,会误导。跑了才显示并带「· pass^k 通过率」。
  const passKRan = passKWasRun(m);
  const generalRows = passKRan
    ? m.general.map((r) =>
        r.key === "consistency" ? { ...r, label: `${r.label} · pass^${m.k} 通过率` } : r,
      )
    : m.general.filter((r) => r.key !== "consistency");

  const hasHeader = !!(
    h && (h.businessOwner || h.techOwner || h.approver || h.targetReleaseDate || h.period)
  );

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      {/* 报告头(有字段才显示) */}
      {hasHeader && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground sm:grid-cols-3">
          {h!.businessOwner && <div>业务负责人:<span className="text-foreground">{h!.businessOwner}</span></div>}
          {h!.techOwner && <div>技术负责人:<span className="text-foreground">{h!.techOwner}</span></div>}
          {h!.approver && <div>审批人:<span className="text-foreground">{h!.approver}</span></div>}
          {h!.period && <div>评测周期:<span className="text-foreground">{h!.period}</span></div>}
          {h!.targetReleaseDate && <div>目标发布日:<span className="text-foreground">{h!.targetReleaseDate}</span></div>}
        </div>
      )}

      <MetricTable
        rows={generalRows}
        title={`通用指标(${generalRows.length} 项)`}
        onEditManual={setEditRow}
      />
      <MetricTable rows={m.specific} title="角色专属指标" onEditManual={setEditRow} />

      {/* 强约束 */}
      <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[11.5px]">
        强约束(红线 + 静默错误):
        <span className={cn("ml-1 font-semibold", m.strongConstraint.allMet ? "text-success" : "text-destructive")}>
          {m.strongConstraint.allMet ? "全达标" : "未全达标"}
        </span>
      </div>

      {/* 结论 */}
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-muted-foreground">结论:</span>
        <span className={cn("rounded px-2 py-0.5 text-[11.5px] font-semibold", concl.cls)}>{concl.label}</span>
        <span className="text-[10.5px] text-muted-foreground">(自动建议 · 可人工复核)</span>
      </div>

      {/* 判定状态 + 名词解释(消除「N/A 为啥这样」的困惑) */}
      <details className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-foreground/80">
          判定状态 & 名词解释
        </summary>
        <div className="mt-2 space-y-1.5 leading-relaxed">
          <div>
            <span className="font-medium text-foreground/80">判定列:</span>{" "}
            <Badge variant="success" className="mx-0.5 text-[9.5px]">达标</Badge>实测达到所设目标 ·{" "}
            <Badge variant="destructive" className="mx-0.5 text-[9.5px]">未达标</Badge>未达目标 ·{" "}
            <Badge variant="muted" className="mx-0.5 text-[9.5px]">需人工</Badge>只能人工采集(如满意度) ·{" "}
            <Badge variant="outline" className="mx-0.5 text-[9.5px]">N/A</Badge>
            <span className="text-foreground/80">未设目标值 → 只展示实测、不做达标判定</span>(在生成报告时「高级选项」里填目标值即可改为达标 / 未达标)。
          </div>
          {passKRan && (
            <div>
              <span className="font-medium text-foreground/80">pass^k</span>:同一题独立重跑 k 次、k 次全过才算这题过(保下限,抵消模型随机性)。
            </div>
          )}
          <div>
            <span className="font-medium text-foreground/80">加权得分</span>:各评分维度按权重合成的 0-10 分;
            <span className="font-medium text-foreground/80"> 一致率</span>:多裁判 Pass/Fail 投票一致的比例,≥85% 视为校准达标。
          </div>
        </div>
      </details>

      <ManualMetricDialog
        row={editRow}
        onClose={() => setEditRow(null)}
        onSave={(value) => {
          if (editRow) setReportManualMetric(report.id, editRow.key, value);
          setEditRow(null);
        }}
      />
    </div>
  );
}

/**
 * 人工采集指标(如满意度)的实测值录入弹窗。量纲随指标 kind:专属 0-10、通用 0-100。
 * 「清除」= 恢复「需人工采集」。空输入 + 保存 也视为清除。
 */
function ManualMetricDialog({
  row,
  onClose,
  onSave,
}: {
  row: MetricRow | null;
  onClose: () => void;
  onSave: (value: number | null) => void;
}) {
  const isSpecific = row?.kind === "specific";
  const maxV = isSpecific ? 10 : 100;
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(row?.actualValue != null ? String(row.actualValue) : "");
  }, [row]);

  const commit = () => {
    const raw = draft.trim();
    if (raw === "") return onSave(null); // 空 = 清除
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    onSave(Math.max(0, Math.min(maxV, v)));
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle>录入「{row.label}」实测值</DialogTitle>
              <DialogDescription>
                该指标需人工采集、系统不自动计算。填入实测值(0–{maxV}
                {isSpecific ? " 分" : "%"});有目标值则据此判达标 / 未达标,留空保存即恢复「需人工采集」。
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={maxV}
                step={isSpecific ? 0.1 : 1}
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                }}
                className="w-32"
                placeholder={`0–${maxV}`}
              />
              <span className="text-[13px] text-muted-foreground">
                {isSpecific ? "/ 10" : "%"}
              </span>
              {row.target != null && (
                <span className="ml-auto text-[11.5px] text-muted-foreground">
                  目标 {isSpecific ? `${row.target}/10` : `${row.target}%`}
                </span>
              )}
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => onSave(null)}
              >
                清除(恢复需人工采集)
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>
                  取消
                </Button>
                <Button size="sm" onClick={commit}>
                  保存
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
