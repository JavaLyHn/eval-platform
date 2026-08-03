import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, Check, ChevronDown, ChevronRight, Circle, Columns2, FlaskConical, Loader2, Trash2, X } from "lucide-react";
import { useQAStore } from "@/hooks/use-qa-store";
import { Button } from "@/components/ui/button";
import { HomeButton } from "@/components/home-button";
import { HeaderIconBadge } from "@/components/header-icon-badge";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { EvaluationRun, EvaluationRunStatus } from "@/types";
import { cloneRunConfig, failedQuestionIdsFromReport, canCompare } from "@/lib/evaluation-run";

const STATUS_LABEL: Record<EvaluationRunStatus, string> = {
  queued: "排队", answering: "答题中", judging: "评分中", reporting: "出报告",
  done: "完成", partial: "部分完成", failed: "失败", canceled: "已取消", interrupted: "已中断",
};

const IN_FLIGHT: EvaluationRunStatus[] = ["queued", "answering", "judging", "reporting"];

/** 历史 run 状态徽章配色。 */
function statusPillClass(status: EvaluationRunStatus): string {
  switch (status) {
    case "done":
      return "bg-success/15 text-success";
    case "partial":
      return "bg-warning/15 text-warning";
    case "failed":
    case "canceled":
      return "bg-destructive/15 text-destructive";
    case "interrupted":
      return "bg-warning/15 text-warning";
    default:
      return "bg-accent/15 text-accent";
  }
}

const CONCLUSION_LABEL: Record<string, string> = {
  pass: "通过", limited: "有限通过", blocked: "阻断发布",
};

type StepState = "done" | "active" | "pending";
function stepStateOf(status: EvaluationRunStatus, step: 0 | 1 | 2): StepState {
  const order: EvaluationRunStatus[] = ["answering", "judging", "reporting"];
  if (status === "queued") return step === 0 ? "active" : "pending";
  if (status === "done" || status === "partial") return "done";
  const cur = order.indexOf(status);
  if (cur === -1) return "pending";
  if (step < cur) return "done";
  if (step === cur) return "active";
  return "pending";
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** 进行中的评测运行 —— 置顶活动卡:三段 stepper + 活动阶段进度条 + 当前题 + 终止。 */
function RunLiveCard({ run, subjectName }: { run: EvaluationRun; subjectName: string }) {
  const { queue, judgeQueue, questions, profiles, cancelEvaluationRun } = useQAStore();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = fmtClock(now - new Date(run.createdAt).getTime());

  const titleOf = (qid: string | null | undefined) =>
    qid ? (questions.find((q) => q.id === qid)?.title ?? qid) : null;
  const judgeNames = run.config.judgeProfileIds
    .map((id) => profiles.find((p) => p.id === id)?.name ?? id)
    .join("、");

  let pct = 0;
  let barLabel = "";
  let currentLine: string | null = null;
  let indeterminate = false;
  if (run.status === "answering") {
    pct = queue.total ? Math.round((queue.completed.length / queue.total) * 100) : 0;
    barLabel = `答题 ${queue.completed.length}/${queue.total || run.progress.total}`;
    const t = titleOf(queue.current?.questionId);
    currentLine = t ? `正在答:${t}` : "排队派发中…";
  } else if (run.status === "judging") {
    pct = judgeQueue.total ? Math.round((judgeQueue.done / judgeQueue.total) * 100) : 0;
    barLabel = `评分 ${judgeQueue.done}/${judgeQueue.total || run.progress.total}`;
    // 并发:取第一个在评线程对应的题作代表(activeKeys 是单元 key,回 plan 找 questionId)。
    const firstActiveQid = judgeQueue.activeKeys[0]
      ? (judgeQueue.plan ?? []).find((u) => u.key === judgeQueue.activeKeys[0])?.questionId
      : undefined;
    const t = titleOf(firstActiveQid);
    const n = judgeQueue.activeKeys.length;
    currentLine = t
      ? `正在评${n > 1 ? `(${n} 条并行)` : ""}:${t}${judgeNames ? ` · 裁判 ${judgeNames}` : ""}`
      : "准备评分…";
  } else if (run.status === "reporting") {
    pct = 100;
    indeterminate = true;
    barLabel = "出报告";
    currentLine = "正在汇总评分、生成报告…";
  } else {
    indeterminate = true;
    barLabel = "准备中";
    currentLine = "排队准备中…";
  }

  const STEPS: { label: string; count: string }[] = [
    { label: "答题", count: `${run.progress.answered}/${run.progress.total}` },
    { label: "评分", count: `${run.progress.judged}/${run.progress.total}` },
    { label: "报告", count: run.reportId ? "✓" : "—" },
  ];

  return (
    <div className="mb-4 rounded-lg border border-accent/40 bg-accent/5 p-3.5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 gap-y-1">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{subjectName} · {run.versionLabel}</span>
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10.5px] text-accent">
            {STATUS_LABEL[run.status]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{elapsed} 已用</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[10.5px] text-destructive hover:text-destructive"
            onClick={() => cancelEvaluationRun(run.id)}
            title="真正停止已派发的答题 / 评分任务"
          >
            <Ban className="h-3 w-3" /> 终止
          </Button>
        </div>
      </div>

      <div className="mb-3 flex items-center">
        {STEPS.map((s, i) => {
          const st = stepStateOf(run.status, i as 0 | 1 | 2);
          return (
            <div key={s.label} className={cn("flex items-center", i < 2 && "flex-1")}>
              <div className="flex flex-col items-center gap-0.5">
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border",
                    st === "done" && "border-success bg-success text-background",
                    st === "active" && "border-accent bg-accent/10 text-accent",
                    st === "pending" && "border-border bg-card text-muted-foreground",
                  )}
                >
                  {st === "done" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : st === "active" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Circle className="h-2.5 w-2.5" />
                  )}
                </div>
                <span className={cn("text-[11px]", st === "pending" ? "text-muted-foreground" : "font-medium")}>
                  {s.label}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{s.count}</span>
              </div>
              {i < 2 && (
                <div className={cn("mx-1 mb-4 h-px flex-1", st === "done" ? "bg-success" : "bg-border")} />
              )}
            </div>
          );
        })}
      </div>

      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{barLabel}</span>
        {!indeterminate && <span className="font-mono tabular-nums">{pct}%</span>}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full bg-accent transition-all", indeterminate && "animate-pulse")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {currentLine && <p className="mt-2 truncate text-[11.5px] text-foreground/80">{currentLine}</p>}
    </div>
  );
}

