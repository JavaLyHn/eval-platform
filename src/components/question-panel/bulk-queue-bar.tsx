import { useState } from "react";
import { StartEvaluationRunDialog } from "./start-evaluation-run-dialog";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Play,
  Square,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { ALL_EMPLOYEES_ID } from "@/lib/standard-employees";
import { cn } from "@/lib/utils";
import { BulkJudgeBar } from "./bulk-judge-bar";
import { BulkJudgeDialog } from "./bulk-judge-dialog";

export function BulkQueueBar({
  embeddedWithComposer = false,
}: {
  /** 这个条是不是嵌在「作答区」里(下方已有「发送给 Agent」按钮)。
   *  是 → 选中 1 道时不再单独给「运行」,避免和底部「发送」重复成两个一样的功能。 */
  embeddedWithComposer?: boolean;
} = {}) {
  const {
    selection,
    clearSelection,
    toggleSelection,
    runQueue,
    sendQuestion,
    queue,
    stopQueue,
    resumeQueue,
    clearQueueResults,
    questions,
    profiles,
    isStreaming,
    testedInActiveConv,
    setSelectedQuestion,
    setRightTab,
    activeConversationId,
  } = useQAStore();
  // 这批答题是否属于当前会话 —— 运行进度 / 完成摘要只在它的 run 会话里展示,
  // 切到别的(新)会话不能看到别的会话的批量流程(会话间隔离)。
  const queueHere = queue.conversationId === activeConversationId;
  // 别的会话有批量在跑:本会话禁止再发起运行(派发管线全局只有一条)。
  const busyElsewhere = queue.running && !queueHere;
  // Pre-run: list expanded by default so users can pick a single question
  // to run instead of always firing the whole batch.
  const [expanded, setExpanded] = useState(true);
  const [judgeOpen, setJudgeOpen] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [multiTrial, setMultiTrial] = useState(false);
  const [trials, setTrials] = useState(3);
  // 批量运行时跳过已被目标 agent 答过的题(任意会话)。多 trial 不适用。
  const [skipAnswered, setSkipAnswered] = useState(false);
  if (queue.running && queueHere) {
    const done = queue.completed.length + queue.errored.length;
    const total = queue.total;
    const progress = total > 0 ? (done / total) * 100 : 0;
    const cur = queue.current;
    const currentQ = cur
      ? questions.find((q) => q.id === cur.questionId)
      : null;
    const currentProfile = cur
      ? profiles.find((p) => p.id === cur.profileId)
      : null;

    return (
      <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <Loader2
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-accent",
              isStreaming && "animate-spin",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="font-medium text-foreground">批量运行中</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {done} / {total}
              </span>
              {queue.errored.length > 0 && (
                <span className="font-mono text-[11px] tabular-nums text-destructive">
                  · {queue.errored.length} 失败
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {currentQ ? `当前：${currentQ.title}` : "等待中..."}
              {currentProfile && (
                <span className="ml-1 font-mono">→ {currentProfile.name}</span>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={stopQueue}
          >
            <Square className="h-3 w-3" /> 停止
          </Button>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  // 已暂停(停止后还有剩余队列):给「继续」从断点接着跑,或「放弃」清空。
  if (!queue.running && queueHere && queue.pending.length > 0) {
    const doneCount = queue.completed.length + queue.errored.length;
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <Square className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1 text-[12px]">
            <span className="font-medium text-foreground">已暂停</span>
            <span className="ml-2 font-mono tabular-nums text-muted-foreground">
              已完成 {doneCount} · 还剩 {queue.pending.length}
            </span>
            {queue.errored.length > 0 && (
              <span className="ml-1 font-mono text-[11px] tabular-nums text-destructive">
                · {queue.errored.length} 失败
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={clearQueueResults}
          >
            <X className="h-3 w-3" /> 放弃
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 px-2.5 text-[11px]"
            onClick={() => resumeQueue()}
          >
            <Play className="h-3 w-3" /> 继续(还剩 {queue.pending.length})
          </Button>
        </div>
      </div>
    );
  }

  // Post-run summary: queue finished, completed has entries — let user jump
  // back to each finished question to score it. Solves the "only the last
  // question is selected after batch run" bug.
  // De-dupe by questionId (a question with multiple agentIds expands into
  // several queue items — we still only want one summary row per question).
  const seen = new Set<string>();
  const rows = queue.completed.filter((it) => {
    if (seen.has(it.questionId)) return false;
    seen.add(it.questionId);
    return true;
  });
  // 只 1 道题不算「批量」:不显示完成摘要,直接在题目/打分里看这道题即可。
  if (!queue.running && rows.length > 1 && queueHere) {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-success/30 bg-success/5 p-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
          <span className="text-[12px] font-medium text-foreground">
            批量答题完成
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {rows.length} 道
          </span>
          {queue.errored.length > 0 && (
            <span className="font-mono text-[11px] text-destructive">
              · {queue.errored.length} 失败
            </span>
          )}
          {/* 批量 LLM 评分入口:就放在「关闭」左边;只有 ≥2 道题才显示,1 道直接逐题打分 */}
          {rows.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-6 gap-1 px-2 text-[10.5px]"
              onClick={() => setJudgeOpen(true)}
            >
              <Bot className="h-3 w-3" /> 批量 LLM 评分
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 gap-1 px-1.5 text-[10.5px]",
              rows.length <= 1 && "ml-auto",
            )}
            onClick={clearQueueResults}
          >
            <X className="h-3 w-3" /> 关闭
          </Button>
        </div>
        <ul className="mt-1.5 space-y-0.5">
          {rows.map((it) => {
            const q = questions.find((qq) => qq.id === it.questionId);
            const errored = queue.errored.some(
              (e) =>
                e.questionId === it.questionId &&
                e.profileId === it.profileId,
            );
            if (!q) return null;
            return (
              <li
                key={`${it.questionId}-${it.profileId}`}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-[11.5px] hover:bg-success/10"
              >
                {errored ? (
                  <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                )}
                <span className="truncate flex-1">{q.title}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 gap-1 px-1.5 text-[10.5px]"
                  onClick={() => {
                    setSelectedQuestion(q.id);
                    setRightTab("evaluation");
                  }}
                  title="切到这道题，打开打分 tab"
                >
                  <ClipboardCheck className="h-3 w-3" /> 评分
                </Button>
              </li>
            );
          })}
        </ul>
        </div>
        <BulkJudgeDialog
          open={judgeOpen}
          onOpenChange={setJudgeOpen}
          questionIds={rows.map((r) => r.questionId)}
        />
      </div>
    );
  }

  if (selection.size === 0) {
    return <BulkJudgeBar />;
  }

  // Resolve selected ids → question objects in current display order.
  const selectedQuestions = questions.filter((q) => selection.has(q.id));
  // 只选 1 道时不显示「批量运行 / 多trial」——单题直接用行内「运行」。
  const singleSelected = selection.size === 1;

  // 嵌在「作答区」里且只选 1 道:下方「发送给 Agent」就是唯一运行入口,
  // 这里不再给一个一模一样的「运行」(否则就是用户说的「右上运行 = 右下发送」两个重复按钮)。
  // 只保留干净的「已选 1 道 + 题名 + 清除」,运行 / 多轮 / 变量都交给下方作答区统一处理。
  if (embeddedWithComposer && singleSelected) {
    const q = selectedQuestions[0];
    return (
      <div className="space-y-2">
        <BulkJudgeBar />
        <div className="flex items-center gap-2 rounded-lg border border-foreground/15 bg-secondary px-2.5 py-1.5 text-[12px]">
          <span className="shrink-0 font-medium">已选 1 道</span>
          {q ? (
            <button
              type="button"
              onClick={() => {
                setSelectedQuestion(q.id);
                setRightTab("current");
              }}
              className="min-w-0 flex-1 truncate text-left text-foreground/75 hover:text-foreground hover:underline"
              title="查看这道题(运行请用下方「发送给 Agent」)"
            >
              {q.title}
            </button>
          ) : (
            <span className="flex-1" />
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 text-[11px]"
            onClick={() => setRunDialogOpen(true)}
          >
            自动化评测
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={clearSelection}
          >
            <X className="h-3 w-3" /> 清除
          </Button>
        </div>
        <StartEvaluationRunDialog
          open={runDialogOpen}
          onOpenChange={setRunDialogOpen}
          questionIds={Array.from(selection)}
        />
      </div>
    );
  }
  // 批量评分入口只在「选中题里有 ≥2 道本会话已答过的」时出现 —— 没答过显示也是空;
  // 只 1 道没必要「批量」,逐题打分即可。答完题也可用上面「批量答题完成」面板的入口。
  const answeredInSelection = selectedQuestions.filter((q) =>
    testedInActiveConv.has(q.id),
  ).length;
  const hasAnsweredInSelection = answeredInSelection > 1;

  // Preview of how many runs the bulk will expand to:
  //   - 全体员工 题目 = once per agent-kind profile
  //   - 其它       = once
  const allAgentCount = profiles.filter(
    (p) => getProfileKind(p.providerId) === "agent",
  ).length;
  let expandedCount = 0;
  for (const q of selectedQuestions) {
    expandedCount +=
      q.targetEmployeeId === ALL_EMPLOYEES_ID && allAgentCount > 0
        ? allAgentCount
        : 1;
  }

  return (
    <div className="space-y-2">
      <BulkJudgeBar />
      <div className="rounded-lg border border-foreground/15 bg-secondary text-[12px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-foreground hover:text-foreground/80"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span className="font-medium">
            已选 <span className="font-mono tabular-nums">{selection.size}</span> 道
          </span>
          {expandedCount !== selection.size && (
            <span className="font-mono text-muted-foreground">
              (= {expandedCount} 次运行)
            </span>
          )}
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-[11px]"
          onClick={clearSelection}
        >
          <X className="h-3 w-3" /> 清除
        </Button>
        {hasAnsweredInSelection && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2.5 text-[11px]"
            onClick={() => setJudgeOpen(true)}
          >
            <Bot className="h-3 w-3" /> 批量 LLM 评分
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2.5 text-[11px]"
          onClick={() => setRunDialogOpen(true)}
        >
          自动化评测
        </Button>
        {!singleSelected && (
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={multiTrial}
              onChange={(e) => setMultiTrial(e.target.checked)}
              className="h-3 w-3 accent-accent"
            />
            多trial
          </label>
        )}
        {!singleSelected && !multiTrial && (
          <label
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
            title="跳过已被目标 agent 答过的题(任意会话里已有完成回答);适合重跑时不重做已完成的"
          >
            <input
              type="checkbox"
              checked={skipAnswered}
              onChange={(e) => setSkipAnswered(e.target.checked)}
              className="h-3 w-3 accent-accent"
            />
            跳过已答
          </label>
        )}
        {!singleSelected && multiTrial && (
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-muted-foreground">K=</span>
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-card px-0.5 py-0.5">
              <button
                type="button"
                onClick={() => setTrials((k) => Math.max(2, k - 1))}
                disabled={trials <= 2}
                aria-label="K 减一"
                className="flex h-5 w-5 items-center justify-center rounded border border-border text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                −
              </button>
              <span className="min-w-[1.5ch] text-center font-mono text-[12px] tabular-nums text-foreground">
                {trials}
              </span>
              <button
                type="button"
                onClick={() => setTrials((k) => Math.min(5, k + 1))}
                disabled={trials >= 5}
                aria-label="K 加一"
                className="flex h-5 w-5 items-center justify-center rounded border border-border text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
        )}
        {!singleSelected && (
          <Button
            variant="default"
            size="sm"
            className="h-7 gap-1 px-2.5 text-[11px]"
            disabled={busyElsewhere}
            title={busyElsewhere ? "另一个会话的批量运行还在进行中" : undefined}
            onClick={() =>
              runQueue(
                Array.from(selection),
                multiTrial
                  ? { trials }
                  : skipAnswered
                    ? { skipAnswered: true }
                    : undefined,
              )
            }
          >
            <Play className="h-3 w-3" /> 批量运行
          </Button>
        )}
      </div>
      {/* Per-item list — click row to set as active question (so you can
       *  send it manually via 当前任务), or click ▶ to run only this one. */}
      {expanded && selectedQuestions.length > 0 && (
        <ul className="max-h-64 overflow-y-auto border-t border-foreground/10">
          {selectedQuestions.map((q) => (
            <li
              key={q.id}
              className="group flex items-center gap-2 border-b border-foreground/5 px-2.5 py-1 last:border-b-0 hover:bg-foreground/5"
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedQuestion(q.id);
                  setRightTab("current");
                }}
                className="min-w-0 flex-1 truncate text-left text-[12px] text-foreground hover:underline"
                title="切到这道题（不自动运行）"
              >
                {q.title}
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10.5px] opacity-70 group-hover:opacity-100"
                disabled={busyElsewhere}
                onClick={() => {
                  setSelectedQuestion(q.id);
                  setRightTab("current");
                  // 「只运行这一道」= 就在**当前会话**里答(和底部「发送」一样),不另起新会话。
                  // 例外:全体员工题要对每个 agent 各跑一次,无法塞进一条线性会话 → 仍走批量队列(新建 run 会话)。
                  if (q.targetEmployeeId === ALL_EMPLOYEES_ID) {
                    runQueue([q.id]);
                  } else {
                    sendQuestion(q);
                  }
                }}
                title={
                  busyElsewhere
                    ? "另一个会话的批量运行还在进行中"
                    : "在当前会话里运行这一道"
                }
              >
                <Play className="h-3 w-3" /> 运行
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6 opacity-50 group-hover:opacity-100"
                onClick={() => toggleSelection(q.id)}
                title="从选择中移除"
                aria-label="从选择中移除"
              >
                <X className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      </div>
      <BulkJudgeDialog
        open={judgeOpen}
        onOpenChange={setJudgeOpen}
        questionIds={Array.from(selection)}
      />
      <StartEvaluationRunDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        questionIds={Array.from(selection)}
      />
    </div>
  );
}
