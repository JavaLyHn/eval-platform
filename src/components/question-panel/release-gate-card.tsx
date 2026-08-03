/**
 * 发版门(合并卡):红线硬判 / 校准 / 抽审三项检查收进一张卡,
 * 结论 chip 在头部(✅ 可全量发布 / ⛔ 不可发版 / ⚠️ 样本不足),
 * 解释性文案全部收进 ⓘ tooltip,明细按需展开 —— 结论先行、解释按需。
 */

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  HelpCircle,
  Minus,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { computeCalibration, CALIBRATION_THRESHOLD } from "@/lib/calibration";
import { computeAuditQueue } from "@/lib/audit-queue";
import { AuditReviewDialog } from "./audit-review-dialog";
import {
  CLICKABLE_ROW,
  QuestionPreviewSheet,
} from "./question-preview-sheet";
import type { ReleaseGateResult } from "@/lib/release-gate";
import type { Evaluation, Question } from "@/types";

/** 低于这个题数,发布结论降级为「样本不足,仅供参考」(黄金准则:别信小样本)。 */
export const MIN_RELEASE_SAMPLE = 10;

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <HelpCircle className="h-3 w-3 cursor-help text-muted-foreground/70" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{text}</TooltipContent>
    </Tooltip>
  );
}

function GateRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5 text-[12px]">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="w-16 shrink-0 font-medium text-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ReleaseGateCard({
  evaluations,
  questions,
  releaseGate,
  rate,
  onRateChange,
}: {
  evaluations: Evaluation[];
  questions: Question[];
  releaseGate: ReleaseGateResult;
  rate: number;
  onRateChange: (r: number) => void;
}) {
  const cal = computeCalibration(evaluations);
  const audit = computeAuditQueue(evaluations, questions, rate);
  // 逐条复核弹窗用:抽中项(已审 + 待审)合并 + 确定性排序(P0/红线在前),
  // 复核后仅 reviewed 标志翻转、成员/顺序不变 → 弹窗翻页不会跳。
  const reviewItems = [...audit.pending, ...audit.reviewed].sort(
    (a, b) =>
      Number(b.forced) - Number(a.forced) ||
      a.messageId.localeCompare(b.messageId),
  );
  const titleOf = (qid: string) =>
    questions.find((q) => q.id === qid)?.title ?? qid;
  const mark = (v: "passed" | "failed") => (v === "passed" ? "✅" : "❌");

  const [blockersOpen, setBlockersOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rateDraft, setRateDraft] = useState(() =>
    String(Math.round(rate * 100)),
  );
  useEffect(() => {
    setRateDraft(String(Math.round(rate * 100)));
  }, [rate]);

  // 红线明细 / 分歧 / 抽审队列里的题可点开只读预览。
  const [preview, setPreview] = useState<Question | null>(null);
  const openPreview = (qid: string | undefined) => {
    if (!qid) return;
    const q = questions.find((x) => x.id === qid);
    if (q) setPreview(q);
  };
  const clickToPreview = (qid: string | undefined) =>
    qid
      ? {
          role: "button" as const,
          tabIndex: 0,
          title: "点击预览题目",
          onClick: () => openPreview(qid),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPreview(qid);
            }
          },
        }
      : {};

  // 结论三态:红线失败 → ⛔;样本不足 → ⚠️(不给绿色全量发布的虚假信心);否则 ✅。
  const lowSample = questions.length < MIN_RELEASE_SAMPLE;
  const verdict: "block" | "low" | "ok" = !releaseGate.canRelease
    ? "block"
    : lowSample
      ? "low"
      : "ok";

  return (
    <section
      className={cn(
        "rounded-lg border p-3",
        verdict === "block" && "border-destructive/50 bg-destructive/5",
        verdict === "low" && "border-warning/40 bg-warning/5",
        verdict === "ok" && "border-success/40 bg-success/5",
      )}
    >
      {/* 头部:结论 chip */}
      <div className="flex items-center gap-2">
        {verdict === "block" ? (
          <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
        ) : verdict === "low" ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        ) : (
          <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
        )}
        <span className="text-[13px] font-semibold text-foreground">发版门</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[11.5px] font-semibold",
            verdict === "block" && "bg-destructive/15 text-destructive",
            verdict === "low" && "bg-warning/15 text-warning",
            verdict === "ok" && "bg-success/15 text-success",
          )}
        >
          {verdict === "block"
            ? `⛔ 不可发版 · ${releaseGate.blockers.length} 条红线失败`
            : verdict === "low"
              ? `⚠️ 样本不足(${questions.length} 题)· 结论仅供参考`
              : "✅ 可全量发布"}
        </span>
        <span className="ml-auto">
          <InfoTip
            text={`发版三检:① 红线硬判(强约束一票否决,失败即不可发版,凌驾于通过率/平均分);② judge 校准(人工 vs 自动一致率 ≥ ${CALIBRATION_THRESHOLD}%);③ 自动判人工抽审(通过项查漏判 + 失败项查错杀,双向)。题数 < ${MIN_RELEASE_SAMPLE} 时结论降级为「样本不足」。`}
          />
        </span>
      </div>

      {/* 三行检查清单 */}
      <div className="mt-1.5 divide-y divide-border/50">
        {/* ① 红线硬判 */}
        <GateRow
          icon={
            releaseGate.canRelease ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
            )
          }
          label="红线硬判"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                releaseGate.canRelease
                  ? "text-muted-foreground"
                  : "font-medium text-destructive",
              )}
            >
              {releaseGate.canRelease
                ? "0 失败"
                : `${releaseGate.blockers.length} 条失败(一票否决)`}
            </span>
            <InfoTip text="安全红线失败即不可发版,凌驾于通过率 / 平均分(强约束一票否决)。" />
            {releaseGate.blockers.length > 0 && (
              <button
                type="button"
                onClick={() => setBlockersOpen((v) => !v)}
                className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {blockersOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                明细
              </button>
            )}
          </div>
          {blockersOpen && releaseGate.blockers.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11.5px] text-destructive/90">
              {releaseGate.blockers.map((b, i) => (
                <li
                  key={b.key ?? i}
                  className={cn("truncate rounded px-1", b.key && CLICKABLE_ROW)}
                  {...clickToPreview(b.key)}
                >
                  · {b.owner ? `[${b.owner}] ` : ""}
                  {b.label ?? b.key ?? "未命名题"}
                </li>
              ))}
            </ul>
          )}
        </GateRow>

        {/* ② 校准 */}
        <GateRow
          icon={
            cal.n === 0 ? (
              <Minus className="h-3.5 w-3.5 text-muted-foreground/60" />
            ) : cal.gatePass ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            )
          }
          label="校准"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {cal.n === 0 ? (
              <span className="text-muted-foreground">样本不足</span>
            ) : (
              <span
                className={cn(
                  cal.gatePass
                    ? "text-muted-foreground"
                    : "font-medium text-destructive",
                )}
              >
                一致率 {cal.agreementPct}%({cal.n - cal.disagreements.length}/
                {cal.n}){cal.gatePass ? " ≥ " : " < "}
                {CALIBRATION_THRESHOLD}%
              </span>
            )}
            <InfoTip text="人工判 vs 自动判官的一致率。需要「同一份回答既有人工判、又有自动判」的题才能校准:先人工判一批,再对同一批跑自动评分。不足阈值时别盲信自动判官。" />
            {cal.disagreements.length > 0 && (
              <button
                type="button"
                onClick={() => setCalOpen((v) => !v)}
                className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {calOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                分歧 {cal.disagreements.length}
              </button>
            )}
          </div>
          {calOpen && cal.disagreements.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {cal.disagreements.map((d) => (
                <div
                  key={d.messageId}
                  className={cn("flex items-center gap-2 rounded px-1 text-[11.5px]", CLICKABLE_ROW)}
                  {...clickToPreview(d.questionId)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {titleOf(d.questionId)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    人工 {mark(d.human)} · 自动 {mark(d.auto)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GateRow>

        {/* ③ 抽审 */}
        <GateRow
          icon={
            audit.poolTotal === 0 ? (
              <Minus className="h-3.5 w-3.5 text-muted-foreground/60" />
            ) : audit.pendingCount === 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            )
          }
          label="抽审"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {audit.poolTotal === 0 ? (
              <span className="text-muted-foreground">暂无可抽审</span>
            ) : audit.pendingCount === 0 ? (
              <span className="text-muted-foreground">
                已清空({audit.reviewedCount}/{audit.sampledTotal})
              </span>
            ) : (
              <span className="font-medium text-warning">
                待复核 {audit.pendingCount}
                <span className="font-normal text-muted-foreground">
                  (P0/红线 {audit.pendingForcedCount} + 抽样{" "}
                  {audit.pendingCount - audit.pendingForcedCount})
                </span>
              </span>
            )}
            <InfoTip text="对自动判过的回答(通过 + 失败都抽)按比例人工复核;P0/红线题恒 100% 全抽。人工推翻自动判 = LLM 判通过被否掉(漏判)或 LLM 判失败被放行(错杀),都提示 judge 需要校准。" />
            <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              比例
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={rateDraft}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setRateDraft("");
                    return;
                  }
                  const v = Number(raw);
                  if (!Number.isFinite(v)) return;
                  // 显示值也夹到 [0,100]:输入 >100 立即变 100(否则已是 100% 时再输
                  // 150,clamp 后 rate 没变 → 重置 draft 的 effect 不触发,框里仍留 150)。
                  const clamped = Math.max(0, Math.min(100, v));
                  setRateDraft(String(clamped));
                  onRateChange(clamped / 100);
                }}
                onBlur={() => setRateDraft(String(Math.round(rate * 100)))}
                className="w-12 rounded border border-border bg-background px-1 py-0.5 text-[11px]"
              />
              %
            </span>
            {audit.pending.length > 0 && (
              <button
                type="button"
                onClick={() => setAuditOpen((v) => !v)}
                className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {auditOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                队列
              </button>
            )}
            {reviewItems.length > 0 && (
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-secondary"
                title="在弹窗里逐条人工复核(逐维度打分),无需去首页"
              >
                <ClipboardCheck className="h-3.5 w-3.5" /> 逐条复核
              </button>
            )}
          </div>
          {audit.overturnedCount > 0 && (
            <p className="mt-1 text-[11.5px] text-destructive/90">
              ⚠ 复核中 {audit.overturnedCount} 处人工推翻自动判(LLM 判通过被否=漏判 / LLM 判失败被放行=错杀)——建议调 judge prompt 或扩人工样本再放量。
            </p>
          )}
          {auditOpen && audit.pending.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {audit.pending.map((it) => (
                <div
                  key={it.messageId}
                  className={cn("flex items-center gap-2 rounded px-1 text-[11.5px]", CLICKABLE_ROW)}
                  {...clickToPreview(it.questionId)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {titleOf(it.questionId)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 text-[10px]",
                      it.autoVerdict === "passed"
                        ? "bg-success/15 text-success"
                        : "bg-destructive/15 text-destructive",
                    )}
                  >
                    LLM 判{it.autoVerdict === "passed" ? "通过" : "失败"}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{it.severity}</span>
                  {it.forced && (
                    <span className="shrink-0 rounded bg-destructive/15 px-1 text-[10px] text-destructive">
                      P0/红线
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </GateRow>
      </div>
      <AuditReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        items={reviewItems}
      />
      <QuestionPreviewSheet question={preview} onClose={() => setPreview(null)} />
    </section>
  );
}