export function EvaluationRunsPage() {
  const { evaluationRuns, profiles, reports, deleteEvaluationRun, startEvaluationRun } = useQAStore();
  const navigate = useNavigate();
  const nameOf = (pid: string) => profiles.find((p) => p.id === pid)?.name ?? pid;

  const activeRun = evaluationRuns.find((r) => IN_FLIGHT.includes(r.status));
  const history = evaluationRuns.filter((r) => r.id !== activeRun?.id);
  const doneCount = evaluationRuns.filter((r) => r.status === "done" || r.status === "partial").length;

  // 任意多选:勾选项可批量删除;恰好选 2 个且同被测+皆有报告时还能对比。
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // 回归卡片:展开"具体回归了哪些题"。
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // 「看源运行」:滚动到源 run 卡片并短暂高亮(源 run 就在本列表里)。
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const goToSource = (sourceId: string) => {
    const el = document.getElementById(`run-${sourceId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    setFlashId(sourceId);
    flashTimerRef.current = window.setTimeout(() => setFlashId(null), 1600);
  };
  useEffect(() => () => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
  }, []);

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`确认删除选中的 ${selectedIds.length} 次评测运行?该操作不可撤销(报告本身不删)。`)) return;
    selectedIds.forEach((id) => deleteEvaluationRun(id));
    setSelectedIds([]);
  };

  const rerun = (r: EvaluationRun) => {
    startEvaluationRun({
      subjectProfileId: r.subjectProfileId,
      versionLabel: `${r.versionLabel} (重跑)`,
      config: cloneRunConfig(r),
      rerunOfRunId: r.id,
    });
  };

  const rerunFailed = (r: EvaluationRun) => {
    const report = reports.find((x) => x.id === r.reportId);
    const failed = report ? failedQuestionIdsFromReport(report) : (r.failedQuestionIds ?? []);
    if (failed.length === 0) return;
    startEvaluationRun({
      subjectProfileId: r.subjectProfileId,
      versionLabel: `${r.versionLabel} (回归失败)`,
      config: { ...cloneRunConfig(r), questionIds: failed },
      onlyFailedFromRunId: r.id,
    });
  };

  const compareRunA = selectedIds.length === 2 ? evaluationRuns.find((r) => r.id === selectedIds[0]) : undefined;
  const compareRunB = selectedIds.length === 2 ? evaluationRuns.find((r) => r.id === selectedIds[1]) : undefined;
  const compareReady =
    selectedIds.length === 2 && compareRunA != null && compareRunB != null && canCompare(compareRunA, compareRunB);
  // 不可对比时给出具体原因(显示在灰色「对比」按钮的 hover 提示里)。
  const compareReason = compareReady
    ? "对比这两个版本的报告"
    : compareRunA && compareRunB
      ? !compareRunA.reportId || !compareRunB.reportId
        ? "有一次运行还没出报告(未完成 / 失败 / 已取消),两次都出报告后才能对比"
        : compareRunA.subjectProfileId !== compareRunB.subjectProfileId
          ? `两次被测不同(${nameOf(compareRunA.subjectProfileId)} vs ${nameOf(compareRunB.subjectProfileId)}),只能对比同一被测的不同版本`
          : "这两次暂不可对比"
      : "需恰好选中 2 次运行才能对比";
  const handleCompare = () => {
    if (!compareReady || !compareRunA || !compareRunB) return;
    navigate(
      `/reports/${encodeURIComponent(compareRunA.reportId!)}?compare=${encodeURIComponent(compareRunB.reportId!)}&from=runs`,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 页头:与其它跳转页统一 —— 返回首页 + 动效徽标 + 标题 + 行内副标题 */}
      <header className="shrink-0 border-b border-border bg-card px-5 py-3">
        <div className="flex flex-wrap items-center gap-2 gap-y-2">
          <HomeButton />
          <HeaderIconBadge icon={FlaskConical} />
          <h1 className="text-[15px] font-semibold text-foreground">自动评测运行</h1>
          <span className="hidden text-[11.5px] text-muted-foreground md:inline">
            一键 跑题 → 评分 → 出报告,留档可回看 / 重跑 / 对比 ·{" "}
            共 {evaluationRuns.length} 次 · {doneCount} 完成{activeRun ? " · 1 进行中" : ""}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        {/* 多选工具条:选了 ≥1 项才出现(批量删除;恰好 2 项可对比) */}
        {selectedIds.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 gap-y-2 rounded-md border border-border bg-accent/5 px-3 py-1.5 text-[12px]">
            <span>已选 <strong className="text-foreground">{selectedIds.length}</strong> 项</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {selectedIds.length === 2 && (
                <Button
                  size="sm"
                  variant={compareReady ? "default" : "outline"}
                  onClick={handleCompare}
                  title={compareReason}
                  className={cn("h-7 gap-1 text-[11px]", !compareReady && "cursor-not-allowed opacity-50")}
                >
                  <Columns2 className="h-3.5 w-3.5" /> 对比
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-[11px] text-destructive hover:text-destructive"
                onClick={handleBulkDelete}
              >
                <Trash2 className="h-3.5 w-3.5" /> 删除选中({selectedIds.length})
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setSelectedIds([])}>
                取消
              </Button>
            </div>
          </div>
        )}

        {activeRun && <RunLiveCard run={activeRun} subjectName={nameOf(activeRun.subjectProfileId)} />}

      {evaluationRuns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
          <p className="text-[13px] font-medium text-foreground">还没有评测运行</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            到「题库」多选题 →「自动化评测」,一键 跑→评→出报告,结果留档在这里。
          </p>
        </div>
      ) : history.length === 0 ? (
        activeRun ? null : <p className="text-[12px] text-muted-foreground">还没有历史运行。</p>
      ) : (
        <>
          {activeRun && <div className="mb-2 text-[11px] font-medium text-muted-foreground">历史</div>}
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {history.map((r) => {
              const report = r.reportId ? reports.find((x) => x.id === r.reportId) : undefined;
              const items = report?.items ?? [];
              const passN = items.filter((i) => i.verdict === "passed").length;
              const failN = items.filter((i) => i.verdict === "failed").length;
              const totalN = items.length;
              const passRate = totalN ? Math.round((passN / totalN) * 100) : null;
              const conclusion = report?.metrics?.conclusion;
              const durMs = new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime();
              const judgeNames = r.config.judgeProfileIds.map(nameOf).join("、");
              const isDoneOrPartial = r.status === "done" || r.status === "partial";
              const canRerun = isDoneOrPartial || r.status === "interrupted" || r.status === "canceled" || r.status === "failed";

              return (
                <li
                  key={r.id}
                  id={`run-${r.id}`}
                  className={cn(
                    "flex flex-col rounded-lg border border-border bg-card px-3.5 py-3 text-[12px] transition-all hover:border-foreground/20",
                    flashId === r.id && "ring-2 ring-accent ring-offset-1",
                  )}
                >
                  {/* 行 1:勾选 + 被测·版本 + 状态 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        title="勾选可批量删除;选 2 个同被测且都已出报告的还能对比"
                        className="h-3.5 w-3.5 shrink-0 cursor-pointer"
                      />
                      <span className="truncate text-[13px] font-semibold">{nameOf(r.subjectProfileId)}</span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                        {r.versionLabel}
                      </span>
                    </div>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium", statusPillClass(r.status))}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>

                  {/* 行 2:配置元信息 */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{r.config.questionIds.length} 题 × {r.config.trialsPerQuestion} 次</span>
                    {judgeNames && <span>裁判 {judgeNames}</span>}
                    <span>{formatRelativeTime(r.createdAt)}</span>
                    {isDoneOrPartial && durMs > 0 && <span>用时 {fmtClock(durMs)}</span>}
                  </div>

                  {/* 行 3:结果摘要(有报告时) */}
                  {report ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px]">
                      <span className="text-foreground">
                        通过 <strong className="text-success">{passN}</strong>/{totalN}
                        {passRate != null ? `(${passRate}%)` : ""}
                      </span>
                      {failN > 0 && <span className="text-destructive">{failN} 失败</span>}
                      {conclusion && (
                        <span className="text-muted-foreground">
                          结论:<strong className="text-foreground">{CONCLUSION_LABEL[conclusion] ?? conclusion}</strong>
                        </span>
                      )}
                    </div>
                  ) : r.error ? (
                    <p className="mt-1.5 text-[11px] text-destructive">{r.error}</p>
                  ) : null}

                  {/* 溯源 + 回归成效:回归失败 → 信息化(来源/成效/可展开题清单);重跑 → 一行来源 */}
                  {r.onlyFailedFromRunId && (() => {
                    const src = evaluationRuns.find((x) => x.id === r.onlyFailedFromRunId);
                    const srcLabel = src ? `${nameOf(src.subjectProfileId)}·${src.versionLabel}` : "已删除的运行";
                    const expanded = expandedIds.includes(r.id);
                    return (
                      <div className="mt-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5 text-[11px]">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="shrink-0 text-muted-foreground">⟲ 回归</span>
                          <span className="font-medium text-foreground">{srcLabel}</span>
                          <span className="text-muted-foreground">的 {r.config.questionIds.length} 道失败题</span>
                          {src && (
                            <button type="button" onClick={() => goToSource(src.id)} className="text-accent hover:underline">
                              看源运行
                            </button>
                          )}
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          {report ? (
                            <>
                              → 重测后 <strong className="text-success">{passN}</strong> 通过 /{" "}
                              <strong className={failN > 0 ? "text-destructive" : "text-muted-foreground"}>{failN}</strong> 仍败
                            </>
                          ) : (
                            <>→ 尚无结果</>
                          )}
                        </div>
                        {items.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleExpand(r.id)}
                              className="mt-1 flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            >
                              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              {expanded ? "收起" : `展开这 ${items.length} 道题`}
                            </button>
                            {expanded && (
                              <ul className="mt-1 space-y-0.5">
                                {items.map((it) => (
                                  <li key={it.questionId} className="flex items-center gap-1.5">
                                    {it.verdict === "passed" ? (
                                      <Check className="h-3 w-3 shrink-0 text-success" />
                                    ) : (
                                      <X className="h-3 w-3 shrink-0 text-destructive" />
                                    )}
                                    <span className="truncate text-foreground/80" title={it.questionTitle}>
                                      {it.questionTitle}
                                    </span>
                                    <span className={cn("ml-auto shrink-0", it.verdict === "passed" ? "text-success" : "text-destructive")}>
                                      {it.verdict === "passed" ? "通过" : "仍失败"}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                  {r.rerunOfRunId && !r.onlyFailedFromRunId && (() => {
                    const src = evaluationRuns.find((x) => x.id === r.rerunOfRunId);
                    const srcLabel = src ? `${nameOf(src.subjectProfileId)}·${src.versionLabel}` : "已删除的运行";
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>↻ 重跑自</span>
                        <span className="font-medium text-foreground">{srcLabel}</span>
                        {src && (
                          <button type="button" onClick={() => goToSource(src.id)} className="text-accent hover:underline">
                            看源运行
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {/* 行 4:动作 */}
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                    {r.reportId && (
                      <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => navigate(`/reports/${encodeURIComponent(r.reportId!)}?from=runs`)}>
                        看报告
                      </Button>
                    )}
                    {canRerun && (
                      <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => rerun(r)}>
                        重跑
                      </Button>
                    )}
                    {isDoneOrPartial && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px]"
                        disabled={failN === 0}
                        onClick={() => rerunFailed(r)}
                        title={failN === 0 ? "本次没有失败题" : `只重跑 ${failN} 道失败题`}
                      >
                        只回归失败
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="ml-auto h-6 text-[11px] text-destructive hover:text-destructive" onClick={() => deleteEvaluationRun(r.id)}>
                      删除
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      </div>
    </div>
  );
}
