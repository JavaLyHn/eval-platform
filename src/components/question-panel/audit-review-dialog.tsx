import { useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck, ChevronLeft, ChevronRight, Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CombinedEditor } from "./evaluation-tab";
import { AttachmentList } from "@/components/question-panel/attachment-list";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";
import {
  FAILURE_CATEGORIES,
  FAILURE_CATEGORY_META,
} from "@/lib/failure-attribution";
import type { AuditItem } from "@/lib/audit-queue";
import type { ScoreDimension, FailureCategory } from "@/types";

/**
 * 发版门「抽审逐条复核」弹窗:在数据看板里直接对抽中的回答做**完整人工打分**
 * (逐维度评分 + 归因 + 备注 → 通过/不通过),不用跳去首页。判定落一条人工 Evaluation,
 * 发版门的 已复核/推翻/校准一致率 实时更新。判完自动进下一条。
 */
export function AuditReviewDialog({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  items: AuditItem[];
}) {
  const { questions, evaluations, profiles, recordAuditReview, getMessageAnswer } =
    useQAStore();
  const [idx, setIdx] = useState(0);
  const [scores, setScores] = useState<ScoreDimension[]>([]);
  const [notes, setNotes] = useState("");
  const [primary, setPrimary] = useState<FailureCategory | null>(null);

  const n = items.length;
  const safeIdx = Math.min(Math.max(idx, 0), Math.max(n - 1, 0));
  const item = items[safeIdx];
  const q = item ? questions.find((qq) => qq.id === item.questionId) : undefined;
  const reviewedCount = useMemo(
    () => items.filter((it) => it.reviewed).length,
    [items],
  );

  // 打开时定位到第一个未复核项
  useEffect(() => {
    if (!open) return;
    const firstPending = items.findIndex((it) => !it.reviewed);
    setIdx(firstPending >= 0 ? firstPending : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 切题 / 打开时:按该题评分维度重置草稿(默认 7/10),清空备注 / 归因
  useEffect(() => {
    if (!q) {
      setScores([]);
      setNotes("");
      setPrimary(null);
      return;
    }
    setScores(
      q.criteria.map((c) => ({ key: c.key, label: c.label, value: 7, max: 10 })),
    );
    setNotes("");
    setPrimary(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIdx, open, q?.id]);

  // 键盘操作:→ 下一条 / ← 上一条 / Enter 确认通过。焦点在输入控件(备注 / 滑杆 / 数字框)、
  // 按钮 / 链接,或按了修饰键时**不拦截**,让这些键各归其位(换行 / 移光标 / 激活按钮)。
  // submit 定义在早返回之后,经 submitRef 引用;方向键直接钳位 setIdx。(Esc 见 onEscapeKeyDown。)
  const submitRef = useRef<((v: "passed" | "failed") => void) | null>(null);
  useEffect(() => {
    if (!open || n === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Enter") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el?.closest(
          'input, textarea, select, button, a, [contenteditable="true"], [role="slider"], [role="spinbutton"], [role="button"]',
        )
      )
        return;
      e.preventDefault();
      if (k === "Enter") {
        submitRef.current?.("passed");
        return;
      }
      const delta = k === "ArrowRight" ? 1 : -1;
      setIdx((i) => Math.min(Math.max(i + delta, 0), n - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, n]);

  if (n === 0 || !item || !q) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-md"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-[14px]">抽审复核</DialogTitle>
          </DialogHeader>
          <div className="text-[12px] text-muted-foreground">
            暂无可复核的抽样项。
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const answer = getMessageAnswer(item.messageId);
  // 该回答对应的 LLM 评测 → 展示 judge 评语,让复查者看清「LLM 为何这么判」。
  const nameOf = (jid?: string) =>
    (jid && profiles.find((p) => p.id === jid)?.name) || "LLM 裁判";
  const llmEval =
    evaluations.find((e) => e.id === item.evaluationId) ??
    evaluations
      .filter(
        (e) =>
          e.messageId === item.messageId &&
          (e.judgeProfileId || (e.calibrationSnapshots?.length ?? 0) > 0),
      )
      .sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
      )[0];
  const llmJudges =
    llmEval?.calibrationSnapshots && llmEval.calibrationSnapshots.length > 0
      ? llmEval.calibrationSnapshots.map((s) => ({
          name: nameOf(s.judgeProfileId),
          verdict: s.verdict,
          notes: s.notes,
        }))
      : llmEval
        ? [{ name: nameOf(llmEval.judgeProfileId), verdict: llmEval.verdict, notes: llmEval.notes }]
        : [];
  const submit = (verdict: "passed" | "failed") => {
    recordAuditReview(item.questionId, item.messageId, {
      scores,
      notes: notes.trim(),
      verdict,
      attribution:
        verdict === "failed" && primary
          ? { primary, source: "manual" as const }
          : null,
    });
    if (safeIdx < n - 1) setIdx(safeIdx + 1); // 判完自动进下一条
  };
  submitRef.current = submit; // 供键盘 effect(早返回前声明)引用最新 submit
  const go = (delta: number) =>
    setIdx((i) => Math.min(Math.max(i + delta, 0), n - 1));

  // Esc = 推翻·不通过(拦截 Radix 默认「Esc 关弹窗」)。焦点在输入控件时不劫持:
  // 让 Esc 走默认(可关弹窗 / 失焦),避免打断填备注。
  const onEscapeKeyDown = (e: KeyboardEvent) => {
    const el = document.activeElement as HTMLElement | null;
    if (
      el?.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="spinbutton"]')
    )
      return;
    e.preventDefault();
    submit("failed");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88vh] max-w-2xl flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={onEscapeKeyDown}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[14px]">
            <ShieldCheck className="h-4 w-4 text-accent" /> 抽审复核
            <span className="text-[12px] font-normal text-muted-foreground">
              第 {safeIdx + 1}/{n} 条 · 已复核 {reviewedCount}/{n}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
          {/* 元信息 */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">{item.severity}</span>
            {item.forced && (
              <Badge variant="outline" className="border-destructive/40 text-destructive">
                P0/红线(全抽)
              </Badge>
            )}
            <Badge variant={item.autoVerdict === "passed" ? "success" : "destructive"}>
              LLM 判:{item.autoVerdict === "passed" ? "通过" : "失败"}
            </Badge>
            {item.reviewed && (
              <Badge
                variant={
                  item.humanVerdict !== item.autoVerdict ? "destructive" : "success"
                }
              >
                已复核:
                {item.humanVerdict !== item.autoVerdict
                  ? `推翻·${item.humanVerdict === "passed" ? "改判通过" : "改判不通过"}`
                  : "确认一致"}
              </Badge>
            )}
          </div>
          {/* 双向抽审:LLM 判通过的查漏判(人工是否否掉),LLM 判失败的查错杀(人工是否放行)。 */}
          <p className="-mt-1.5 text-[10.5px] text-muted-foreground/80">
            {item.autoVerdict === "passed"
              ? "该回答 LLM 判「通过」——人工复查是否漏判(是否该判不通过)。"
              : "该回答 LLM 判「失败」——人工复查是否错杀(是否其实该通过)。"}
          </p>

          {/* 题面 */}
          <div>
            <div className="mb-0.5 text-[11px] text-muted-foreground">题目</div>
            <div className="text-[13px] font-medium text-foreground">{q.title}</div>
            <div className="mt-1 break-words rounded-md border border-border bg-background/40 px-3 py-2 text-[12.5px] text-foreground">
              <Markdown>{q.prompt}</Markdown>
            </div>
            {/* 题目附件(随题发送给 agent),复查时和 agent 当时看到的一致 */}
            {q.attachments && q.attachments.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 text-[10.5px] text-muted-foreground">
                  附件（随题发送给 agent · {q.attachments.length}）
                </div>
                <AttachmentList attachments={q.attachments} />
              </div>
            )}
          </div>

          {/* agent 回答 */}
          <div>
            <div className="mb-0.5 text-[11px] text-muted-foreground">Agent 回答</div>
            <div className="max-h-[28vh] overflow-auto break-words rounded-md border border-border bg-background/40 px-3 py-2 text-[12.5px] text-foreground/90">
              {answer ? (
                <Markdown fileCards>{answer}</Markdown>
              ) : (
                <span className="text-muted-foreground">(找不到该回答存档)</span>
              )}
            </div>
          </div>

          {/* LLM 判据:LLM 为什么这么判,供人工复查参照(多裁判逐个列出) */}
          {llmJudges.some((j) => (j.notes || "").trim()) && (
            <div>
              <div className="mb-0.5 text-[11px] text-muted-foreground">
                LLM 判据（为何这么判）
              </div>
              <div className="space-y-1.5">
                {llmJudges.map((j, i) => (
                  <div
                    key={i}
                    className="break-words rounded-md border border-border bg-background/40 px-3 py-2 text-[12px] text-foreground/85"
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                      🤖 {j.name}
                      <Badge
                        variant={j.verdict === "passed" ? "success" : "destructive"}
                        className="h-4 px-1 text-[9px]"
                      >
                        {j.verdict === "passed" ? "通过" : "失败"}
                      </Badge>
                    </div>
                    {(j.notes || "").trim() ? (
                      <Markdown>{j.notes as string}</Markdown>
                    ) : (
                      <span className="text-muted-foreground">（无评语）</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 逐维度打分(复用首页评分编辑器) */}
          <CombinedEditor
            scoreDraft={scores}
            setScoreDraft={setScores}
            question={q}
            mode="manual"
            llmScored={false}
            judging={false}
          />

          {/* 备注 */}
          <div>
            <div className="mb-0.5 text-[11px] text-muted-foreground">备注(可选)</div>
            <Textarea
              value={notes}
              placeholder="复核备注…"
              className="min-h-[56px] text-[12px]"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* 失败归因(判「不通过」时填,可选) */}
          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">
              失败归因(判「不通过」时选,可选)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FAILURE_CATEGORIES.map((cat) => {
                const on = primary === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setPrimary(on ? null : cat)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] transition-colors",
                      on
                        ? "border-foreground/30 bg-foreground text-background"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {FAILURE_CATEGORY_META[cat].label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 判定 + 翻页 */}
        <div className="shrink-0 space-y-2 border-t border-border pt-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => submit("failed")}
              title={`${item.autoVerdict === "failed" ? "确认不通过" : "推翻·改判不通过"}(Esc)`}
            >
              <X className="h-3.5 w-3.5" />{" "}
              {item.autoVerdict === "failed" ? "确认不通过" : "推翻·改判不通过"}
            </Button>
            <Button
              size="sm"
              className="flex-1 gap-1 bg-success text-background hover:bg-success/90"
              onClick={() => submit("passed")}
              title={`${item.autoVerdict === "passed" ? "确认通过" : "推翻·改判通过"}(Enter)`}
            >
              <Check className="h-3.5 w-3.5" />{" "}
              {item.autoVerdict === "passed" ? "确认通过" : "推翻·改判通过"}
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              disabled={safeIdx === 0}
              onClick={() => go(-1)}
              title="上一条(←)"
            >
              <ChevronLeft className="h-4 w-4" /> 上一条
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
              title="下一条(→)"
            >
              下一条 <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
