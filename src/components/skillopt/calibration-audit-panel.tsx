import { useEffect, useState } from "react";
import { ShieldCheck, AlertTriangle, ListChecks, ChevronLeft, ChevronRight, ChevronDown, Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { calibrationSummary, type SkillEvalReport } from "@/lib/skill-report";
import type { SkillOptCase } from "@/lib/skillopt-client";

type CalMark = { caseId: string; autoCorrect: boolean; note?: string };

interface Props {
  report: SkillEvalReport;
  onMark: (m: { caseId: string; autoCorrect: boolean; note?: string }) => void;
}

export function CalibrationAuditPanel({ report, onMark }: Props) {
  const cases = report.frame.cases ?? [];
  const cal = calibrationSummary(report);
  const markById = new Map((report.audit?.marks ?? []).map((m) => [m.caseId, m]));
  const [reviewOpen, setReviewOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (cases.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-[12px] text-muted-foreground">
        本次未评测留出集,无可审项。
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground hover:text-foreground/80"
          aria-expanded={!collapsed}
          title={collapsed ? "展开" : "收起"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <ShieldCheck className="h-4 w-4 text-foreground/70" /> 校准 / 抽审(留出集)
        </button>
        <div className="flex items-center gap-2.5">
          <span className="text-[11.5px] text-muted-foreground">
            已审 {cal.reviewed}/{cal.heldoutTotal} · 一致 {cal.agreePct ?? "—"}%
            {cal.redlineOverturns > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> 红线翻案 {cal.redlineOverturns}
              </span>
            )}
          </span>
          {/* 逐题弹窗确认:每题一个聚焦视图,不用在长列表里上下滚 */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 text-[11px]"
            onClick={() => setReviewOpen(true)}
          >
            <ListChecks className="h-3.5 w-3.5" /> 逐题确认
          </Button>
        </div>
      </div>
      {!collapsed && (
      <ul className="divide-y divide-border">
        {cases.map((c) => {
          const m = markById.get(c.id);
          const redline = c.caseType === "interception";
          const overturned = m && !m.autoCorrect;
          return (
            <li key={c.id} className={cn("space-y-1.5 px-4 py-3", overturned && "border-l-2 border-destructive")}>
              <div className="flex items-center gap-2 text-[11px]">
                {redline && <Badge variant="outline" className="border-destructive/40 text-destructive">红线</Badge>}
                <Badge variant={c.bestHard === 1 ? "outline" : "muted"}>
                  auto {c.bestHard === 1 ? "通过" : "未过"}
                </Badge>
                {c.bestFailReason && <span className="text-muted-foreground">{c.bestFailReason}</span>}
              </div>
              <div className="break-words text-[12px] text-foreground"><span className="text-muted-foreground">题:</span>{c.prompt}</div>
              <div className="break-words whitespace-pre-wrap text-[12px] text-foreground/90">
                <span className="text-muted-foreground">模型回复:</span>
                {c.bestAnswer ? c.bestAnswer : <span className="text-muted-foreground">(无留出回复存档)</span>}
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  aria-pressed={m?.autoCorrect === true}
                  onClick={() => onMark({ caseId: c.id, autoCorrect: true, note: m?.note })}
                  className={cn("rounded px-2 py-1 text-[11.5px]", m?.autoCorrect === true ? "bg-success/15 text-success" : "border border-border text-muted-foreground hover:text-foreground")}
                >
                  auto 对
                </button>
                <button
                  type="button"
                  aria-pressed={m?.autoCorrect === false}
                  onClick={() => onMark({ caseId: c.id, autoCorrect: false, note: m?.note })}
                  className={cn("rounded px-2 py-1 text-[11.5px]", m?.autoCorrect === false ? "bg-destructive/15 text-destructive" : "border border-border text-muted-foreground hover:text-foreground")}
                >
                  auto 错
                </button>
                <NoteInput
                  key={`${c.id}-${m?.autoCorrect ?? "none"}`}
                  caseId={c.id}
                  value={m?.note ?? ""}
                  autoCorrect={m?.autoCorrect}
                  onMark={onMark}
                />
              </div>
            </li>
          );
        })}
      </ul>
      )}
      <CalibrationReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        cases={cases}
        markById={markById}
        onMark={onMark}
      />
    </div>
  );
}

/** 逐题校准弹窗:每题一个聚焦视图(题面 + 模型回复 + auto判分),点 auto对/错 自动跳下一题。
 *  解决「校准列表很长、要一边滚一边判」的体验问题。 */
function CalibrationReviewDialog({
  open,
  onOpenChange,
  cases,
  markById,
  onMark,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cases: SkillOptCase[];
  markById: Map<string, CalMark>;
  onMark: Props["onMark"];
}) {
  const n = cases.length;
  const [idx, setIdx] = useState(0);
  const [note, setNote] = useState("");
  const safeIdx = Math.min(Math.max(idx, 0), Math.max(n - 1, 0));
  const c = cases[safeIdx];

  // 打开时跳到第一个未审的题(都审过则从头)
  useEffect(() => {
    if (!open) return;
    const firstUnreviewed = cases.findIndex((cc) => !markById.has(cc.id));
    setIdx(firstUnreviewed >= 0 ? firstUnreviewed : 0);
    // markById 每次渲染重建,只在开关时定位,故不入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 切题 / 打开时,把备注同步成当前题已有备注
  useEffect(() => {
    setNote(c ? (markById.get(c.id)?.note ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIdx, open]);

  if (n === 0 || !c) return null;
  const m = markById.get(c.id);
  const reviewed = cases.filter((cc) => markById.has(cc.id)).length;
  const redline = c.caseType === "interception";

  const mark = (autoCorrect: boolean) => {
    onMark({ caseId: c.id, autoCorrect, note: note.trim() || undefined });
    if (safeIdx < n - 1) setIdx(safeIdx + 1); // 判完自动进下一题
  };
  const go = (delta: number) =>
    setIdx((i) => Math.min(Math.max(i + delta, 0), n - 1));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] max-w-2xl flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[14px]">
            <ShieldCheck className="h-4 w-4 text-accent" /> 逐题校准
            <span className="text-[12px] font-normal text-muted-foreground">
              第 {safeIdx + 1}/{n} 题 · 已审 {reviewed}/{n}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {redline && (
              <Badge variant="outline" className="border-destructive/40 text-destructive">
                红线
              </Badge>
            )}
            <Badge variant={c.bestHard === 1 ? "outline" : "muted"}>
              auto {c.bestHard === 1 ? "通过" : "未过"}
            </Badge>
            {m && (
              <Badge variant={m.autoCorrect ? "success" : "destructive"}>
                已判:{m.autoCorrect ? "auto 对" : "auto 错"}
              </Badge>
            )}
            {c.bestFailReason && (
              <span className="text-muted-foreground">{c.bestFailReason}</span>
            )}
          </div>

          <div>
            <div className="mb-0.5 text-[11px] text-muted-foreground">题目</div>
            <div className="break-words rounded-md border border-border bg-background/40 px-3 py-2 text-[12.5px] text-foreground">
              {c.prompt}
            </div>
          </div>

          <div>
            <div className="mb-0.5 text-[11px] text-muted-foreground">模型回复</div>
            <div className="max-h-[34vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/40 px-3 py-2 text-[12.5px] text-foreground/90">
              {c.bestAnswer ? c.bestAnswer : <span className="text-muted-foreground">(无留出回复存档)</span>}
            </div>
          </div>

          <div>
            <div className="mb-0.5 text-[11px] text-muted-foreground">备注(可选)</div>
            <Input
              value={note}
              placeholder="备注…"
              className="h-8 text-[12px]"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {/* 判定 + 翻页 */}
        <div className="shrink-0 space-y-2 border-t border-border pt-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "flex-1 gap-1",
                m?.autoCorrect === true && "border-success/40 bg-success/15 text-success",
              )}
              onClick={() => mark(true)}
            >
              <Check className="h-3.5 w-3.5" /> auto 对
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "flex-1 gap-1",
                m?.autoCorrect === false && "border-destructive/40 bg-destructive/15 text-destructive",
              )}
              onClick={() => mark(false)}
            >
              <X className="h-3.5 w-3.5" /> auto 错
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              disabled={safeIdx === 0}
              onClick={() => go(-1)}
            >
              <ChevronLeft className="h-4 w-4" /> 上一题
            </Button>
            <span className="font-mono text-[11px] text-muted-foreground">
              {safeIdx + 1} / {n}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              disabled={safeIdx === n - 1}
              onClick={() => go(1)}
            >
              下一题 <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NoteInput({ caseId, value, autoCorrect, onMark }: {
  caseId: string; value: string; autoCorrect?: boolean; onMark: Props["onMark"];
}) {
  const [draft, setDraft] = useState(value);
  const disabled = autoCorrect === undefined;
  return (
    <Input
      value={draft}
      disabled={disabled}
      placeholder="备注(可选)"
      title={disabled ? "请先点「auto 对」或「auto 错」" : undefined}
      className="h-7 flex-1 text-[11.5px]"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value && autoCorrect !== undefined) onMark({ caseId, autoCorrect, note: draft });
      }}
    />
  );
}
