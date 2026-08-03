import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns2,
  HelpCircle,
  Highlighter,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  User,
  Wand2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/ui/markdown";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useQAStore,
  type SubEvalDraft,
  type JudgeSnapshot,
} from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { cn, formatRelativeTime } from "@/lib/utils";
import { FAILURE_CATEGORIES, FAILURE_CATEGORY_META } from "@/lib/failure-attribution";
import { judgeIsolationLevel } from "@/lib/judge-isolation";
import { answeredTurns } from "@/lib/conversation-turns";
import { cleanJudgeNotes, buildJudgePrompt, redlineCitationMissing } from "@/lib/judge";
import { collectJudgeFileTexts } from "@/lib/judge-attachments";
import { summarizeToolEvents } from "@/lib/tool-events";
import { getEffectivePromptVersion } from "@/lib/prompt-registry";
import { UNCERTAINTY_META } from "@/lib/uncertainty-signals";
import type { AgentProfile } from "@/agents/types";
import type { ChatMessage, EvaluationMode, Evaluation, ScoreDimension, AgentTranscript, Question, FloorElement } from "@/types";
import type { PassKSummary } from "@/lib/multi-trial";
import type { ToolEventSummary } from "@/lib/tool-events";
import { TranscriptViewerDialog } from "@/components/agent-panel/transcript-viewer-dialog";
import { FailureAttributionBadge } from "./failure-attribution-badge";
import { PassKBadge } from "./pass-k-badge";

/** 高亮标注(捕获选区)功能已按需求下线(可恢复):置回 true 即恢复。 */
const SHOW_ANNOTATIONS: boolean = false;

/** 题目未显式设评测方式时,打分面板默认走「LLM 评分」(而非人工);用户仍可切到人工。 */
const DEFAULT_EVAL_MODE: EvaluationMode = "llm";

type PresetKey = "excellent" | "good" | "mediocre" | "poor" | "reset";

const PRESETS: Record<
  PresetKey,
  { label: string; value: number; tone?: string }
> = {
  excellent: { label: "全 9.0", value: 9, tone: "text-success" },
  good: { label: "全 7.0", value: 7 },
  mediocre: { label: "全 5.0", value: 5 },
  poor: { label: "全 3.0", value: 3, tone: "text-destructive" },
  reset: { label: "清零", value: 0 },
};

