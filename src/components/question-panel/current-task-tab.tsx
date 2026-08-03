import {
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  Layers,
  Loader2,
  Pencil,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DifficultyBadge } from "@/components/status-indicator";
import { HistoryList } from "./history-list";
import {
  AttachmentList,
  AttachmentPicker,
} from "./attachment-list";
import {
  VariableForm,
  extractVariables,
  substituteVariables,
} from "./variable-form";
import { QuestionFormDialog } from "./question-form-dialog";
import { BulkQueueBar } from "./bulk-queue-bar";
import {
  SessionQuestionStrip,
  useSessionQuestionList,
} from "./session-question-strip";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { findStandardEmployee, ALL_EMPLOYEES_ID } from "@/lib/standard-employees";
import { isSkillQuestion } from "@/lib/skill-question";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types";
import { GroundTruthBadge } from "./ground-truth-badge";

/** ground-truth 徽章暂时下线(可恢复):置回 true 即恢复。 */
const SHOW_GROUND_TRUTH_BADGE: boolean = false;

/** 附件卡片 + 实际token/超时设置卡片已按需求下线(可恢复):置回 true 即恢复。 */
const SHOW_ATTACHMENTS_META: boolean = false;

/**
 * 「保存到题库」—— 普通流程里把当前这段**多轮对话**存为题库题(判据走 B 段自动补全),
 * **不依赖「自适应追问」开关**。仅在选中题已答 ≥2 轮时出现
 * (单轮手动问答已随手动输入自动入库,无需此按钮)。
 */
function SaveConvToLibraryButton() {
  const { saveQuestionToLibrary, selectedQuestion, selectedMessages } =
    useQAStore();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // 仅对"临时题"(手动对话,可评分但未入库)显示;已答 ≥1 轮即可手动保存。
  // 非临时题 = 已在题库,无需此按钮。不再有 ≥2 轮限制。
  if (!selectedQuestion?.transient || selectedMessages.length < 1) return null;

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    setDone(null);
    let msg: string;
    try {
      const r = await saveQuestionToLibrary(selectedQuestion.id);
      msg = r.ok ? "已保存到题库" : `失败:${r.reason}`;
    } catch (e) {
      msg = `失败:${(e as Error).message}`;
    } finally {
      setBusy(false);
    }
    setDone(msg);
    window.setTimeout(() => setDone(null), 2500);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 gap-1 px-2 text-[11px]"
      disabled={busy}
      onClick={() => void handleSave()}
      title="把当前这段对话保存为题库里的一道题(1 轮也能存;多轮自动补判据;不依赖自适应)"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Save className="h-3 w-3" />
      )}
      {busy ? "保存中…" : done ?? "保存到题库"}
    </Button>
  );
}

