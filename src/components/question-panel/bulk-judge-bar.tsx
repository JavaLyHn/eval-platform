import { useMemo, useState, type ReactNode } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Loader2, Play, RotateCw, Square, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQAStore } from "@/hooks/use-qa-store";
import { BatchResultsDialog } from "@/components/question-panel/batch-results-dialog";
import { BulkJudgeDialog } from "@/components/question-panel/bulk-judge-dialog";
import { judgeQuestionProgress } from "@/lib/batch-judge-plan";

export function BulkJudgeBar() {
  const {
    judgeQueue,
    questions,
    activeConversationId,
    stopBatchJudge,
    clearBatchJudgeResults,
    runBatchJudge,
    setSelectedQuestion,
    setRightTab,
    lastBatchJudge,
    testedInActiveConv,
    queue,
  } = useQAStore();
  const [resultsOpen, setResultsOpen] = useState(false);
  const [judgeOpen, setJudgeOpen] = useState(false);
  // 「批量评分完成」逐题清单默认收起(题多时太长),点标题展开。
  const [listOpen, setListOpen] = useState(false);
  // 批量评分目标(跨会话):批量答题队列完成的题 ∪ 本会话已答完的题。
  // 队列完成项只在它所属的 run 会话计入 —— 别的会话不能把上一批的题混进来。
  const answeredIds = useMemo(() => {
    const ids = new Set<string>(testedInActiveConv);
    if (queue.conversationId === activeConversationId) {
      for (const item of queue.completed) ids.add(item.questionId);
    }
    return [...ids];
  }, [testedInActiveConv, queue.completed, queue.conversationId, activeConversationId]);

  const wrongConv =
    judgeQueue.conversationId && judgeQueue.conversationId !== activeConversationId;

  // 本批结果只在它所属会话里展示;切到别的 / 新建会话(含历史无 conversationId 的旧指针)不显示。
  const hasResults =
    !!lastBatchJudge && lastBatchJudge.conversationId === activeConversationId;
  // 常驻批量评分入口:有 ≥2 道已答完的题、且当前没有评分在跑 → 随时可(重新)批量判分。
  // 只有 1 道题没必要「批量」,直接在打分页给这一道打分即可。
  const canJudge = answeredIds.length > 1 && !judgeQueue.running;

  // 断点续跑 / 重试失败:都用 skip 模式跑子集(已落库 eval 的自动跳过,失败/没判的补上)。
  // 都需要上一批用过的裁判(lastBatchJudge.judgeProfileIds)。
  const planQuestionIds = useMemo(
    () => [...new Set((judgeQueue.plan ?? []).map((u) => u.questionId))],
    [judgeQueue.plan],
  );
  const remainingCount = judgeQueue.running
    ? 0
    : Math.max(0, (judgeQueue.plan?.length ?? 0) - (judgeQueue.doneKeys?.length ?? 0));
  const erroredQ = useMemo(
    () => [...new Set(judgeQueue.errored.map((e) => e.questionId))],
    [judgeQueue.errored],
  );
  const lastJudges = lastBatchJudge?.judgeProfileIds ?? [];
  const canResume = !judgeQueue.running && remainingCount > 0 && lastJudges.length > 0;
  const canRetryFailed =
    !judgeQueue.running && erroredQ.length > 0 && lastJudges.length > 0;
  const resumeJudge = () => {
    if (!canResume) return;
    void runBatchJudge({
      questionIds: planQuestionIds,
      judgeProfileIds: lastJudges,
      mode: "skip",
      overrideConvId: judgeQueue.conversationId ?? undefined,
    });
  };
  const retryFailedJudge = () => {
    if (!canRetryFailed) return;
    void runBatchJudge({
      questionIds: erroredQ,
      judgeProfileIds: lastJudges,
      mode: "skip",
      overrideConvId: judgeQueue.conversationId ?? undefined,
    });
  };

  // 「批量评分完成」面板已把两个入口收进标题行 → 面板出现时不再渲染下方独立按钮行。
  let completedPanel = false;
  let queueNode: ReactNode = null;
  if (!wrongConv && judgeQueue.running) {
    const { done, total, activeKeys } = judgeQueue;
    const progress = total > 0 ? (done / total) * 100 : 0;
    // 进度按「题」折算(困难题多轮=1);单元数作次要展示。
    const qp = judgeQuestionProgress(judgeQueue.plan, judgeQueue.doneKeys);
    // 并发:当前在评的各线程对应的题(去重),compact 条里一行列出。
    const activeTitles = [
      ...new Set(
        activeKeys
          .map((k) => (judgeQueue.plan ?? []).find((u) => u.key === k)?.questionId)
          .filter((x): x is string => !!x),
      ),
    ].map((qid) => questions.find((q) => q.id === qid)?.title ?? qid);
    queueNode = (
      <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="font-medium text-foreground">批量评分中</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {qp.doneQ} / {qp.totalQ} 题
                {qp.totalUnits !== qp.totalQ && (
                  <span className="ml-1 text-[10px] text-muted-foreground/70">(共 {qp.totalUnits} 轮)</span>
                )}
              </span>
              {judgeQueue.errored.length > 0 && (
                <span className="font-mono text-[11px] tabular-nums text-destructive">· {judgeQueue.errored.length} 失败</span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {activeTitles.length > 0
                ? `${activeTitles.length} 条并行:${activeTitles.join("、")}`
                : "准备中…"}
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={stopBatchJudge}>
            <Square className="h-3 w-3" /> 停止
          </Button>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
        {/* 失败项即时列出(含原因),不必等全部评完 */}
        {judgeQueue.errored.length > 0 && (
          <ul className="mt-2 max-h-24 space-y-0.5 overflow-y-auto border-t border-accent/20 pt-1.5">
            {judgeQueue.errored.map(({ questionId, reason }) => {
              const q = questions.find((qq) => qq.id === questionId);
              return (
                <li key={questionId} className="flex items-center gap-2 text-[11px]">
                  <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {q?.title ?? questionId}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-destructive">
                    {reason || "(无错误详情)"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  } else if (!wrongConv && (judgeQueue.completed.length > 0 || judgeQueue.errored.length > 0)) {
    completedPanel = true;
    queueNode = (
      <div className="rounded-lg border border-success/30 bg-success/5 p-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* 标题区:点它收起/展开下方逐题清单。
              把右侧按钮推到行尾用 grow(flex-grow: 1)—— 别改回给按钮组挂 ml-auto:
              这行会 flex-wrap,ml-auto 在换行后仍把按钮组顶到第二行右端,标题右边留一大片空白
              (窄面板/手机上很像坏掉)。让标题吃掉剩余空间:同行时按钮照样贴右,
              换行后按钮组自然左对齐落在标题下方。
              m-4:也别改回 flex-1(= flex: 1 1 0%,basis 0%)—— basis 0 会把这个元素的
              假想主轴尺寸从 max-content 拉到 min-content,标题里的中文在容器变窄、
              需要换行的中间宽度区间会失去"整词/整句换行"的阈值,逐字断行、被压成
              几十像素宽的竖条。grow 保留 basis auto,只多"抢占剩余空间"这一个效果,
              换行阈值不受影响 —— 两者视觉上只在"需要收缩"这个方向才有差异,这里
              从不发生收缩,所以效果等价,但 grow 不会破坏换行。 */}
          <button
            type="button"
            onClick={() => setListOpen((v) => !v)}
            className="flex grow items-center gap-1.5 text-left"
            aria-expanded={listOpen}
          >
            {listOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-success" />
            )}
            <Bot className="h-3.5 w-3.5 shrink-0 text-success" />
            <span className="text-[12px] font-medium text-foreground">批量评分完成</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {new Set(judgeQueue.completed).size} 道
            </span>
            {judgeQueue.errored.length > 0 && (
              <span className="font-mono text-[11px] text-destructive">· {judgeQueue.errored.length} 失败</span>
            )}
          </button>
          {/* 重新批量评分 / 查看本批结果:直接放在标题后面,不再独立悬在面板下方 */}
          <div className="flex flex-wrap items-center gap-1.5">
            {canResume && (
              <Button
                size="sm"
                className="h-6 gap-1 px-2 text-[10.5px]"
                onClick={resumeJudge}
                title="从中断点继续:用跳过已评模式把没判完的补齐(同一批裁判)"
              >
                <Play className="h-3 w-3" /> 继续(还剩 {remainingCount})
              </Button>
            )}
            {canRetryFailed && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 border-destructive/40 px-2 text-[10.5px] text-destructive hover:bg-destructive/10"
                onClick={retryFailedJudge}
                title="只重跑判分失败的题(同一批裁判)"
              >
                <RotateCw className="h-3 w-3" /> 重试失败 {erroredQ.length}
              </Button>
            )}
            {canJudge && (
              <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[10.5px]" onClick={() => setJudgeOpen(true)}>
                <RotateCw className="h-3 w-3" /> 重新批量评分 · {answeredIds.length} 题
              </Button>
            )}
            {hasResults && (
              <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[10.5px]" onClick={() => setResultsOpen(true)}>
                <ClipboardList className="h-3 w-3" /> 查看本批结果 · {lastBatchJudge!.entries.length} 条
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10.5px]" onClick={clearBatchJudgeResults}>
              <X className="h-3 w-3" /> 关闭
            </Button>
          </div>
        </div>
        {listOpen && (
        <ul className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto">
          {[...new Set(judgeQueue.completed)].map((qid) => {
            const q = questions.find((qq) => qq.id === qid);
            if (!q) return null;
            return (
              <li key={qid} className="flex items-center gap-2 rounded px-1.5 py-1 text-[11.5px] hover:bg-success/10">
                <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                <span className="flex-1 truncate">{q.title}</span>
                <Button variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-[10.5px]"
                  onClick={() => { setSelectedQuestion(qid); setRightTab("evaluation"); }}>
                  查看
                </Button>
              </li>
            );
          })}
          {judgeQueue.errored.map(({ questionId, reason }) => {
            const q = questions.find((qq) => qq.id === questionId);
            return (
              <li key={questionId} className="flex items-center gap-2 rounded px-1.5 py-1 text-[11.5px] text-muted-foreground">
                <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                <span className="flex-1 truncate">{q?.title ?? questionId}</span>
                <span className="shrink-0 text-[10.5px] text-destructive">{reason || "(无错误详情)"}</span>
              </li>
            );
          })}
        </ul>
        )}
      </div>
    );
  }

  const resultsNode = hasResults ? (
    <button
      type="button"
      onClick={() => setResultsOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground hover:border-accent/60"
    >
      <ClipboardList className="h-3.5 w-3.5" />
      查看本批结果 · {lastBatchJudge!.entries.length} 条
    </button>
  ) : null;

  const judgeNode = canJudge ? (
    <button
      type="button"
      onClick={() => setJudgeOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground hover:border-accent/60"
      title="对已答完的题批量 LLM 评分(跨会话:每题回它作答的会话取回答;可重复运行,支持跳过已评 / 全部重评)"
    >
      {hasResults ? <RotateCw className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      {hasResults ? "重新批量评分" : "批量 LLM 评分"} · {answeredIds.length} 题
    </button>
  ) : null;

  if (!queueNode && !resultsNode && !judgeNode) return null;
  return (
    <div className="space-y-2">
      {queueNode}
      {!completedPanel && (judgeNode || resultsNode) && (
        <div className="flex flex-wrap items-center gap-2">
          {judgeNode}
          {resultsNode}
        </div>
      )}
      <BatchResultsDialog open={resultsOpen} onOpenChange={setResultsOpen} />
      <BulkJudgeDialog open={judgeOpen} onOpenChange={setJudgeOpen} questionIds={answeredIds} />
    </div>
  );
}