export function EvaluationTab({
  surface = "score",
}: {
  /** "score":只显示打分表单(不显示结果);"result":只显示评测结果。 */
  surface?: "score" | "result";
}) {
  const {
    selectedQuestion,
    selectedMessages,
    isStreamingHere,
    isQuestionInProgressHere,
    setRightTab,
    scoreDraft,
    setScoreDraft,
    notesDraft,
    setNotesDraft,
    attributionDraft,
    setAttributionDraft,
    annotationsDraft,
    addAnnotation,
    removeAnnotation,
    subDrafts,
    ensureSubDrafts,
    submitEvaluation,
    submitSubEvaluations,
    runLLMJudge,
    isJudging,
    judgeError,
    judgeSnapshots,
    lastJudgeProfileIds,
    setLastJudgeProfileIds,
    setQuestionEvaluation,
    profiles,
    evaluations,
    employeeProfileMap,
    standardEmployees,
    passKByQInActiveConv,
    floorElements,
  } = useQAStore();

  const [compareOpen, setCompareOpen] = useState(false);
  // When the user clicks 重新评测, switch back to form for the same answer
  // even though there's already a submitted evaluation.
  const [forceEditMode, setForceEditMode] = useState(false);

  const lastAssistantMessage =
    selectedMessages.length > 0
      ? selectedMessages[selectedMessages.length - 1]
      : null;

  // 以**最新一条回答**判定是否 trial 模式:历史上跑过多 trial、但这次是普通
  // 单发(发送给 Agent)→ 不该被「多 trial 不做人工打分」拦住。
  const isTrialRun = lastAssistantMessage?.trialIndex != null;

  // 多轮对话(困难题预设的 subPrompts,或自适应追问运行时追加的轮次)→ **逐轮单评**:
  // 每轮独立判定/打分,整题任一轮失败即失败。判定标准 = 实际答出了 ≥2 个连续轮次
  // (turnIndex≥1),而非题目是否预设 subPrompts —— 这样自适应题也按困难题口径打分。
  // 单轮题 / 重发(都是 turnIndex 0)/ 多 trial 不触发。
  const isPerSub =
    !!selectedQuestion &&
    !isTrialRun &&
    selectedMessages.some((m) => (m.turnIndex ?? 0) >= 1);

  // 逐轮评分:按已答轮数把 subDrafts 补到位(进入 per-sub / 轮数变化时)。
  useEffect(() => {
    if (isPerSub) ensureSubDrafts(selectedMessages.length);
  }, [isPerSub, selectedMessages.length, selectedQuestion?.id, ensureSubDrafts]);

  const isInterrupted = !!lastAssistantMessage?.interrupted;

  // Evaluations submitted against the answer message(s) currently in view.
  // For combined mode that's a single eval keyed by lastAssistantMessage.id;
  // for per-sub it's one eval per sub message.
  const evalsForCurrentAnswers = useMemo<Evaluation[]>(() => {
    if (!selectedQuestion || selectedMessages.length === 0) return [];
    const msgIds = new Set(selectedMessages.map((m) => m.id));
    return evaluations
      .filter(
        (e) => e.questionId === selectedQuestion.id && msgIds.has(e.messageId),
      )
      .sort(
        (a, b) =>
          new Date(b.submittedAt).getTime() -
          new Date(a.submittedAt).getTime(),
      );
  }, [evaluations, selectedQuestion, selectedMessages]);
  const hasSubmittedResult = evalsForCurrentAnswers.length > 0;

  // Reset edit-mode override every time the user switches answer/question.
  // Without this, after re-evaluating Q1 and switching to Q2 then back, you'd
  // land in form mode on Q1 again instead of the summary.
  useMemo(() => {
    setForceEditMode(false);
    // intentionally only when the target message identity changes
  }, [lastAssistantMessage?.id, selectedQuestion?.id]);

  // ── 「结果」面 ──────────────────────────────────────────────
  // 只展示结果(多 trial 通过率 / 单题评分结果),不含打分表单。供「结果」tab 用。
  if (surface === "result") {
    if (selectedQuestion && isTrialRun) {
      return (
        <TrialResultSummary
          question={selectedQuestion}
          messages={selectedMessages}
          evals={evalsForCurrentAnswers}
          passK={passKByQInActiveConv.get(selectedQuestion.id)}
        />
      );
    }
    if (selectedQuestion && hasSubmittedResult) {
      return (
        <ResultSummary
          question={selectedQuestion}
          evals={evalsForCurrentAnswers}
          profiles={profiles}
          onReevaluate={() => {
            // 「重新评测」→ 回到「打分」tab 重打(种子填上次的分)。
            const latest = evalsForCurrentAnswers[0];
            if (latest) {
              setScoreDraft(latest.scores);
              setNotesDraft(latest.notes ?? "");
            }
            setRightTab("evaluation");
          }}
        />
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="rounded-full bg-muted p-3 text-muted-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-foreground">还没有评测结果</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          在「打分」里给这道题打分后，结果会显示在这里。
        </p>
      </div>
    );
  }

  // ── 「打分」面 ──────────────────────────────────────────────
  if (
    !selectedQuestion ||
    !lastAssistantMessage ||
    isQuestionInProgressHere ||
    isInterrupted
  ) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="rounded-full bg-muted p-3 text-muted-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-foreground">
          {isStreamingHere
            ? "Agent 正在回答..."
            : isQuestionInProgressHere
              ? "等待所有子问题完成..."
              : isInterrupted
                ? "回答未完成，无法评测"
                : "暂无可评测的回答"}
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {isQuestionInProgressHere
            ? "多轮题目会按顺序逐题流式发送，全部完成后即可评分"
            : isInterrupted
              ? "本题在生成过程中被中断，题目已恢复为「未测」。请在「当前任务」重新发送后再评分。"
              : "从「当前任务」发送题目，Agent 回答完成后即可在此评分"}
        </p>
      </div>
    );
  }

  // 多 trial 试跑题:只算通过率,不在「打分」里手动打分 —— 引导去「结果」看。
  if (isTrialRun) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="rounded-full bg-muted p-3 text-muted-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-foreground">多 trial 题不在此打分</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          多 trial 专测稳定性,只算通过率(pass^k),不做人工打分。结果见「结果」tab。
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-1 gap-1.5"
          onClick={() => setRightTab("results")}
        >
          去看通过率结果
        </Button>
      </div>
    );
  }

  // 打分面永远显示表单(即使已评过也可重打);结果在「结果」tab 看。
  void forceEditMode;
  void hasSubmittedResult;

  // 被测 agent:优先取实际回答这道题的 agent,回退到题目员工关联的 profile。
  const subjectProfileId =
    lastAssistantMessage.agentProfileId ??
    (selectedQuestion.targetEmployeeId
      ? (employeeProfileMap[selectedQuestion.targetEmployeeId] ??
        standardEmployees.find((e) => e.id === selectedQuestion.targetEmployeeId)
          ?.associatedProfileId ??
        null)
      : null);
  const subjectProviderId = subjectProfileId
    ? (profiles.find((p) => p.id === subjectProfileId)?.providerId ?? null)
    : null;

  const handleHighlight = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) {
      alert("请先在左侧 Agent 的回答里选中要标注的文字");
      return;
    }
    addAnnotation({ quote: text });
    sel?.removeAllRanges();
  };

  // 评分裁判只能是 LLM 模型(黄金准则 §7.1.2 隔离要求,judge 应独立于被测 agent)。
  const llmProfiles = profiles.filter(
    (p) => getProfileKind(p.providerId) === "llm",
  );
  // 保存的裁判选择(题目 → 上次 → 默认首个 LLM)。
  const rawJudgeIds =
    selectedQuestion.judgeProfileIds && selectedQuestion.judgeProfileIds.length > 0
      ? selectedQuestion.judgeProfileIds
      : lastJudgeProfileIds.length > 0
        ? lastJudgeProfileIds
        : llmProfiles.length > 0
          ? [llmProfiles[0].id]
          : [];
  // **与当前真实存在的 LLM 取交集**,剔除已删除 / 非 LLM 的陈旧 id —— 否则计数会比
  // 下拉里实际能选的多(例:保存了 4 个但有 1 个 profile 已删,池子标题显示「4 个评分
  // LLM」却只列出 3 个)。下拉的 selected 用这份,用户一交互就把残留 id 自动清掉。
  const effectiveJudgeIds = rawJudgeIds.filter((id) =>
    llmProfiles.some((p) => p.id === id),
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ScrollArea className="-mx-1 flex-1">
        <div className="space-y-4 px-1 pb-3">
          {/* 题名 + 整体评分徽章已移除 —— 上方「选择要打分的题」清单已承担选题/标识 */}
          <JudgeBar
            mode={selectedQuestion.evaluationMode ?? DEFAULT_EVAL_MODE}
            onModeChange={(m) =>
              setQuestionEvaluation(selectedQuestion.id, { evaluationMode: m })
            }
            judgeProfileIds={effectiveJudgeIds}
            onJudgeProfilesChange={(ids) => {
              setQuestionEvaluation(selectedQuestion.id, {
                judgeProfileIds: ids,
              });
              setLastJudgeProfileIds(ids);
            }}
            profiles={llmProfiles}
            onRunJudge={async (subIdx) => {
              if (effectiveJudgeIds.length === 0) return;
              // judge 隔离:剔除「自评」(同 profile);同供应商弹一次确认。
              const safeIds = effectiveJudgeIds.filter((idv) => {
                const p = profiles.find((x) => x.id === idv);
                // 只保留「能找到且非自评」的裁判:找不到 profile 的残留 id(已删配置)
                // 一并剔除,不让其混入。
                return (
                  p != null &&
                  judgeIsolationLevel(p, subjectProfileId, subjectProviderId) !== "self"
                );
              });
              if (safeIds.length === 0) return;
              const sameProv = safeIds.filter((idv) => {
                const p = profiles.find((x) => x.id === idv);
                return (
                  p &&
                  judgeIsolationLevel(p, subjectProfileId, subjectProviderId) ===
                    "same-provider"
                );
              });
              if (
                sameProv.length > 0 &&
                !window.confirm(
                  `有 ${sameProv.length} 位裁判与被测同供应商,独立性存疑(judge 应独立)。仍要继续?`,
                )
              ) {
                return;
              }
              if (isPerSub && subIdx == null) {
                // 逐轮题:一个按钮把每一轮依次判了(各轮带上下文、各自打分),
                // 不再让用户逐步点「评第 N 步」。
                for (let i = 0; i < selectedMessages.length; i++) {
                  await runLLMJudge({ judgeProfileIds: safeIds, subIndex: i });
                }
              } else {
                await runLLMJudge({ judgeProfileIds: safeIds, subIndex: subIdx });
              }
            }}
            isJudging={isJudging}
            judgeError={judgeError}
            isPerSub={isPerSub}
            subjectProfileId={subjectProfileId}
            subjectProviderId={subjectProviderId}
          />

          {/* 评判过程 — LLM 评分独有(逐裁判实时展开);人工模式不显示。 */}
          {(selectedQuestion.evaluationMode ?? DEFAULT_EVAL_MODE) === "llm" &&
            judgeSnapshots &&
            judgeSnapshots.messageId === lastAssistantMessage.id && (
              <>
                <JudgeBreakdown
                  snaps={judgeSnapshots.snaps}
                  profiles={profiles}
                  criteria={selectedQuestion.criteria}
                  defaultOpen
                  live={isJudging}
                  expected={judgeSnapshots.expected}
                  prompt={judgeSnapshots.prompt}
                  promptVersion={judgeSnapshots.promptVersion}
                  toolEvents={
                    lastAssistantMessage.transcript
                      ? summarizeToolEvents(lastAssistantMessage.transcript.steps)
                      : null
                  }
                  transcript={lastAssistantMessage.transcript}
                />
                {evalsForCurrentAnswers[0] && (
                  <JudgeCitation
                    question={selectedQuestion}
                    evaluation={evalsForCurrentAnswers[0]}
                    floorElements={floorElements}
                  />
                )}
              </>
            )}

          {/* 对比标准答案:单轮题放这里(整体);逐轮题挪到每一步卡片内(各轮各比)。 */}
          {!isPerSub && selectedQuestion.referenceAnswer && (
            <div className="flex justify-end">
              <Button
                variant={compareOpen ? "default" : "outline"}
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => setCompareOpen((v) => !v)}
              >
                <Columns2 className="h-3 w-3" /> 对比标准答案
              </Button>
            </div>
          )}
          {!isPerSub && compareOpen && selectedQuestion.referenceAnswer && (
            <section className="rounded-lg border border-border bg-card">
              <div className="grid grid-cols-2 divide-x divide-border">
                <div className="max-h-72 overflow-auto p-3">
                  <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                    标准答案
                  </div>
                  <Markdown>{selectedQuestion.referenceAnswer}</Markdown>
                </div>
                <div className="max-h-72 overflow-auto p-3">
                  <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                    Agent 最终回答
                  </div>
                  <Markdown>{lastAssistantMessage.content}</Markdown>
                </div>
              </div>
            </section>
          )}

          {/* Mode-specific UI:人工=可调滑杆;LLM=只读展示评分结果(未评则占位) */}
          {isPerSub ? (
            <PerSubEditor />
          ) : (
            <CombinedEditor
              scoreDraft={scoreDraft}
              setScoreDraft={setScoreDraft}
              question={selectedQuestion}
              mode={selectedQuestion.evaluationMode ?? DEFAULT_EVAL_MODE}
              llmScored={
                !!judgeSnapshots &&
                judgeSnapshots.messageId === lastAssistantMessage.id &&
                judgeSnapshots.snaps.length > 0
              }
              judging={isJudging}
            />
          )}

          {/* Annotations — single pool, applies to whole question */}
          {SHOW_ANNOTATIONS && (
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Highlighter className="h-3 w-3" />
                高亮标注
                {annotationsDraft.length > 0 && (
                  <Badge variant="muted" className="text-[10px]">
                    {annotationsDraft.length}
                  </Badge>
                )}
              </span>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <HelpCircle className="h-3 w-3 cursor-help text-muted-foreground" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    在左侧选中回答里的文字，点「捕获选区」
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={handleHighlight}
                >
                  <Highlighter className="h-3 w-3" /> 捕获选区
                </Button>
              </div>
            </div>
            <div className="p-3">
              {annotationsDraft.length === 0 ? (
                <p className="text-[11.5px] text-muted-foreground">
                  没有标注。在左侧用鼠标划选问题片段，点「捕获选区」即可标注。
                </p>
              ) : (
                <ul className="space-y-2">
                  {annotationsDraft.map((a) => (
                    <li
                      key={a.id}
                      className="rounded-md border border-border bg-background p-2"
                    >
                      <blockquote className="border-l-2 border-accent pl-2 text-[12px] text-muted-foreground">
                        {a.quote}
                      </blockquote>
                      <div className="mt-1.5 flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-6 w-6"
                          onClick={() => removeAnnotation(a.id)}
                          aria-label="移除标注"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          )}

          {/* Overall notes — combined mode only (per-sub has per-step notes) */}
          {!isPerSub && (
            <section className="space-y-2">
              <label
                htmlFor="eval-notes"
                className="text-xs font-medium text-muted-foreground"
              >
                备注
                <span className="ml-1 font-normal text-muted-foreground/70">
                  ({notesDraft.length} 字)
                </span>
              </label>
              <Textarea
                id="eval-notes"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="例如：边界处理完整，但缺少并发安全性说明..."
                rows={4}
                className="text-[13px]"
              />
            </section>
          )}

          {!isPerSub && (
            <section className="space-y-2 rounded-lg border border-border bg-card p-3">
              <div className="text-xs font-medium text-muted-foreground">
                失败归因 <span className="font-normal text-muted-foreground/70">(仅判「失败」时生效)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FAILURE_CATEGORIES.map((c) => {
                  const active = attributionDraft?.primary === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() =>
                        setAttributionDraft(
                          active
                            ? null
                            : { primary: c, source: "manual", secondary: undefined, note: attributionDraft?.note },
                        )
                      }
                      className="rounded border px-2 py-1 text-[11px]"
                      style={
                        active
                          ? { borderColor: FAILURE_CATEGORY_META[c].color, color: FAILURE_CATEGORY_META[c].color, backgroundColor: `${FAILURE_CATEGORY_META[c].color}1a` }
                          : undefined
                      }
                    >
                      {FAILURE_CATEGORY_META[c].label}
                    </button>
                  );
                })}
              </div>
              {attributionDraft && (
                <div className="space-y-1.5">
                  <div className="text-[10.5px] text-muted-foreground">次因(可选,可多选)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {FAILURE_CATEGORIES.filter((c) => c !== attributionDraft.primary).map((c) => {
                      const on = (attributionDraft.secondary ?? []).includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            const cur = attributionDraft.secondary ?? [];
                            const next = on ? cur.filter((x) => x !== c) : [...cur, c];
                            setAttributionDraft({ ...attributionDraft, source: "manual", secondary: next.length ? next : undefined });
                          }}
                          className="rounded border px-2 py-0.5 text-[10.5px]"
                          style={on ? { borderColor: FAILURE_CATEGORY_META[c].color, color: FAILURE_CATEGORY_META[c].color } : undefined}
                        >
                          {FAILURE_CATEGORY_META[c].label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          <p className="text-[10.5px] text-muted-foreground">
            最近响应：{formatRelativeTime(lastAssistantMessage.createdAt)}
          </p>
        </div>
      </ScrollArea>

      {/* Submit bar */}
      {isPerSub ? (
        <PerSubSubmitBar
          subDrafts={subDrafts}
          onSubmit={() => {
            submitSubEvaluations();
            // After a fresh submit, drop the "force-edit" override so the
            // user sees the result summary instead of bouncing back to a
            // reset form.
            setForceEditMode(false);
          }}
        />
      ) : (
        <div className="grid shrink-0 grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => {
              submitEvaluation("failed");
              setForceEditMode(false);
            }}
            className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <XCircle /> 失败
          </Button>
          <Button
            variant="success"
            onClick={() => {
              submitEvaluation("passed");
              setForceEditMode(false);
            }}
          >
            <CheckCircle2 /> 通过
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------- Combined-mode editor --------------------------- */

export function CombinedEditor({
  scoreDraft,
  setScoreDraft,
  question,
  mode,
  llmScored,
  judging,
}: {
  scoreDraft: ScoreDimension[];
  setScoreDraft: (s: ScoreDimension[]) => void;
  question: NonNullable<ReturnType<typeof useQAStore>["selectedQuestion"]>;
  /** 人工=可调滑杆;LLM=只读展示 LLM 评分结果。 */
  mode: EvaluationMode;
  /** LLM 模式下:本条回答是否已有 LLM 评分(裁判已返回)。 */
  llmScored: boolean;
  /** LLM 裁判正在运行中。 */
  judging: boolean;
}) {
  const readOnly = mode === "llm";
  const weighted = useMemo(() => {
    if (!scoreDraft.length) return 0;
    return scoreDraft.reduce((sum, s) => {
      const w =
        question.criteria.find((c) => c.key === s.key)?.weight ??
        1 / scoreDraft.length;
      return sum + s.value * w;
    }, 0);
  }, [scoreDraft, question]);

  const applyPreset = (key: PresetKey) => {
    const v = PRESETS[key].value;
    setScoreDraft(scoreDraft.map((s) => ({ ...s, value: v })));
  };

  const updateScore = (key: string, value: number) => {
    setScoreDraft(scoreDraft.map((s) => (s.key === key ? { ...s, value } : s)));
  };

  // LLM 模式还没有评分结果 → 占位,不显示可调表单。
  if (readOnly && !llmScored) {
    return (
      <section className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
        <div className="text-[13px] font-medium text-foreground">
          {judging ? "LLM 评测中…" : "待 LLM 评测后展示"}
        </div>
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          {judging
            ? "裁判返回后,这里会展示加权评分和各维度得分。"
            : "点上方「由 LLM 评分」运行裁判,评分结果将在这里展示;需要手动打分请切到「人工」。"}
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground">
              加权评分
              {readOnly && (
                <span className="ml-1 text-muted-foreground/70">
                  · LLM 评分结果(只读)
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                {weighted.toFixed(2)}
              </span>
              <span className="text-xs text-muted-foreground">/ 10</span>
            </div>
          </div>
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                >
                  <Wand2 className="h-3 w-3" /> 模板
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>快速评分</DropdownMenuLabel>
                {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
                  <DropdownMenuItem
                    key={k}
                    onSelect={() => applyPreset(k)}
                    className={PRESETS[k].tone}
                  >
                    {PRESETS[k].label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-300"
            style={{ width: `${(weighted / 10) * 100}%` }}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="text-xs font-medium text-muted-foreground">评分维度</div>
        <div className="space-y-3">
          {scoreDraft.map((s) => {
            const weight = question.criteria.find((c) => c.key === s.key)?.weight;
            return (
              <div key={s.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    {s.label}
                    {weight != null && (
                      <span className="font-mono text-[10px] font-normal text-muted-foreground">
                        ×{weight.toFixed(2)}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      s.value >= 8
                        ? "text-success"
                        : s.value >= 5
                          ? "text-foreground"
                          : "text-destructive",
                    )}
                  >
                    {s.value.toFixed(2)}
                  </span>
                </div>
                {readOnly ? (
                  // LLM 评分结果:只读进度条,不可调。
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-300"
                      style={{ width: `${(s.value / 10) * 100}%` }}
                    />
                  </div>
                ) : (
                  <Slider
                    value={[s.value]}
                    min={0}
                    max={10}
                    step={0.5}
                    onValueChange={(v) => updateScore(s.key, v[0])}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

/* --------------------------- Per-sub editor ------------------------------- */

function PerSubEditor() {
  const {
    selectedQuestion,
    selectedMessages,
    activeConversation,
    subDrafts,
    updateSubDraft,
    floorElements,
  } = useQAStore();

  // 每轮的用户提问(与回答配对),用于在分步卡里显示这一轮"在问什么"。
  const turns = useMemo(
    () =>
      selectedQuestion
        ? answeredTurns(activeConversation?.messages ?? [], selectedQuestion.id)
        : [],
    [activeConversation, selectedQuestion],
  );

  // 每轮各自的「评测 Prompt」——逐轮单评下,每轮的对话上下文 + subIndex 不同,
  // prompt 也不同。和真实判分(runBatchJudge)同款构造,所见即所发。
  const perTurnPrompts = useMemo(() => {
    if (!selectedQuestion) return [];
    const redLineEls = (selectedQuestion.floorElementIds ?? [])
      .map((fid) => floorElements.find((f) => f.id === fid && f.isRedLine))
      .filter(Boolean) as typeof floorElements;
    const isRedLine = redLineEls.length > 0;
    const redLineNotes = isRedLine
      ? redLineEls
          .map((e) => `「${e.title}」(应做到:${e.passForm || "—"};不可:${e.failForm || "—"})`)
          .join(";")
      : undefined;
    return turns.map((t, i) => {
      const attach = collectJudgeFileTexts([t.assistant.transcript]);
      return buildJudgePrompt({
        question: selectedQuestion,
        userPrompt: t.userPrompt,
        agentAnswer: t.assistant.content,
        // 上下文 = 到本轮为止的对话;subIndex 标出被评轮(=「只评第 i+1 轮」)。
        dialogue: turns
          .slice(0, i + 1)
          .map((x) => ({ user: x.userPrompt, assistant: x.assistant.content })),
        subIndex: i,
        isRedLine,
        redLineNotes,
        toolEvents: t.assistant.transcript
          ? summarizeToolEvents(t.assistant.transcript.steps)
          : null,
        attachedFiles: attach.files,
        attachmentsOmitted: attach.omittedCount,
      });
    });
  }, [selectedQuestion, turns, floorElements]);
  const judgePromptVersion = getEffectivePromptVersion("llm-judge");

  if (!selectedQuestion || subDrafts.length === 0) return null;
  const mode = selectedQuestion.evaluationMode ?? DEFAULT_EVAL_MODE;
  const referenceAnswer = selectedQuestion.referenceAnswer;

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        逐轮评分 · 每轮独立判定打分(整题任一轮失败即失败)
      </div>
      <div className="divide-y divide-border">
        {subDrafts.map((draft, i) => (
          <SubSection
            key={i}
            index={i}
            draft={draft}
            mode={mode}
            referenceAnswer={referenceAnswer}
            userPrompt={turns[i]?.userPrompt ?? ""}
            answer={turns[i]?.assistant.content ?? selectedMessages[i]?.content ?? ""}
            criteria={selectedQuestion.criteria}
            judgePrompt={perTurnPrompts[i] ?? null}
            judgePromptVersion={judgePromptVersion}
            onChange={(patch) => updateSubDraft(i, patch)}
          />
        ))}
      </div>
    </section>
  );
}

function SubSection({
  index,
  draft,
  mode,
  referenceAnswer,
  userPrompt,
  answer,
  criteria,
  judgePrompt,
  judgePromptVersion,
  onChange,
}: {
  index: number;
  draft: SubEvalDraft;
  /** 人工=可调;LLM=只读(评完展示,未评则占位)。 */
  mode: EvaluationMode;
  /** 题目标准答案(各轮对比共用一份;右侧换成本轮回答 → 每轮对比不同)。 */
  referenceAnswer?: string;
  userPrompt?: string;
  answer: string;
  criteria: NonNullable<ReturnType<typeof useQAStore>["selectedQuestion"]>["criteria"];
  /** 本轮(逐轮单评)实际发给裁判的评测 prompt —— 每轮上下文/subIndex 不同,prompt 也不同。 */
  judgePrompt?: string | null;
  judgePromptVersion?: number;
  onChange: (patch: Partial<SubEvalDraft>) => void;
}) {
  const [open, setOpen] = useState(true);
  const [compareOpen, setCompareOpen] = useState(false);
  const readOnly = mode === "llm";
  const llmScored = draft.verdict != null;

  const weighted = useMemo(() => {
    if (!draft.scores.length) return 0;
    return draft.scores.reduce((sum, s) => {
      const w =
        criteria.find((c) => c.key === s.key)?.weight ?? 1 / draft.scores.length;
      return sum + s.value * w;
    }, 0);
  }, [draft.scores, criteria]);

  const applyPreset = (key: PresetKey) => {
    const v = PRESETS[key].value;
    onChange({ scores: draft.scores.map((s) => ({ ...s, value: v })) });
  };

  const updateScore = (sKey: string, value: number) => {
    onChange({
      scores: draft.scores.map((s) =>
        s.key === sKey ? { ...s, value } : s,
      ),
    });
  };

  const setVerdict = (v: Evaluation["verdict"] | null) => {
    onChange({ verdict: v });
  };

  return (
    <div>
      {/* 头部:左侧整块点开/收起;右侧「对比标准答案」+ 折叠箭头(独立按钮) */}
      <div className="flex items-center gap-2 px-3 py-2 text-[12px]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors"
        >
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[10.5px] font-semibold text-background">
            {index + 1}
          </span>
          <span className="font-medium text-foreground">第 {index + 1} 步</span>
          {(!readOnly || llmScored) && (
            <span className="font-mono tabular-nums text-muted-foreground">
              {weighted.toFixed(2)} / 10
            </span>
          )}
          {draft.verdict ? (
            <Badge
              variant={
                draft.verdict === "passed"
                  ? "success"
                  : draft.verdict === "failed"
                    ? "destructive"
                    : "warning"
              }
              className="text-[10px]"
            >
              {draft.verdict === "passed"
                ? "通过"
                : draft.verdict === "failed"
                  ? "失败"
                  : "部分"}
            </Badge>
          ) : (
            <Badge variant="muted" className="text-[10px]">
              {readOnly ? "待 LLM 评" : "未判定"}
            </Badge>
          )}
        </button>
        {referenceAnswer && (
          <Button
            variant={compareOpen ? "default" : "outline"}
            size="sm"
            className="h-6 shrink-0 gap-1 px-2 text-[10.5px]"
            onClick={() => setCompareOpen((v) => !v)}
          >
            <Columns2 className="h-3 w-3" /> 对比标准答案
          </Button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-muted-foreground"
          aria-label={open ? "收起" : "展开"}
        >
          {open ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* 对比标准答案:左=题目标准答案,右=**本轮**回答(每轮各不同) */}
      {compareOpen && referenceAnswer && (
        <div className="border-t border-border">
          <div className="grid grid-cols-2 divide-x divide-border">
            <div className="max-h-60 overflow-auto p-3">
              <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                标准答案
              </div>
              <Markdown>{referenceAnswer}</Markdown>
            </div>
            <div className="max-h-60 overflow-auto p-3">
              <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                第 {index + 1} 轮 Agent 回答
              </div>
              {answer.trim() ? (
                <Markdown>{answer}</Markdown>
              ) : (
                <p className="text-[12px] text-muted-foreground">（无回答）</p>
              )}
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-border bg-background px-3 py-3">
          {userPrompt && (
            <div className="rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-[12px]">
              <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
                本轮用户提问
              </div>
              <div className="text-foreground/85">{userPrompt}</div>
            </div>
          )}
          {answer && (
            <details className="rounded-md border border-border bg-card/40 text-[12px]" open>
              <summary className="cursor-pointer px-2 py-1 text-muted-foreground">
                本轮 Agent 回答
              </summary>
              <div className="max-h-48 overflow-auto border-t border-border p-2">
                <Markdown>{answer}</Markdown>
              </div>
            </details>
          )}

          {/* 本轮评测 Prompt:逐轮单评下每轮上下文/subIndex 不同,prompt 各异(默认收起)。 */}
          {judgePrompt && (
            <details className="rounded-md border border-border bg-card/40 text-[11px]">
              <summary className="cursor-pointer px-2 py-1 text-muted-foreground">
                📋 本轮评测 Prompt(只评第 {index + 1} 轮)
                {judgePromptVersion != null && (
                  <span className="ml-1.5 rounded bg-secondary px-1 py-px font-mono text-[10px]">
                    出自 LLM 判分{" "}
                    {judgePromptVersion === 1 ? "内置默认 v1" : `v${judgePromptVersion}`}
                  </span>
                )}
              </summary>
              <div className="max-h-72 overflow-auto border-t border-border p-2 leading-relaxed">
                <Markdown>{judgePrompt}</Markdown>
              </div>
            </details>
          )}

          {readOnly && !llmScored ? (
            // LLM 模式还没评这一轮 → 占位,不显示可调表单。
            <div className="rounded-md border border-dashed border-border p-4 text-center">
              <div className="text-[12px] font-medium text-foreground">
                待 LLM 评测后展示
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                点上方「由 LLM 逐轮评分」,本轮评分结果会在这里只读展示;需手动打分请切到「人工」。
              </p>
            </div>
          ) : (
            <>
              {/* Verdict:人工可点;LLM 只读展示 */}
              {readOnly ? (
                <div className="text-[11px] text-muted-foreground">
                  LLM 评分结果(只读) · 判定{" "}
                  <span
                    className={cn(
                      "font-medium",
                      draft.verdict === "passed" ? "text-success" : "text-destructive",
                    )}
                  >
                    {draft.verdict === "passed" ? "通过" : "失败"}
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    variant={draft.verdict === "failed" ? "destructive" : "outline"}
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setVerdict("failed")}
                  >
                    <XCircle className="h-3 w-3" /> 失败
                  </Button>
                  <Button
                    variant={draft.verdict === "passed" ? "success" : "outline"}
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setVerdict("passed")}
                  >
                    <CheckCircle2 className="h-3 w-3" /> 通过
                  </Button>
                </div>
              )}

              {/* Score:人工=滑杆;LLM=只读进度条 */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>评分维度</span>
                  {!readOnly && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-[11px]"
                        >
                          <Wand2 className="h-3 w-3" /> 模板
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
                          <DropdownMenuItem
                            key={k}
                            onSelect={() => applyPreset(k)}
                            className={PRESETS[k].tone}
                          >
                            {PRESETS[k].label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {draft.scores.map((s) => (
                  <div key={s.key} className="space-y-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-foreground">{s.label}</span>
                      <span
                        className={cn(
                          "font-mono tabular-nums",
                          s.value >= 8
                            ? "text-success"
                            : s.value >= 5
                              ? "text-foreground"
                              : "text-destructive",
                        )}
                      >
                        {s.value.toFixed(2)}
                      </span>
                    </div>
                    {readOnly ? (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-300"
                          style={{ width: `${(s.value / 10) * 100}%` }}
                        />
                      </div>
                    ) : (
                      <Slider
                        value={[s.value]}
                        min={0}
                        max={10}
                        step={0.5}
                        onValueChange={(v) => updateScore(s.key, v[0])}
                      />
                    )}
                  </div>
                ))}
              </div>

              {readOnly ? (
                draft.notes ? (
                  <p className="text-[11.5px] text-muted-foreground">
                    评语:{draft.notes}
                  </p>
                ) : null
              ) : (
                <Textarea
                  value={draft.notes}
                  onChange={(e) => onChange({ notes: e.target.value })}
                  placeholder="本步备注（可选）"
                  rows={2}
                  className="text-[12px]"
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Per-sub submit bar --------------------------- */

function PerSubSubmitBar({
  subDrafts,
  onSubmit,
}: {
  subDrafts: SubEvalDraft[];
  onSubmit: () => void;
}) {
  const decided = subDrafts.filter((d) => d.verdict != null).length;
  const total = subDrafts.length;
  const ready = decided === total;

  const summary = useMemo(() => {
    let p = 0,
      f = 0;
    for (const d of subDrafts) {
      if (d.verdict === "passed") p++;
      else if (d.verdict === "failed") f++;
    }
    return { p, f };
  }, [subDrafts]);

  return (
    <div className="shrink-0 space-y-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          已判定 <span className="font-mono text-foreground">{decided}</span> /{" "}
          <span className="font-mono">{total}</span> 步
        </span>
        <div className="flex items-center gap-2">
          {summary.p > 0 && (
            <span className="text-success">{summary.p} 通过</span>
          )}
          {summary.f > 0 && (
            <span className="text-destructive">{summary.f} 失败</span>
          )}
        </div>
      </div>
      <Button
        variant="default"
        size="lg"
        className="w-full"
        disabled={!ready}
        onClick={onSubmit}
      >
        {ready
          ? `提交 ${total} 条分步评测`
          : `请先判定剩余 ${total - decided} 步`}
      </Button>
    </div>
  );
}

function JudgeBar({
  mode,
  onModeChange,
  judgeProfileIds,
  onJudgeProfilesChange,
  profiles,
  onRunJudge,
  isJudging,
  judgeError,
  isPerSub,
  subjectProfileId,
  subjectProviderId,
}: {
  mode: EvaluationMode;
  onModeChange: (m: EvaluationMode) => void;
  judgeProfileIds: string[];
  onJudgeProfilesChange: (ids: string[]) => void;
  profiles: AgentProfile[];
  onRunJudge: (subIdx?: number) => Promise<void>;
  isJudging: boolean;
  judgeError: string | null;
  isPerSub: boolean;
  subjectProfileId: string | null;
  subjectProviderId: string | null;
}) {
  const noJudge = judgeProfileIds.length === 0;
  const multi = judgeProfileIds.length >= 2;
  const buttonLabel = multi ? `让 ${judgeProfileIds.length} 位裁判校准` : "由 LLM 评分";
  return (
    <section className="rounded-lg border border-border bg-card/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-medium text-muted-foreground">
          评测方式
        </div>
        {/* 让开关这格吃掉剩余空间(而不是给右侧那组挂 ml-auto):同行时右侧组照样贴右,
            这行 flex-wrap 换行后右侧组会左对齐,不会被顶到第二行右端、在开关右边留一片空白。
            m-4:用 grow(flex-grow: 1),不用 flex-1(= flex: 1 1 0%)—— flex-1 的
            basis 0% 会把这一格的假想主轴尺寸从 max-content 降到 min-content,容器变窄到
            某个中间宽度时这里就不再正常换行、而是被压扁。grow 保留 basis auto,只多"抢占
            剩余空间"这一点,换行阈值不受影响;这里从不需要收缩,两种写法视觉上等价,
            所以别"顺手统一"回 flex-1。 */}
        <div className="flex grow items-center">
          <ModeToggle mode={mode} onChange={onModeChange} />
        </div>
        {mode === "llm" && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">
              {multi ? "评分 LLM 池" : "评分 LLM"}
            </span>
            <JudgePoolPicker
              selected={judgeProfileIds}
              profiles={profiles}
              onChange={onJudgeProfilesChange}
              subjectProfileId={subjectProfileId}
              subjectProviderId={subjectProviderId}
            />
            {/* 逐轮题也只用一个按钮:点一下把每一轮依次判了,不逐步点。 */}
            <Button
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={isJudging || noJudge}
              onClick={() => onRunJudge()}
            >
              {isJudging ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Bot className="h-3 w-3" />
              )}
              {isJudging ? "评测中" : isPerSub ? "由 LLM 逐轮评分" : buttonLabel}
            </Button>
          </div>
        )}
      </div>
      {judgeError && (
        <p className="mt-1.5 text-[11px] text-destructive">{judgeError}</p>
      )}
      {mode === "llm" && (
        <p className="mt-1.5 text-[10.5px] text-muted-foreground">
          {multi
            ? `LLM 评分会用 ${judgeProfileIds.length} 位裁判依次打分，并自动计算 Pass/Fail 一致率（≥85% 算校准通过，§7.1.3）。`
            : "LLM 评分结果会在下方只读展示;需要手动打分请切到「人工」。"}
        </p>
      )}
    </section>
  );
}

/**
 * Multi-select judge picker — Popover + checkbox list. Single-selection is
 * still valid (equivalent to legacy single-judge mode); ≥2 enables auto
 * agreement calculation in runLLMJudge.
 */
function JudgePoolPicker({
  selected,
  profiles,
  onChange,
  subjectProfileId,
  subjectProviderId,
}: {
  selected: string[];
  profiles: AgentProfile[];
  onChange: (ids: string[]) => void;
  subjectProfileId: string | null;
  subjectProviderId: string | null;
}) {
  const selectedNames = selected
    .map((id) => profiles.find((p) => p.id === id)?.name ?? id)
    .filter(Boolean);
  const label =
    selectedNames.length === 0
      ? "选评分 LLM…"
      : selectedNames.length === 1
        ? selectedNames[0]
        : `${selectedNames.length} 个评分 LLM`;
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 min-w-[160px] justify-between gap-1 px-2 text-[12px]"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[240px] p-1">
        {profiles.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
            暂无可用 LLM 模型 — 先去左侧导航「LLM 模型」里添加
          </div>
        ) : (
          <ul className="max-h-72 overflow-auto">
            {profiles.map((p) => {
              const on = selected.includes(p.id);
              const level = judgeIsolationLevel(p, subjectProfileId, subjectProviderId);
              const isSelf = level === "self";
              const isSameProv = level === "same-provider";
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={isSelf}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px]",
                      isSelf
                        ? "cursor-not-allowed opacity-50"
                        : "hover:bg-accent/30",
                    )}
                    onClick={() => {
                      if (!isSelf) toggle(p.id);
                    }}
                  >
                    <Checkbox
                      checked={on}
                      disabled={isSelf}
                      onCheckedChange={() => {
                        if (!isSelf) toggle(p.id);
                      }}
                    />
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate">{p.name}</span>
                      <ProviderTag providerId={p.providerId} />
                    </span>
                    {isSelf && (
                      <span className="shrink-0 text-[9.5px] font-medium text-destructive">
                        ⛔ 被测对象,不可自评
                      </span>
                    )}
                    {isSameProv && (
                      <span className="shrink-0 text-[9.5px] font-medium text-warning">
                        ⚠️ 同供应商
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ProviderTag({ providerId }: { providerId: string }) {
  const meta: Record<string, { label: string; cls: string }> = {
    platform: {
      label: "Platform",
      cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    },
    "openai-compat": {
      label: "OpenAI 协议",
      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    },
    newapi: {
      label: "NewAPI",
      cls: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
    },
    anthropic: {
      label: "Anthropic",
      cls: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
    },
    mock: {
      label: "mock",
      cls: "bg-muted text-muted-foreground",
    },
  };
  const m = meta[providerId] ?? {
    label: providerId,
    cls: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 text-[9.5px] font-medium uppercase tracking-wide",
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: EvaluationMode;
  onChange: (m: EvaluationMode) => void;
}) {
  return (
    <div className="inline-flex h-7 rounded-md border border-border bg-background p-0.5 text-[11px]">
      <ModeButton
        active={mode === "manual"}
        onClick={() => onChange("manual")}
        icon={<User className="h-3 w-3" />}
        label="人工"
      />
      <ModeButton
        active={mode === "llm"}
        onClick={() => onChange("llm")}
        icon={<Bot className="h-3 w-3" />}
        label="LLM"
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-2 transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* --------------------------- Judge breakdown ------------------------------ */

type JudgeCriteria = NonNullable<
  ReturnType<typeof useQAStore>["selectedQuestion"]
>["criteria"];

function weightedScore(scores: ScoreDimension[], criteria: JudgeCriteria): number {
  if (!scores.length) return 0;
  return scores.reduce((sum, s) => {
    const w =
      criteria.find((c) => c.key === s.key)?.weight ?? 1 / scores.length;
    return sum + s.value * w;
  }, 0);
}

/**
 * 判分结果复核:展示「裁判当时看到的工具调用」——与喂给裁判的 toolBlock 同源同口径。
 * 三态:null=无轨迹 / []=未触发工具 / [..]=列出(名 ✓/✗ · 次数 · 失败;有 sample 可展开看脱密 I/O)。
 * 末尾「查看完整轨迹」复用 TranscriptViewerDialog。
 */
function JudgeToolSummary({
  toolEvents,
  transcript,
}: {
  toolEvents: ToolEventSummary[] | null;
  transcript?: AgentTranscript;
}) {
  const [viewer, setViewer] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <section className="rounded-lg border border-border bg-card p-2.5">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <span className="text-foreground">裁判看到的工具调用</span>
        {transcript && (
          <button
            type="button"
            onClick={() => setViewer(true)}
            className="ml-auto text-[10.5px] text-accent underline-offset-2 hover:underline"
          >
            查看完整轨迹
          </button>
        )}
      </div>
      {toolEvents == null ? (
        <p className="text-[11px] text-muted-foreground">本次无执行轨迹。</p>
      ) : toolEvents.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">未触发任何工具。</p>
      ) : (
        <ul className="space-y-1">
          {toolEvents.map((t, i) => {
            const hasSample = !!(t.sample?.input || t.sample?.output);
            return (
              <li key={t.name} className="rounded border border-border/60 px-2 py-1 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-foreground">🔧 {t.name}</span>
                  <span className={t.errors === 0 ? "text-success" : "text-destructive"}>
                    {t.errors === 0 ? "✓" : "✗"}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {t.calls} 次{t.errors > 0 ? ` · ${t.errors} 失败` : ""}
                  </span>
                  {hasSample ? (
                    <button
                      type="button"
                      onClick={() => setOpenIdx(openIdx === i ? null : i)}
                      className="ml-auto text-[10.5px] text-accent underline-offset-2 hover:underline"
                    >
                      {openIdx === i ? "收起" : "入参/出参"}
                    </button>
                  ) : (
                    <span
                      className="ml-auto text-[10px] text-muted-foreground"
                      title="此工具的入参/出参未存档(默认不保留)。需运维在服务端开启 CAPTURE_TOOL_IO 后重新运行才会捕获,且会自动隐去其中的敏感信息。"
                    >
                      入参/出参未捕获
                    </span>
                  )}
                </div>
                {openIdx === i && hasSample && (
                  <pre className="mt-1 overflow-x-auto rounded bg-background p-1.5 text-[10.5px] leading-relaxed">
                    {t.sample?.input ? `入参(敏感信息已隐去·节选):${t.sample.input}\n` : ""}
                    {t.sample?.output ? `出参(敏感信息已隐去·节选):${t.sample.output}` : ""}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {transcript && (
        <TranscriptViewerDialog transcript={transcript} open={viewer} onOpenChange={setViewer} />
      )}
    </section>
  );
}

/**
 * 「依据条款」chip + 缺引用提醒。
 * 从 JudgeBreakdown 抽出,单/多裁判结果视图均可独立渲染。
 */
function JudgeCitation({
  question,
  evaluation,
  floorElements,
}: {
  question: Pick<Question, "isRedLine" | "floorElementIds">;
  evaluation: Pick<Evaluation, "verdict" | "failureAttribution" | "citedFloorElementIds">;
  floorElements: FloorElement[];
}) {
  const ids = evaluation.citedFloorElementIds ?? [];
  const cited = ids
    .map((id) => floorElements.find((f) => f.id === id))
    .filter((f): f is NonNullable<typeof f> => !!f);
  const missing = redlineCitationMissing(question, evaluation, floorElements);
  if (cited.length === 0 && !missing) return null;
  return (
    <div className="border-t border-border px-3 py-2 text-[11.5px]">
      {cited.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">依据条款:</span>
          {cited.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5">
              {f.title}
              {f.isRedLine && <span className="text-[9.5px] text-destructive">红线</span>}
            </span>
          ))}
        </div>
      )}
      {missing && (
        <div className="mt-1 text-destructive">⚠️ 红线判定缺条款引用,建议复核</div>
      )}
    </div>
  );
}

/**
 * 「评判过程」展开:逐裁判列出各自的判定 / 加权分 / 分维度 / 评语 / 失败主因，
 * 多裁判时再带 Pass/Fail 一致率。让用户看见聚合分背后每位裁判的真实判断
 * (黄金准则:读轨迹不可省,别只信聚合分)。提交前后共用一套渲染。
 */
function JudgeBreakdown({
  snaps,
  profiles,
  criteria,
  agreementRate,
  defaultOpen = false,
  live = false,
  expected,
  prompt,
  promptVersion,
  toolEvents,
  transcript,
}: {
  snaps: JudgeSnapshot[];
  profiles: AgentProfile[];
  criteria: JudgeCriteria;
  agreementRate?: number;
  defaultOpen?: boolean;
  /** 评判进行中:逐裁判增量显示,暂不展示聚合逻辑(尚不完整)。 */
  live?: boolean;
  /** 本轮预计裁判总数,用于「已评 N / 总数」进度。 */
  expected?: number;
  /** 发给所有裁判的评测 prompt(多裁判共用同一份),顶部折叠展示。 */
  prompt?: string;
  /** 本次实际使用的 llm-judge prompt 版本(Prompt 管理)。 */
  promptVersion?: number;
  /** 裁判看到的工具调用摘要(与喂裁判的 toolBlock 同源);展示在评判过程内。 */
  toolEvents?: ToolEventSummary[] | null;
  /** 被评回答的执行轨迹(给「查看完整轨迹」用)。 */
  transcript?: AgentTranscript;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const n = snaps.length || 1; // 防 0 除(live 首个裁判返回前 snaps 为空)
  const passCount = snaps.filter((s) => s.verdict === "passed").length;
  const multi = snaps.length >= 2;
  const done = !live; // 跑完才显示聚合逻辑footer
  const pending = live && expected != null && expected > snaps.length;
  // 一致率:多数票占比 = max(通过, 失败)/N。优先用已落库的值,否则按同一公式现算。
  const agreement =
    agreementRate ??
    (multi
      ? Math.round((Math.max(passCount, snaps.length - passCount) / n) * 100)
      : undefined);
  // 复刻 store 的聚合口径(runLLMJudge):每维度取均值并保留 1 位小数,
  // 加权初分 = Σ(维度均值 × 权重),判定 = 多数表决(平票判失败)。
  const agg = useMemo(() => {
    const dims = criteria.map((c) => {
      const mean =
        snaps.reduce(
          (sum, s) => sum + (s.scores.find((x) => x.key === c.key)?.value ?? 0),
          0,
        ) / (snaps.length || 1);
      return { key: c.key, label: c.label, weight: c.weight, value: Math.round(mean * 10) / 10 };
    });
    const weighted = dims.reduce(
      (sum, d) => sum + d.value * (d.weight ?? 1 / (dims.length || 1)),
      0,
    );
    return { dims, weighted };
  }, [snaps, criteria]);
  const aggVerdict: "passed" | "failed" =
    passCount > snaps.length / 2 ? "passed" : "failed";
  const AggIcon = VERDICT_META[aggVerdict].Icon;
  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:bg-secondary/40"
      >
        <Bot className="h-3.5 w-3.5" />
        <span className="text-foreground">评判过程</span>
        <Badge variant="muted" className="text-[10px]">
          {expected != null && live
            ? `${snaps.length} / ${expected} 位裁判`
            : `${snaps.length} 位裁判`}
        </Badge>
        {live && (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-accent">
            <Loader2 className="h-3 w-3 animate-spin" /> 评判中
          </span>
        )}
        {snaps.length > 0 && (
          <span className="font-mono text-[10.5px]">
            通过 {passCount}/{snaps.length}
          </span>
        )}
        {done && multi && agreement != null && (
          <Badge
            variant={agreement >= 85 ? "success" : "destructive"}
            className="text-[10px]"
            title="多裁判 Pass/Fail 一致率（≥85% 视为校准通过，§7.1.3）"
          >
            一致率 {agreement}%
          </Badge>
        )}
        <span className="ml-auto">
          {open ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {open && (
        <>
        {prompt && (
          <details className="border-t border-border text-[11px]">
            <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground">
              📋 评测 Prompt
              {snaps.length > 1 ? `（${snaps.length} 位裁判共用同一份）` : ""}
              {promptVersion != null && (
                <span className="ml-1.5 rounded bg-secondary px-1 py-px font-mono text-[10px]">
                  出自 LLM 判分 {promptVersion === 1 ? "内置默认 v1" : `v${promptVersion}`}
                </span>
              )}
            </summary>
            <div className="max-h-72 overflow-auto bg-background/60 px-3 py-2 leading-relaxed">
              <Markdown>{prompt}</Markdown>
            </div>
          </details>
        )}
        {toolEvents !== undefined && (
          <JudgeToolSummary toolEvents={toolEvents} transcript={transcript} />
        )}
        <ul className="divide-y divide-border border-t border-border">
          {snaps.map((s, i) => {
            const name =
              profiles.find((p) => p.id === s.judgeProfileId)?.name ??
              s.judgeProfileId;
            const w = weightedScore(s.scores, criteria);
            const VIcon = VERDICT_META[s.verdict].Icon;
            const tone = VERDICT_META[s.verdict].tone;
            return (
              <li key={i} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    #{i + 1}
                  </span>
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {name}
                  </span>
                  <VIcon className={cn("h-3.5 w-3.5", tone)} />
                  <span className={tone}>{VERDICT_META[s.verdict].label}</span>
                  {s.verdict === "failed" && s.failureCategory && (
                    <span
                      className="rounded border px-1.5 py-0.5 text-[10px]"
                      style={{
                        borderColor: FAILURE_CATEGORY_META[s.failureCategory].color,
                        color: FAILURE_CATEGORY_META[s.failureCategory].color,
                      }}
                      title={FAILURE_CATEGORY_META[s.failureCategory].fixHint}
                    >
                      {FAILURE_CATEGORY_META[s.failureCategory].label}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                    加权 {w.toFixed(2)}
                  </span>
                </div>
                {s.scores.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {s.scores.map((d) => (
                      <span key={d.key} className="inline-flex items-center gap-1">
                        {d.label}
                        <span className="font-mono tabular-nums text-foreground/80">
                          {d.value.toFixed(1)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                {s.notes && (
                  <p className="whitespace-pre-wrap break-words text-[12px] text-foreground/90">
                    {cleanJudgeNotes(s.notes)}
                  </p>
                )}
                {s.uncertaintySignals && s.uncertaintySignals.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-muted-foreground">不确定信号:</span>
                    {s.uncertaintySignals.map((sig, k) => (
                      <span
                        key={k}
                        className="rounded border px-1.5 py-0.5"
                        style={{
                          borderColor: UNCERTAINTY_META[sig.type].color,
                          color: UNCERTAINTY_META[sig.type].color,
                        }}
                        title={sig.quote}
                      >
                        {UNCERTAINTY_META[sig.type].label}
                        {" · "}
                        {sig.quote.length > 24 ? `${sig.quote.slice(0, 24)}…` : sig.quote}
                      </span>
                    ))}
                  </div>
                )}
                {s.raw && (
                  <details className="rounded-md border border-border bg-background/60 text-[11px]">
                    <summary className="cursor-pointer px-2 py-1 text-muted-foreground">
                      原始输出
                    </summary>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-border p-2 text-foreground/80">
                      {s.raw}
                    </pre>
                  </details>
                )}
              </li>
            );
          })}
          {/* live:首位裁判返回前的占位 + 还有裁判在评的等待行 */}
          {pending && (
            <li className="flex items-center gap-2 px-3 py-2.5 text-[11.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {snaps.length === 0
                ? "评判中,等待第一位裁判返回…"
                : `评判中,还有 ${(expected ?? snaps.length) - snaps.length} 位裁判待返回…`}
            </li>
          )}
        </ul>

        {/* 最后评分逻辑 — 逐裁判分如何聚合成最终分/判定。跑完(done)才显示,
            进行中聚合不完整不展示。 */}
        {done && snaps.length > 0 && (
        <div className="space-y-1.5 border-t border-border bg-muted/30 px-3 py-2.5 text-[11px]">
          <div className="font-medium text-foreground">最后评分逻辑</div>
          {multi ? (
            <>
              <div className="text-muted-foreground">
                各维度分 = {snaps.length} 位裁判该维度的<span className="text-foreground">均值</span>(保留 1 位小数):
              </div>
              <ul className="space-y-0.5">
                {agg.dims.map((d) => (
                  <li
                    key={d.key}
                    className="flex items-center gap-2 text-muted-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground/85">
                      {d.label}
                      {d.weight != null && (
                        <span className="ml-1 font-mono text-[10px]">
                          ×{d.weight.toFixed(2)}
                        </span>
                      )}
                    </span>
                    <span className="font-mono tabular-nums text-foreground">
                      {d.value.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="text-muted-foreground">
                加权初分 = Σ(维度均值 × 权重) ={" "}
                <span className="font-mono tabular-nums text-foreground">
                  {agg.weighted.toFixed(2)} / 10
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                判定 = 多数表决(通过 {passCount}/{snaps.length},平票判失败)→
                <AggIcon className={cn("h-3.5 w-3.5", VERDICT_META[aggVerdict].tone)} />
                <span className={VERDICT_META[aggVerdict].tone}>
                  {VERDICT_META[aggVerdict].label}
                </span>
              </div>
              {agreement != null && (
                <div className="text-muted-foreground">
                  一致率 = max(通过, 失败) / {snaps.length} ={" "}
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      agreement >= 85 ? "text-success" : "text-destructive",
                    )}
                  >
                    {agreement}%
                  </span>
                  (≥85% 视为校准通过)
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">
              单裁判:直接采用该裁判的维度分与判定,无聚合。
            </div>
          )}
          <div className="text-[10px] text-muted-foreground/80">
            以上为机器聚合的初评;最终提交分以表单为准,可经人工微调。
          </div>
        </div>
        )}
        </>
      )}
    </section>
  );
}

/* --------------------------- Result summary view --------------------------- */

const VERDICT_META: Record<
  Evaluation["verdict"],
  { label: string; tone: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  passed: { label: "通过", tone: "text-success", Icon: CheckCircle2 },
  failed: { label: "失败", tone: "text-destructive", Icon: XCircle },
};

export function ResultSummary({
  question,
  evals,
  profiles,
  onReevaluate,
}: {
  question: NonNullable<ReturnType<typeof useQAStore>["selectedQuestion"]>;
  evals: Evaluation[];
  profiles: AgentProfile[];
  onReevaluate?: () => void;
}) {
  const { floorElements } = useQAStore();
  // Group by subIndex to detect per-sub vs combined results.
  const isPerSub = evals.some((e) => typeof e.subIndex === "number");
  // Always show the latest submission for each (subIndex or combined) bucket.
  const latestByBucket = useMemo(() => {
    const map = new Map<string, Evaluation>();
    for (const e of evals) {
      const key = typeof e.subIndex === "number" ? `s${e.subIndex}` : "c";
      const existing = map.get(key);
      if (
        !existing ||
        new Date(e.submittedAt).getTime() > new Date(existing.submittedAt).getTime()
      ) {
        map.set(key, e);
      }
    }
    return [...map.values()].sort(
      (a, b) => (a.subIndex ?? 0) - (b.subIndex ?? 0),
    );
  }, [evals]);

  const headline = useMemo(() => {
    if (!isPerSub) {
      return latestByBucket[0] ?? null;
    }
    // Per-sub aggregate verdict + average score: 全部通过才算通过，任一失败即失败。
    const verdicts = latestByBucket.map((e) => e.verdict);
    const allPassed = verdicts.every((v) => v === "passed");
    const verdict: Evaluation["verdict"] = allPassed ? "passed" : "failed";
    const scoreSum = latestByBucket.reduce((s, e) => s + (e.autoScore ?? 0), 0);
    const score = latestByBucket.length > 0 ? scoreSum / latestByBucket.length : 0;
    return {
      verdict,
      autoScore: Number(score.toFixed(2)),
      submittedAt: latestByBucket[latestByBucket.length - 1]?.submittedAt,
    } as Pick<Evaluation, "verdict" | "autoScore" | "submittedAt">;
  }, [isPerSub, latestByBucket]);

  if (!headline) return null;
  const HeadIcon = VERDICT_META[headline.verdict].Icon;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ScrollArea className="-mx-1 flex-1">
        <div className="space-y-4 px-1 pb-3">
          {/* Headline */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="truncate font-medium text-foreground">
                    {question.title}
                  </span>
                </div>
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  已评测 ·{" "}
                  {headline.submittedAt
                    ? formatRelativeTime(headline.submittedAt)
                    : "—"}
                  {isPerSub && ` · 分步评分 ${latestByBucket.length} 步`}
                </p>
              </div>
              {onReevaluate && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  onClick={onReevaluate}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重新评测
                </Button>
              )}
            </div>
            <div className="flex items-center gap-4 rounded-md bg-muted/40 px-4 py-3">
              <HeadIcon
                className={cn(
                  "h-8 w-8 shrink-0",
                  VERDICT_META[headline.verdict].tone,
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "text-xl font-semibold",
                      VERDICT_META[headline.verdict].tone,
                    )}
                  >
                    {VERDICT_META[headline.verdict].label}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {headline.autoScore == null
                      ? "多 trial 试跑 · 只计通过率,不计分"
                      : isPerSub
                        ? "平均分"
                        : "加权得分"}
                  </span>
                </div>
                <div className="font-mono text-[32px] font-semibold leading-none text-foreground">
                  {headline.autoScore == null ? "—" : headline.autoScore.toFixed(2)}
                  {headline.autoScore != null && (
                    <span className="ml-1 text-[14px] font-normal text-muted-foreground">
                      / 10
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Per-sub / combined detail */}
          {latestByBucket.map((ev, idx) => {
            const Icon = VERDICT_META[ev.verdict].Icon;
            const tone = VERDICT_META[ev.verdict].tone;
            return (
              <section
                key={ev.id}
                className="rounded-lg border border-border bg-card"
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
                    {isPerSub && (
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        步骤 {idx + 1}
                      </span>
                    )}
                    <Icon className={cn("h-3.5 w-3.5", tone)} />
                    <span className={tone}>
                      {VERDICT_META[ev.verdict].label}
                    </span>
                    {ev.judgeProfileId ? (
                      <Badge
                        variant="accent"
                        className="h-4 gap-0.5 px-1 text-[9.5px]"
                        title="由 LLM 评分"
                      >
                        🤖 LLM
                      </Badge>
                    ) : (
                      <Badge
                        variant="muted"
                        className="h-4 gap-0.5 px-1 text-[9.5px]"
                        title={
                          ev.evaluator?.name
                            ? `由 ${ev.evaluator.name} 人工评分`
                            : "由人工评分"
                        }
                      >
                        🧑 人工
                        {ev.evaluator?.name && (
                          <span className="ml-0.5 font-medium">
                            {ev.evaluator.name}
                          </span>
                        )}
                      </Badge>
                    )}
                    {ev.calibrationSnapshots && ev.calibrationSnapshots.length >= 2 && (
                      <Badge
                        variant={
                          (ev.agreementRate ?? 0) >= 85
                            ? "success"
                            : "destructive"
                        }
                        className="h-4 gap-0.5 px-1 text-[9.5px]"
                        title={`${ev.calibrationSnapshots.length} 位裁判校准 · Pass/Fail 一致率 ${ev.agreementRate ?? 0}%（≥85% 通过）`}
                      >
                        校准 {ev.agreementRate ?? 0}%
                      </Badge>
                    )}
                    {ev.verdict === "failed" && ev.failureAttribution && (
                      <FailureAttributionBadge attribution={ev.failureAttribution} />
                    )}
                  </div>
                  {ev.autoScore != null ? (
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="text-muted-foreground">加权</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          ev.autoScore >= 8
                            ? "text-success"
                            : ev.autoScore >= 5
                              ? "text-foreground"
                              : "text-destructive",
                        )}
                      >
                        {ev.autoScore.toFixed(2)}
                      </span>
                    </div>
                  ) : (
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      试跑 · 不计分
                    </span>
                  )}
                </div>

                <div className="space-y-2.5 p-3">
                  {/* Score dimensions */}
                  {ev.scores.length > 0 && (
                    <div>
                      <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">
                        评分维度
                      </div>
                      <ul className="space-y-1">
                        {ev.scores.map((s) => {
                          const weight =
                            question.criteria.find((c) => c.key === s.key)
                              ?.weight ?? 0;
                          return (
                            <li
                              key={s.key}
                              className="flex items-center gap-2 text-[11.5px]"
                            >
                              <span className="min-w-0 flex-1 truncate text-foreground/85">
                                {s.label}
                                {weight > 0 && (
                                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                                    ×{weight.toFixed(2)}
                                  </span>
                                )}
                              </span>
                              {/* Visual bar */}
                              <div className="h-1.5 w-24 overflow-hidden rounded-sm bg-muted">
                                <div
                                  className={cn(
                                    "h-full",
                                    s.value >= 8
                                      ? "bg-success"
                                      : s.value >= 5
                                        ? "bg-foreground"
                                        : "bg-destructive",
                                  )}
                                  style={{
                                    width: `${(s.value / s.max) * 100}%`,
                                  }}
                                />
                              </div>
                              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                                {s.value.toFixed(2)} / {s.max}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Notes */}
                  {ev.notes && (
                    <div>
                      <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">
                        评语
                      </div>
                      <p className="whitespace-pre-wrap break-words text-[12px] text-foreground/90">
                        {cleanJudgeNotes(ev.notes)}
                      </p>
                    </div>
                  )}

                  {/* 不确定信号 — 单裁判兜底(多裁判已在下方 JudgeBreakdown 显示) */}
                  {(!ev.calibrationSnapshots || ev.calibrationSnapshots.length < 2) &&
                    ev.uncertaintySignals &&
                    ev.uncertaintySignals.length > 0 && (
                      <div>
                        <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">
                          不确定信号
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {ev.uncertaintySignals.map((sig, k) => (
                            <span
                              key={k}
                              className="rounded border px-1.5 py-0.5 text-[11px]"
                              style={{
                                borderColor: UNCERTAINTY_META[sig.type].color,
                                color: UNCERTAINTY_META[sig.type].color,
                              }}
                              title={sig.quote}
                            >
                              {UNCERTAINTY_META[sig.type].label}
                              {" · "}
                              {sig.quote.length > 24 ? `${sig.quote.slice(0, 24)}…` : sig.quote}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* 评测 Prompt — 单裁判兜底(多裁判在下方 JudgeBreakdown 顶部展示) */}
                  {(!ev.calibrationSnapshots || ev.calibrationSnapshots.length < 2) &&
                    ev.judgePrompt && (
                      <details className="rounded-md border border-border text-[11px]">
                        <summary className="cursor-pointer px-2 py-1 text-muted-foreground">
                          📋 评测 Prompt
                          {ev.judgePromptVersion != null && (
                            <span className="ml-1.5 rounded bg-secondary px-1 py-px font-mono text-[10px]">
                              出自 LLM 判分{" "}
                              {ev.judgePromptVersion === 1
                                ? "内置默认 v1"
                                : `v${ev.judgePromptVersion}`}
                            </span>
                          )}
                        </summary>
                        <div className="max-h-72 overflow-auto bg-background/60 p-2 leading-relaxed">
                          <Markdown>{ev.judgePrompt}</Markdown>
                        </div>
                      </details>
                    )}

                  {/* 依据条款 chip + 缺引用提醒 — 单/多裁判均渲染 */}
                  <JudgeCitation
                    question={question}
                    evaluation={ev}
                    floorElements={floorElements}
                  />

                  {/* 评判过程 — 多裁判校准时展开每位裁判各自的判定/打分/评语 */}
                  {ev.calibrationSnapshots &&
                    ev.calibrationSnapshots.length >= 2 && (
                      <JudgeBreakdown
                        snaps={ev.calibrationSnapshots}
                        profiles={profiles}
                        criteria={question.criteria}
                        agreementRate={ev.agreementRate}
                        prompt={ev.judgePrompt}
                        promptVersion={ev.judgePromptVersion}
                      />
                    )}

                  {/* Annotations */}
                  {ev.annotations && ev.annotations.length > 0 && (
                    <div>
                      <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">
                        标注 ({ev.annotations.length})
                      </div>
                      <ul className="space-y-1.5">
                        {ev.annotations.map((a) => (
                          <li
                            key={a.id}
                            className="rounded border-l-2 border-warning bg-warning/5 px-2 py-1 text-[11.5px]"
                          >
                            <div className="break-words text-foreground/85">
                              「{a.quote}」
                            </div>
                            {(a.label || a.note) && (
                              <div className="mt-0.5 text-muted-foreground">
                                {a.label && (
                                  <span className="mr-1.5 font-medium">
                                    [{a.label}]
                                  </span>
                                )}
                                {a.note}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

/* --------------------------- Trial (pass-rate) view --------------------------- */

/**
 * 多 trial 试跑题的「打分」视图:专测稳定性 → 只展示通过率 / pass^k,不计分、
 * 无评分表单。逐 trial 列出 verdict(LLM 批量评分 / 人工皆可),未评的标「未评」。
 */
function TrialResultSummary({
  question,
  messages,
  evals,
  passK,
}: {
  question: NonNullable<ReturnType<typeof useQAStore>["selectedQuestion"]>;
  messages: ChatMessage[];
  evals: Evaluation[];
  passK?: PassKSummary;
}) {
  // 试跑回答按 trialIndex 排序;每条回答取其最新一条评测。
  const trials = useMemo(
    () =>
      messages
        .filter((m) => m.trialIndex != null)
        .sort((a, b) => (a.trialIndex ?? 0) - (b.trialIndex ?? 0)),
    [messages],
  );
  const latestEvalByMsg = useMemo(() => {
    const map = new Map<string, Evaluation>();
    for (const e of evals) {
      const cur = map.get(e.messageId);
      if (!cur || new Date(e.submittedAt) > new Date(cur.submittedAt)) {
        map.set(e.messageId, e);
      }
    }
    return map;
  }, [evals]);

  const plannedK = Math.max(1, ...trials.map((m) => m.trialTotal ?? 1));
  const judged = trials.filter((m) => latestEvalByMsg.has(m.id));
  const passed = judged.filter(
    (m) => latestEvalByMsg.get(m.id)?.verdict === "passed",
  ).length;
  const rate = judged.length > 0 ? (passed / judged.length) * 100 : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ScrollArea className="-mx-1 flex-1">
        <div className="space-y-4 px-1 pb-3">
          {/* Headline:通过率,不是分数 */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="truncate font-medium text-foreground">
                    {question.title}
                  </span>
                  {passK && <PassKBadge summary={passK} />}
                </div>
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  多 trial 稳定性测试 · 共 {plannedK} 次试跑 · 只计通过率,不计分
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-md bg-muted/40 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    通过率(已评 {judged.length}/{trials.length})
                  </span>
                </div>
                <div className="font-mono text-[32px] font-semibold leading-none text-foreground">
                  {rate == null ? "—" : `${Math.round(rate)}%`}
                  <span className="ml-2 text-[14px] font-normal text-muted-foreground">
                    {passed} 过 / {judged.length - passed} 挂
                  </span>
                </div>
              </div>
            </div>
            {judged.length === 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                还没有评测 — 在「当前任务」用「批量 LLM 评分」对全部试跑判分。
              </p>
            )}
          </section>

          {/* 逐 trial verdict 列表 */}
          <section className="rounded-lg border border-border bg-card">
            <ul className="divide-y divide-border/60">
              {trials.map((m) => {
                const ev = latestEvalByMsg.get(m.id);
                const Icon = ev
                  ? VERDICT_META[ev.verdict].Icon
                  : HelpCircle;
                const tone = ev
                  ? VERDICT_META[ev.verdict].tone
                  : "text-muted-foreground";
                return (
                  <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-[12px]">
                    <span className="shrink-0 rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
                      第 {(m.trialIndex ?? 0) + 1} 轮
                    </span>
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", tone)} />
                    <span className={cn("shrink-0 font-medium", tone)}>
                      {ev ? VERDICT_META[ev.verdict].label : "未评"}
                    </span>
                    {ev?.judgeProfileId ? (
                      <Badge variant="accent" className="h-4 px-1 text-[9.5px]" title="由 LLM 评分">
                        🤖 LLM
                      </Badge>
                    ) : ev ? (
                      <Badge variant="muted" className="h-4 px-1 text-[9.5px]" title="由人工评分">
                        🧑 人工
                      </Badge>
                    ) : null}
                    {ev?.notes && (
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        {cleanJudgeNotes(ev.notes)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
