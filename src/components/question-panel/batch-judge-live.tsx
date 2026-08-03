import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { Bot, CheckCircle2, ClipboardList, Loader2, Square, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";
import { BatchResultsDialog } from "@/components/question-panel/batch-results-dialog";
import { PassKBadge } from "@/components/question-panel/pass-k-badge";
import {
  CLICKABLE_ROW,
  QuestionPreviewSheet,
} from "@/components/question-panel/question-preview-sheet";
import { buildBatchResultRows } from "@/lib/batch-results";
import { judgeQuestionProgress } from "@/lib/batch-judge-plan";
import type { Evaluation, Question } from "@/types";

/** 取某题最近一条「LLM 裁判」评测(批量评分刚产出的那条),无则 null。 */
function latestJudgeEval(evals: Evaluation[], questionId: string): Evaluation | null {
  let best: Evaluation | null = null;
  for (const e of evals) {
    if (e.questionId !== questionId) continue;
    const isJudge = !!e.judgeProfileId || (e.calibrationSnapshots?.length ?? 0) > 0;
    if (!isJudge) continue;
    if (!best || new Date(e.submittedAt) > new Date(best.submittedAt)) best = e;
  }
  return best;
}

/**
 * 「打分」tab 在批量 LLM 评分进行 / 刚结束时的实时过程视图。
 * 取代单题人工/LLM 选择界面,展示:总进度 + 当前正在评判的题 + 已评(带判定/分)+ 失败。
 */
export function BatchJudgeLiveView() {
  const {
    judgeQueue,
    questions,
    evaluations,
    stopBatchJudge,
    clearBatchJudgeResults,
    lastBatchJudge,
    activeConversationId,
    standardEmployees,
    profiles,
    passKByQInActiveConv,
  } = useQAStore();
  const { running, done, total, activeKeys, completed, errored } = judgeQueue;
  const [resultsOpen, setResultsOpen] = useState(false);
  const [preview, setPreview] = useState<Question | null>(null);
  const openPreview = (qid: string | undefined) => {
    if (!qid) return;
    const q = questions.find((x) => x.id === qid);
    if (q) setPreview(q);
  };
  /** 把一行变成「可点预览」:点击 / Enter / 空格都能打开该题预览。 */
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

  // judgeQueue 是否还承载本会话的这批进度;否则进入「持久结果」模式(从 lastBatchJudge 重建)。
  const liveActive =
    judgeQueue.conversationId === activeConversationId &&
    (running || completed.length > 0 || errored.length > 0);

  // 持久结果模式:judgeQueue 已被「关闭」清空,但本会话仍有 lastBatchJudge → 反复可看。
  if (!liveActive && lastBatchJudge && lastBatchJudge.conversationId === activeConversationId) {
    return (
      <PersistedResultView
        rows={buildBatchResultRows(lastBatchJudge, evaluations, questions, standardEmployees, profiles)}
        onOpenFull={() => setResultsOpen(true)}
        resultsOpen={resultsOpen}
        setResultsOpen={setResultsOpen}
      />
    );
  }

  const progress = total > 0 ? (done / total) * 100 : 0;
  // 进度按「题」折算(困难题多轮=1);单元数作次要展示。
  const qProgress = useMemo(
    () => judgeQuestionProgress(judgeQueue.plan, judgeQueue.doneKeys),
    [judgeQueue.plan, judgeQueue.doneKeys],
  );
  const titleOf = (qid: string) => questions.find((q) => q.id === qid)?.title ?? qid;
  const erroredIds = useMemo(() => new Set(errored.map((e) => e.questionId)), [errored]);
  // 待评 = 总单元 − 已完成 − 正在评的(并发线程数)。
  const pending = Math.max(0, total - done - activeKeys.length);

  // 逐轮题:按「评分计划」逐单元显示(每轮带轮次+子问题),否则按 questionId 显示。
  const plan = judgeQueue.plan ?? [];
  const doneKeys = useMemo(
    () => new Set(judgeQueue.doneKeys ?? []),
    [judgeQueue.doneKeys],
  );
  const hasSubUnits = plan.some((u) => u.subIndex != null);
  const evalByMessage = (messageId: string): Evaluation | null => {
    let best: Evaluation | null = null;
    for (const e of evaluations) {
      if (e.messageId !== messageId) continue;
      if (!best || new Date(e.submittedAt) > new Date(best.submittedAt)) best = e;
    }
    return best;
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 头部:状态 + 进度 */}
      <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 shadow-sm">
        <div className="flex items-center gap-2">
          {running ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
          ) : (
            <Bot className="h-4 w-4 shrink-0 text-success" />
          )}
          <span className="text-[13px] font-semibold text-foreground">
            {running ? "LLM 批量评分进行中" : "LLM 批量评分完成"}
          </span>
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
            {qProgress.doneQ} / {qProgress.totalQ} 题
            {qProgress.totalUnits !== qProgress.totalQ && (
              <span className="ml-1 text-[10.5px] text-muted-foreground/70">
                (共 {qProgress.totalUnits} 轮)
              </span>
            )}
          </span>
          {errored.length > 0 && (
            <span className="font-mono text-[11px] tabular-nums text-destructive">
              · {errored.length} 失败
            </span>
          )}
          {running ? (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 gap-1 px-2 text-[11px]"
              onClick={stopBatchJudge}
            >
              <Square className="h-3 w-3" /> 停止
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 gap-1 px-2 text-[11px]"
              onClick={clearBatchJudgeResults}
            >
              关闭
            </Button>
          )}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        {running && (
          <div className="mt-2 space-y-1">
            {/* 每条线程一行:并发时 4 条线程 → 4 行,各自显示当前在评的题/轮。 */}
            {activeKeys.length === 0 ? (
              <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
                <span>准备中…</span>
              </div>
            ) : (
              activeKeys.map((k) => {
                const u = plan.find((x) => x.key === k);
                const label = u
                  ? u.subIndex != null
                    ? `${titleOf(u.questionId)} · 第 ${u.subIndex + 1} 轮`
                    : titleOf(u.questionId)
                  : "评判中…";
                return (
                  <div
                    key={k}
                    className={cn(
                      "flex items-center gap-2 rounded text-[11.5px] text-muted-foreground",
                      u && CLICKABLE_ROW,
                    )}
                    {...clickToPreview(u?.questionId)}
                  >
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
                    <span className="min-w-0 flex-1 truncate">
                      正在评判:<span className="font-medium text-foreground">{label}</span>
                    </span>
                  </div>
                );
              })
            )}
            <div className="flex items-center gap-2 pt-0.5 text-[10.5px] text-muted-foreground/80">
              <span>{activeKeys.length} 条线程并行</span>
              {pending > 0 && <span className="ml-auto font-mono">待评 {pending}</span>}
            </div>
          </div>
        )}
      </div>

      {/* 逐轮题:逐单元实时列表(每轮带轮次 + 子问题,区分各轮) */}
      {hasSubUnits ? (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          <ul className="divide-y divide-border/60">
            {plan.map((u) => {
              const isDone = doneKeys.has(u.key);
              const isCurrent = !isDone && activeKeys.includes(u.key);
              const ev = isDone ? evalByMessage(u.key) : null;
              const passed = ev?.verdict === "passed";
              const label =
                u.subIndex != null ? `第 ${u.subIndex + 1} 轮` : titleOf(u.questionId);
              return (
                <li
                  key={u.key}
                  className={cn("flex items-center gap-2 px-3 py-2 text-[12px]", CLICKABLE_ROW, isCurrent && "bg-accent/5")}
                  {...clickToPreview(u.questionId)}
                >
                  {isCurrent ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                  ) : isDone ? (
                    ev ? (
                      passed ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                      )
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
                  )}
                  <span className="shrink-0 rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
                    {label}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", !isDone && !isCurrent && "text-muted-foreground/50")}>
                    {u.subPrompt || titleOf(u.questionId)}
                  </span>
                  {isCurrent && <span className="shrink-0 text-[10.5px] text-accent">评判中</span>}
                  {isDone && ev?.verdict && (
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                        passed ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                      )}
                    >
                      {passed ? "通过" : "失败"}
                    </span>
                  )}
                  {isDone && ev?.autoScore != null && (
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {ev.autoScore.toFixed(1)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        <ul className="divide-y divide-border/60">
          {[...new Set(completed)].map((qid) => {
            const passK = passKByQInActiveConv.get(qid);
            if (passK) {
              // 多 trial 题:只计通过率,不显示分数。
              const allFail = passK.passed === 0 && passK.trials > 0;
              return (
                <li
                  key={qid}
                  className={cn("flex items-center gap-2 px-3 py-2 text-[12px]", CLICKABLE_ROW)}
                  {...clickToPreview(qid)}
                >
                  {allFail ? (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  ) : (
                    <CheckCircle2
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        passK.status === "green" ? "text-success" : "text-warning",
                      )}
                    />
                  )}
                  <span className="flex-1 truncate">{titleOf(qid)}</span>
                  <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    通过 {passK.passed}/{passK.trials}
                  </span>
                  <PassKBadge summary={passK} />
                </li>
              );
            }
            const ev = latestJudgeEval(evaluations, qid);
            const passed = ev?.verdict === "passed";
            return (
              <li
                key={qid}
                className={cn("flex items-center gap-2 px-3 py-2 text-[12px]", CLICKABLE_ROW)}
                {...clickToPreview(qid)}
              >
                {ev ? (
                  passed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  )
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                )}
                <span className="flex-1 truncate">{titleOf(qid)}</span>
                {ev?.verdict && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                      passed
                        ? "bg-success/15 text-success"
                        : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {passed ? "通过" : "失败"}
                  </span>
                )}
                {ev?.autoScore != null && (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {ev.autoScore.toFixed(1)}
                  </span>
                )}
              </li>
            );
          })}

          {errored.map(({ questionId, reason }) => (
            <li
              key={`err-${questionId}`}
              className={cn("flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground", CLICKABLE_ROW)}
              {...clickToPreview(questionId)}
            >
              <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              <span className="flex-1 truncate">{titleOf(questionId)}</span>
              <span className="shrink-0 text-[10.5px] text-destructive">{reason}</span>
            </li>
          ))}

          {running &&
            activeKeys.map((k) => {
              const u = plan.find((x) => x.key === k);
              const qid = u?.questionId;
              if (!qid || erroredIds.has(qid)) return null;
              return (
                <li
                  key={`active-${k}`}
                  className={cn("flex items-center gap-2 bg-accent/5 px-3 py-2 text-[12px]", CLICKABLE_ROW)}
                  {...clickToPreview(qid)}
                >
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                  <span className="flex-1 truncate font-medium">{titleOf(qid)}</span>
                  <span className="shrink-0 text-[10.5px] text-accent">评判中</span>
                </li>
              );
            })}

          {running &&
            Array.from({ length: pending }).map((_, i) => (
              <li
                key={`pending-${i}`}
                className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground/50"
              >
                <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
                <span className="flex-1 truncate">待评判…</span>
              </li>
            ))}
        </ul>
      </div>
      )}

      {/* 完成后:看本批完整结果 */}
      {!running && (completed.length > 0 || errored.length > 0) && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => setResultsOpen(true)}
        >
          <ClipboardList className="h-3.5 w-3.5" /> 查看本批完整结果
        </Button>
      )}
      <BatchResultsDialog open={resultsOpen} onOpenChange={setResultsOpen} />
      <QuestionPreviewSheet question={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/**
 * 持久结果视图:批量评分跑完并「关闭」实时进度后,打分 tab 仍可反复查看本批结果
 * (从 lastBatchJudge 重建,不依赖瞬态 judgeQueue),修「结果只显示一次」。
 */
function PersistedResultView({
  rows,
  onOpenFull,
  resultsOpen,
  setResultsOpen,
}: {
  rows: ReturnType<typeof buildBatchResultRows>;
  onOpenFull: () => void;
  resultsOpen: boolean;
  setResultsOpen: (v: boolean) => void;
}) {
  const { questions } = useQAStore();
  const [preview, setPreview] = useState<Question | null>(null);
  const openPreview = (qid: string) => {
    const q = questions.find((x) => x.id === qid);
    if (q) setPreview(q);
  };
  const passed = rows.filter((r) => r.verdict === "passed").length;
  const failed = rows.filter((r) => r.verdict === "failed").length;
  const missing = rows.filter((r) => r.missing).length;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-success" />
          <span className="text-[13px] font-semibold text-foreground">本批评测结果</span>
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{rows.length} 条</span>
          <span className="ml-auto flex items-center gap-2 text-[11.5px]">
            <span className="text-success">通过 {passed}</span>
            <span className="text-destructive">失败 {failed}</span>
            {missing > 0 && <span className="text-muted-foreground">无结果 {missing}</span>}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        <ul className="divide-y divide-border/60">
          {rows.map((r) => (
            <li
              key={r.rowKey}
              className={cn("flex items-center gap-2 px-3 py-2 text-[12px]", CLICKABLE_ROW)}
              role="button"
              tabIndex={0}
              title="点击预览题目"
              onClick={() => openPreview(r.questionId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openPreview(r.questionId);
                }
              }}
            >
              {r.missing ? (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : r.verdict === "passed" ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              {(r.trialIndex ?? r.subIndex) != null && (
                <span className="shrink-0 rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
                  第 {((r.trialIndex ?? r.subIndex) as number) + 1} 轮
                </span>
              )}
              <span className="flex-1 truncate">
                {r.questionTitle}
                {r.subPrompt && (
                  <span className="ml-1 text-muted-foreground/80">
                    · {r.subPrompt}
                  </span>
                )}
              </span>
              {!r.missing && r.verdict && (
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                    r.verdict === "passed" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                  )}
                >
                  {r.verdict === "passed" ? "通过" : "失败"}
                </span>
              )}
              {r.autoScore != null && (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {r.autoScore.toFixed(1)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={onOpenFull}>
        <ClipboardList className="h-3.5 w-3.5" /> 查看本批完整结果(逐题详情)
      </Button>
      <BatchResultsDialog open={resultsOpen} onOpenChange={setResultsOpen} />
      <QuestionPreviewSheet question={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