export function CurrentTaskTab() {
  const navigate = useNavigate();
  const {
    questions,
    selectedQuestionId,
    sendQuestion,
    isStreaming,
    updateQuestion,
    profiles,
    activeProfileId,
    resolveProfileForQuestion,
    selectedMessages,
    selection,
    setSelectedQuestion,
  } = useQAStore();

  // 「本会话题目」清单(合并进「题目」tab):本会话答过的题(最近作答在前),
  // 没有答过的就用当前选择;点一条 → 下面显示它的内容,默认展示最上面那一条。
  const sessionList = useSessionQuestionList(true);

  // 默认展示最上面的题:没点选任何题但有清单 → 自动选中第一条。
  useEffect(() => {
    if (selectedQuestionId) return;
    const top = sessionList[0]?.id;
    if (top) setSelectedQuestion(top);
  }, [selectedQuestionId, sessionList, setSelectedQuestion]);

  // Sum tokens across all assistant turns this question has produced in
  // the active conv. Undefined → no answer yet → render "—".
  const actualTokens = useMemo(() => {
    if (selectedMessages.length === 0) return undefined;
    let total = 0;
    let hasAny = false;
    for (const m of selectedMessages) {
      if (typeof m.tokens === "number") {
        total += m.tokens;
        hasAny = true;
      }
    }
    return hasAny ? total : undefined;
  }, [selectedMessages]);

  const [criteriaOpen, setCriteriaOpen] = useState(true);
  const [refOpen, setRefOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [sessionAttachments, setSessionAttachments] = useState<Attachment[]>(
    [],
  );
  const [editOpen, setEditOpen] = useState(false);

  // Library selection drives this view. Switching conversation auto-syncs
  // selectedQuestionId to that conv's active question (see switchConversation
  // in the store), so the right panel always reflects what the user is
  // looking at — without trapping them on a previously-run question.
  const question = useMemo(
    () => questions.find((q) => q.id === selectedQuestionId) ?? null,
    [questions, selectedQuestionId],
  );

  const detectedVars = useMemo(() => {
    if (!question) return [];
    const all = [
      question.prompt,
      ...(question.subPrompts ?? []),
    ].join("\n");
    return extractVariables(all);
  }, [question]);

  const turns = useMemo(() => {
    if (!question) return [];
    return [question.prompt, ...(question.subPrompts ?? [])];
  }, [question]);

  // Reset variables/attachments when switching question
  useEffect(() => {
    if (!question) return;
    setVariables(question.variableDefaults ?? {});
    setSessionAttachments([]);
  }, [question?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderedTurns = useMemo(
    () => turns.map((t) => substituteVariables(t, variables)),
    [turns, variables],
  );

  // 专属题(指定了具体员工)绑定的 agent(校验存在);非专属题 → null。
  const boundAgentForQuestion = useMemo<string | null>(() => {
    if (
      !question ||
      !question.targetEmployeeId ||
      question.targetEmployeeId === ALL_EMPLOYEES_ID
    ) {
      return null;
    }
    const allAgents = profiles
      .filter((p) => getProfileKind(p.providerId) === "agent")
      .map((p) => p.id);
    const bound = resolveProfileForQuestion(question);
    return bound && allAgents.includes(bound) ? bound : null;
  }, [question, profiles, resolveProfileForQuestion]);

  // 「发送给」选择器只列 agent-kind 的 profile（LLM 是裁判/出题工具,不能作为被测）。
  // **专属题**:仅当「当前激活 agent == 该员工绑定 agent」时才放它 —— 否则为空,
  // 发不了。杜绝「连着 Aria 却把 Sam 的题发出去 / 头部 Aria 聊天 Sam」的错位;
  // 要测某员工,先把左上的 active 切到它。
  const eligibleProfileIds = useMemo(() => {
    if (!question) return [];
    const allAgents = profiles
      .filter((p) => getProfileKind(p.providerId) === "agent")
      .map((p) => p.id);
    if (
      question.targetEmployeeId &&
      question.targetEmployeeId !== ALL_EMPLOYEES_ID
    ) {
      return boundAgentForQuestion && boundAgentForQuestion === activeProfileId
        ? [boundAgentForQuestion]
        : [];
    }
    return allAgents;
  }, [question, profiles, boundAgentForQuestion, activeProfileId]);

  const defaultProfileId = useMemo(
    () => (question ? resolveProfileForQuestion(question) : null),
    [question, resolveProfileForQuestion],
  );

  const [chosenProfileId, setChosenProfileId] = useState<string | null>(null);
  useEffect(() => {
    setChosenProfileId(defaultProfileId);
  }, [defaultProfileId]);

  // Empty state — guarded AFTER all hooks so toggling between null/non-null
  // question doesn't change hook count (React's hooks-must-be-called-in-the-
  // same-order rule). Right panel only shows here when bulk-selection /
  // queue state exists, so the BulkQueueBar alone suffices.
  if (!question) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 p-2">
        <BulkQueueBar />
      </div>
    );
  }

  const unfilledVars = detectedVars.filter((v) => !variables[v]?.trim());

  const targetProfileId = chosenProfileId ?? defaultProfileId;
  const targetProfile = profiles.find((p) => p.id === targetProfileId);

  // 技能题只用于 Skill 评测,不能发给 agent(即使经「去首页答题」选中也禁发)。
  const isSkill = question ? isSkillQuestion(question) : false;
  const canSend =
    !isStreaming &&
    !isSkill &&
    unfilledVars.length === 0 &&
    !!targetProfileId &&
    eligibleProfileIds.includes(targetProfileId);
  const isMultiTurn = turns.length > 1;

  const handleSend = () => {
    if (!targetProfileId) return;
    sendQuestion(
      {
        ...question,
        prompt: renderedTurns[0],
        subPrompts: renderedTurns.slice(1),
      },
      targetProfileId,
    );
  };

  const handleSendToAll = () => {
    if (eligibleProfileIds.length === 0) return;
    // Run this question against every eligible agent (use bulk queue).
    // We do this by calling sendQuestion for the first, then the bulk queue
    // mechanism is not directly used here — instead we add the question id
    // to a synthetic queue. Simplest: route through sendQuestion sequentially
    // via the queue mechanism.
  };
  void handleSendToAll;

  const persistedAttachments = question.attachments ?? [];

  const handleRemovePersistedAttachment = (id: string) => {
    updateQuestion(question.id, {
      attachments: persistedAttachments.filter((a) => a.id !== id),
    });
  };

  const handleAddPersistedAttachment = (a: Attachment) => {
    updateQuestion(question.id, {
      attachments: [...persistedAttachments, a],
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <BulkQueueBar embeddedWithComposer />
      {/* 本会话题目清单(并入「题目」tab):没有选择待运行时显示已答题,点一条切换下面内容 */}
      {selection.size === 0 && <SessionQuestionStrip fallbackToSelection />}
      <ScrollArea className="-mx-1 flex-1">
        <div className="space-y-4 px-1 pb-4">
          {/* Header */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <DifficultyBadge value={question.difficulty} />
              {SHOW_GROUND_TRUTH_BADGE && question.groundTruthChecks?.length ? (
                <GroundTruthBadge
                  kinds={question.groundTruthChecks.map((c) => c.kind)}
                />
              ) : null}
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {(Array.isArray(question.categories)
                  ? question.categories
                  : []
                ).map((c) => (
                  <Badge key={c} variant="muted" className="text-[10px]">
                    {c}
                  </Badge>
                ))}
              </div>
              <SaveConvToLibraryButton />
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6"
                onClick={() => setEditOpen(true)}
                aria-label="编辑题目"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
            <h2 className="text-balance text-[17px] font-semibold leading-snug text-foreground">
              {question.title}
            </h2>
          </div>

          {/* Prompt(s) — markdown rendered, numbered for multi-turn */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>
                题目内容
                {isMultiTurn && (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10.5px] text-accent">
                    多轮 · {turns.length} 步
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2 font-mono text-[10.5px]">
                {detectedVars.length > 0 && (
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">
                    {detectedVars.length} 个变量
                  </span>
                )}
                <span>
                  {turns.reduce((sum, t) => sum + t.length, 0)} 字符
                </span>
              </div>
            </div>
            {isMultiTurn ? (
              <ol className="divide-y divide-border">
                {renderedTurns.map((t, i) => (
                  <li key={i} className="px-3 py-2.5">
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[10.5px] font-semibold text-background">
                        {i + 1}
                      </span>
                      <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                        第 {i + 1} 步
                      </span>
                    </div>
                    <Markdown>{t}</Markdown>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="px-3 py-2.5">
                <Markdown>{renderedTurns[0]}</Markdown>
              </div>
            )}
          </section>

          {/* Variables */}
          {detectedVars.length > 0 && (
            <VariableForm
              variables={detectedVars}
              values={variables}
              onChange={setVariables}
            />
          )}

          {/* 附件 + 实际token/超时设置 卡片已按需求下线(SHOW_ATTACHMENTS_META 置回 true 即恢复) */}
          {SHOW_ATTACHMENTS_META && (
            <>
              <section className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>附件</span>
                  <AttachmentPicker onAdd={handleAddPersistedAttachment} />
                </div>
                <div className="p-3">
                  <AttachmentList
                    attachments={persistedAttachments}
                    onRemove={handleRemovePersistedAttachment}
                    emptyHint="还没有附件，点右上「添加附件」上传图片或文件"
                  />
                  <p className="mt-2 text-[10.5px] text-muted-foreground">
                    注：附件目前仅在 UI 显示，需后端接入后才会真正传给 Agent
                  </p>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-2">
                <MetaItem
                  icon={<Layers className="h-3 w-3" />}
                  label="实际 token"
                  value={
                    actualTokens != null
                      ? actualTokens.toLocaleString()
                      : "—"
                  }
                />
                <MetaItem
                  icon={<Clock className="h-3 w-3" />}
                  label="超时设置"
                  value={
                    question.timeoutMs ? `${question.timeoutMs / 1000}s` : "无"
                  }
                />
              </section>
            </>
          )}

          {/* Reference answer */}
          {question.referenceAnswer && (
            <Collapsible
              title="标准答案"
              open={refOpen}
              onToggle={() => setRefOpen((v) => !v)}
            >
              <Markdown>{question.referenceAnswer}</Markdown>
            </Collapsible>
          )}

          {/* Scoring criteria */}
          <Collapsible
            title="评分标准"
            open={criteriaOpen}
            onToggle={() => setCriteriaOpen((v) => !v)}
          >
            <ul className="space-y-2">
              {question.criteria.map((c) => (
                <li
                  key={c.key}
                  className="flex items-start gap-2 text-[13px]"
                >
                  <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">
                        {c.label}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        权重 {(c.weight * 100).toFixed(0)}%
                      </span>
                    </div>
                    {c.description && (
                      <p className="text-[12px] text-muted-foreground">
                        {c.description}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Collapsible>

          {/* History */}
          <Collapsible
            title={
              <span className="inline-flex items-center gap-1.5">
                <History className="h-3 w-3" /> 历史评测
              </span>
            }
            open={historyOpen}
            onToggle={() => setHistoryOpen((v) => !v)}
          >
            <HistoryList questionId={question.id} />
          </Collapsible>

          {sessionAttachments.length > 0 && (
            <p className="text-[10.5px] text-muted-foreground">
              本次会话临时附件：{sessionAttachments.length} 个
            </p>
          )}
        </div>
      </ScrollArea>

      <Separator className="-mx-4" />

      {/* Agent picker (shown when multiple eligible) */}
      {eligibleProfileIds.length > 1 && (
        <div className="flex items-center gap-1.5 pt-2.5 text-[11px] text-muted-foreground">
          <span>发送给：</span>
          <div className="flex flex-wrap gap-1">
            {eligibleProfileIds.map((pid) => {
              const p = profiles.find((pp) => pp.id === pid);
              if (!p) return null;
              const sel = pid === targetProfileId;
              return (
                <button
                  key={pid}
                  type="button"
                  onClick={() => setChosenProfileId(pid)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors",
                    sel
                      ? "border-foreground/30 bg-foreground text-background"
                      : "border-border bg-card text-foreground hover:bg-secondary",
                  )}
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 专属题提示:只能在「该员工绑定的 agent」就是当前激活 agent 时才发送 */}
      {question.targetEmployeeId &&
        question.targetEmployeeId !== ALL_EMPLOYEES_ID &&
        (() => {
          const empName =
            findStandardEmployee(question.targetEmployeeId)?.name ??
            question.targetEmployeeId;
          if (!boundAgentForQuestion) {
            return (
              <p className="pt-2 text-[11px] text-warning">
                ⚠️ 专属题:仅「{empName}」可作答,但它还没绑定 agent。请先在「标准员工 / Agent 管理」绑定后再发。
              </p>
            );
          }
          if (boundAgentForQuestion !== activeProfileId) {
            const boundName =
              profiles.find((p) => p.id === boundAgentForQuestion)?.name ??
              empName;
            return (
              <p className="pt-2 text-[11px] text-warning">
                ⚠️ 这道题指定由「{empName}」({boundName})作答 —— 不能发给别的 agent。请先在左上把当前 agent 切换到「{empName}」再发。
              </p>
            );
          }
          // 一切正常(绑定 agent 即当前激活 agent)→ 不提示,保持界面干净。
          return null;
        })()}

      {/* CTA */}
      <div className="flex shrink-0 items-center gap-2 pt-2">
        <Button
          variant="outline"
          size="lg"
          className="flex-1"
          disabled={isStreaming}
          onClick={() => navigate("/library")}
        >
          换一道
        </Button>
        <Button
          variant="default"
          size="lg"
          className="flex-[2]"
          disabled={!canSend}
          onClick={handleSend}
          title={
            isSkill
              ? "技能题只用于 Skill 评测,不能发给 Agent"
              : !targetProfileId
                ? "请先设置一个 Agent profile"
                : unfilledVars.length > 0
                  ? `请先填写变量：${unfilledVars.join(", ")}`
                  : undefined
          }
        >
          {isStreaming ? (
            <>
              <Sparkles className="animate-pulse" /> Agent 思考中...
            </>
          ) : isSkill ? (
            <>技能题不可发送</>
          ) : !targetProfileId ? (
            <>未配置 Agent</>
          ) : unfilledVars.length > 0 ? (
            <>
              <Send /> 填写 {unfilledVars.length} 个变量后发送
            </>
          ) : (
            <>
              <Send />
              发送给 {targetProfile?.name ?? "Agent"}
            </>
          )}
        </Button>
      </div>
      {/* unused var to keep activeProfileId in deps without affecting build */}
      <span className="hidden">{activeProfileId}</span>

      <QuestionFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        question={question}
      />
    </div>
  );
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[13px] font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

function Collapsible({
  title,
  open,
  onToggle,
  children,
}: {
  title: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span>{title}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>
      <div
        className={cn(
          "overflow-hidden border-t border-border transition-[max-height,opacity] duration-200",
          open ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <div className="p-3">{children}</div>
      </div>
    </section>
  );
}
