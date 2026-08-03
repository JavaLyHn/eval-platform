/**
 * Right side of the workspace (/) — contextual to the current chat.
 * Three tabs: 当前任务 / 打分 / 结果.
 *   - 打分:单题人工打分 + 批量答题完成后的「要不要批量打分」引导。
 *   - 结果:批量 LLM 评分的实时进度 + 本批结果(与「打分」分开,避免冲突)。
 *
 * Legacy values for `rightTab` (library / dashboard / skills / employees) are
 * intercepted and redirected to dedicated routes so any persisted UI state
 * from earlier versions still resolves cleanly.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, ChevronsRight, ClipboardCheck, ClipboardList, Eye, FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CurrentTaskTab } from "./current-task-tab";
import { EvaluationTab } from "./evaluation-tab";
import { BatchJudgeLiveView } from "./batch-judge-live";
import { BatchAnswerScorePrompt } from "./batch-answer-score-prompt";
import { BatchResultsDialog } from "./batch-results-dialog";
import { SessionQuestionStrip } from "./session-question-strip";
import { AdaptiveFollowupPanel } from "./adaptive-followup-panel";
import { FilePreviewTab } from "./file-preview-tab";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";
import type { RightTab } from "@/types";

const LEGACY_ROUTES: Partial<Record<RightTab, string>> = {
  library: "/library",
  employees: "/employees",
  dashboard: "/dashboard",
  skills: "/skills",
};

export function QuestionPanel({ hideCollapse = false }: { hideCollapse?: boolean } = {}) {
  const navigate = useNavigate();
  const {
    rightTab,
    setRightTab,
    isQuestionInProgressHere,
    selectedQuestion,
    setSelectedQuestion,
    selectedMessages,
    judgeQueue,
    activeConversationId,
    lastBatchJudge,
    queue,
    evaluations,
    testedInActiveConv,
    adaptiveEnabled,
    previewFile,
    setRightPanelCollapsed,
  } = useQAStore();
  const [batchResultsOpen, setBatchResultsOpen] = useState(false);

  // 本会话有批量评分:进行中 / 刚结束(瞬态 judgeQueue),或有持久的本批结果指针。
  const liveBatch =
    judgeQueue.conversationId === activeConversationId &&
    (judgeQueue.running ||
      judgeQueue.completed.length > 0 ||
      judgeQueue.errored.length > 0);
  const persistedBatch =
    !!lastBatchJudge && lastBatchJudge.conversationId === activeConversationId;

  // 选中题在「结果」里有可看内容:① 已有单题评测;② 多 trial 题(已答→有通过率)。
  // trial 与否看**最新一条回答**(历史 trial 残留不算)。
  const selectedIsTrial =
    selectedMessages.length > 0 &&
    selectedMessages[selectedMessages.length - 1].trialIndex != null;
  const selectedHasEval =
    !!selectedQuestion &&
    selectedMessages.some((m) =>
      evaluations.some(
        (e) => e.questionId === selectedQuestion.id && e.messageId === m.id,
      ),
    );
  // 批量评分(实时/持久)是 batch 结果;此外单题评测 / 多 trial 也进「结果」tab。
  const batchResults = liveBatch || persistedBatch;
  // 本会话答过的题里有评测结果 → 结果 tab 可用(顶部清单可切换查看各题结果)。
  const convHasEval = evaluations.some((e) =>
    testedInActiveConv.has(e.questionId),
  );
  const resultsActive =
    batchResults ||
    selectedHasEval ||
    convHasEval ||
    (selectedIsTrial && selectedMessages.length > 0);
  // 批量评分**运行中**才显示实时进度视图;结束后切回「清单 + 单题结果」。
  const judgeRunningHere =
    judgeQueue.running && judgeQueue.conversationId === activeConversationId;

  // 自适应追问只在本会话「有题在执行 / 答过题」时才出现——新建的空会话不显示
  // (即使全局开关开着)。有内容 = 答过题 / 选中题已有回答 / 有题在执行 / 批量在本会话跑。
  const adaptiveHasContext =
    testedInActiveConv.size > 0 ||
    selectedMessages.length > 0 ||
    isQuestionInProgressHere ||
    (queue.running && queue.conversationId === activeConversationId);

  // Heal legacy stored values that no longer live here(自适应 tab 关掉 / 无内容时回 current)。
  useEffect(() => {
    const ok =
      rightTab === "current" ||
      rightTab === "evaluation" ||
      rightTab === "results" ||
      (rightTab === "preview" && !!previewFile) ||
      (rightTab === "adaptive" && adaptiveEnabled && adaptiveHasContext);
    if (!ok) setRightTab("current" as RightTab);
  }, [rightTab, setRightTab, adaptiveEnabled, adaptiveHasContext, previewFile]);

  const lastAnswer =
    selectedMessages.length > 0
      ? selectedMessages[selectedMessages.length - 1]
      : null;
  const evalReady =
    !!selectedQuestion &&
    !!lastAnswer &&
    !lastAnswer.interrupted &&
    !isQuestionInProgressHere;

  // 批量答题刚完成(还没开始批量评分)→ 打分 tab 显示「要不要批量打分」引导面板。
  // 批量完成时 store 已自动把 rightTab 切到 evaluation。
  // 只有 ≥2 道题才走批量引导;只有 1 道题没必要「批量」,直接走单题打分。
  // 且只在这批题所属的 run 会话里显示 —— 切到别的会话不能再看到这批的完成引导。
  const queueHere = queue.conversationId === activeConversationId;
  const completedQuestionCount = new Set(
    queue.completed.map((it) => it.questionId),
  ).size;
  const answerBatchDone =
    !queue.running && queueHere && completedQuestionCount >= 2 && !resultsActive;

  // 选中 tab 兜底:打分 / 结果 tab 没内容时别停在它上面(否则会出现「去答题却落在打分空页」)。
  // 本会话有答过的题就能进打分 tab(顶部清单可切换要打分的题)。
  const evalTabEnabled =
    evalReady || answerBatchDone || testedInActiveConv.size > 0;
  const safeTab: "current" | "evaluation" | "results" | "adaptive" | "preview" =
    rightTab === "preview" && previewFile
      ? "preview"
      : rightTab === "evaluation" && evalTabEnabled
        ? "evaluation"
        : rightTab === "results" && resultsActive
          ? "results"
          : rightTab === "adaptive" && adaptiveEnabled
            ? "adaptive"
            : "current";

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-surface/40"
      aria-label="当前任务与打分"
    >
      <Tabs
        value={safeTab}
        onValueChange={(v) => {
          const route = LEGACY_ROUTES[v as RightTab];
          if (route) {
            navigate(route);
            return;
          }
          setRightTab(v as RightTab);
        }}
        className="flex h-full min-h-0 min-w-0 flex-col"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
          <TabsList className="h-9 min-w-0">
            <TabsTrigger value="current">
              <FileText className="h-3.5 w-3.5" />
              <span className="truncate">题目</span>
            </TabsTrigger>
            <TabsTrigger value="evaluation" disabled={!evalTabEnabled}>
              <ClipboardCheck className="h-3.5 w-3.5" />
              <span className="truncate">打分</span>
              {evalTabEnabled && (
                <span
                  className={cn(
                    "ml-1 h-1.5 w-1.5 rounded-full bg-accent",
                    answerBatchDone && "animate-pulse",
                  )}
                />
              )}
            </TabsTrigger>
            <TabsTrigger value="results" disabled={!resultsActive}>
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="truncate">结果</span>
              {resultsActive && (
                <span
                  className={cn(
                    "ml-1 h-1.5 w-1.5 rounded-full bg-accent",
                    judgeQueue.running && "animate-pulse",
                  )}
                />
              )}
            </TabsTrigger>
            {/* 自适应追问 tab:头部开关开启 + 本会话有内容(执行中/答过题)才出现 */}
            {adaptiveEnabled && adaptiveHasContext && (
              <TabsTrigger value="adaptive">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="truncate">自适应</span>
              </TabsTrigger>
            )}
            {previewFile && (
              <TabsTrigger value="preview">
                <Eye className="h-3.5 w-3.5" />
                <span className="truncate">预览</span>
              </TabsTrigger>
            )}
          </TabsList>
          {!hideCollapse && (
            <button
              type="button"
              onClick={() => setRightPanelCollapsed(true)}
              aria-label="折叠面板"
              title="折叠右侧面板"
              className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 min-w-0 overflow-hidden p-4">
          <TabsContent value="current" className="h-full min-w-0 data-[state=inactive]:hidden mt-0">
            <CurrentTaskTab />
          </TabsContent>
          <TabsContent value="evaluation" className="h-full min-w-0 data-[state=inactive]:hidden mt-0">
            {answerBatchDone ? (
              <BatchAnswerScorePrompt />
            ) : (
              <div className="flex h-full min-h-0 flex-col gap-2">
                {/* 顶部:本会话题目清单 —— 点一条切换下面要打分的题(留在打分 tab) */}
                <SessionQuestionStrip
                  title="选择要打分的题"
                  onPick={(id) => {
                    setSelectedQuestion(id);
                    setRightTab("evaluation" as RightTab);
                  }}
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <EvaluationTab surface="score" />
                </div>
              </div>
            )}
          </TabsContent>
          <TabsContent value="results" className="h-full min-w-0 data-[state=inactive]:hidden mt-0">
            {judgeRunningHere ? (
              <BatchJudgeLiveView />
            ) : (
              <div className="flex h-full min-h-0 flex-col gap-2">
                {/* 顶部:本会话题目清单 —— 点一条查看对应结果(留在结果 tab) */}
                <SessionQuestionStrip
                  title="选择要查看结果的题"
                  onPick={(id) => {
                    setSelectedQuestion(id);
                    setRightTab("results" as RightTab);
                  }}
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <EvaluationTab surface="result" />
                </div>
                {persistedBatch && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => setBatchResultsOpen(true)}
                  >
                    <ClipboardList className="h-3.5 w-3.5" /> 查看本批完整结果
                  </Button>
                )}
              </div>
            )}
          </TabsContent>
          {adaptiveEnabled && adaptiveHasContext && (
            <TabsContent value="adaptive" className="h-full min-w-0 data-[state=inactive]:hidden mt-0">
              <div className="flex h-full min-h-0 flex-col gap-2">
                <SessionQuestionStrip
                  title="选择要追问的题"
                  onPick={(id) => {
                    setSelectedQuestion(id);
                    setRightTab("adaptive" as RightTab);
                  }}
                />
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {selectedQuestion && selectedMessages.length > 0 ? (
                    <AdaptiveFollowupPanel question={selectedQuestion} />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                      <Sparkles className="h-5 w-5 text-muted-foreground" />
                      <p className="text-sm font-medium text-foreground">先选一道已答过的题</p>
                      <p className="max-w-xs text-xs text-muted-foreground">
                        上面选一道本会话答过的题(或先去答一道),就能据 agent 的回答继续追问。
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          )}
          {previewFile && (
            <TabsContent value="preview" className="h-full min-w-0 data-[state=inactive]:hidden mt-0">
              <FilePreviewTab />
            </TabsContent>
          )}
        </div>
      </Tabs>
      <BatchResultsDialog
        open={batchResultsOpen}
        onOpenChange={setBatchResultsOpen}
      />
    </section>
  );
}
