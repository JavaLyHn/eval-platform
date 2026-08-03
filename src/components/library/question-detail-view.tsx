/**
 * Shared question-detail body used by both the right-side Sheet and the
 * full-screen /library/:id page. All data is derived from useQAStore:
 *
 *   - basic info & Pass/Fail definitions   ← from the Question itself
 *   - scoring criteria                     ← q.criteria
 *   - test history                         ← scan conversations.messages where
 *                                            user message's questionId === q.id,
 *                                            pair with following assistant
 */

import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Edit3, ExternalLink, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DifficultyBadge } from "@/components/status-indicator";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { Markdown } from "@/components/ui/markdown";
import { Paperclip, Users } from "lucide-react";
import { AttachmentList } from "@/components/question-panel/attachment-list";
import { useQAStore } from "@/hooks/use-qa-store";
import { isSkillQuestion } from "@/lib/skill-question";
import { AXIS_TAG_PREFIX } from "@/lib/gen-dimensions";
import { cn } from "@/lib/utils";
import {
  ALL_EMPLOYEES_ID,
  ALL_EMPLOYEES_LABEL,
} from "@/lib/standard-employees";
import type { ChatMessage, Question, QuestionSeverity, SampleIntent } from "@/types";

/** agent 意图:中文标签 + 红绿蓝配色(与 skill 题库 / 列表意图徽标同一套色)。 */
const INTENT_META: Record<SampleIntent, { label: string; cls: string }> = {
  typical: { label: "典型", cls: "border-emerald-500/40 text-emerald-600 dark:text-emerald-300" },
  boundary: { label: "边界", cls: "border-sky-500/40 text-sky-600 dark:text-sky-300" },
  anomaly: { label: "异常", cls: "border-rose-500/40 text-rose-600 dark:text-rose-400" },
};

interface Props {
  question: Question;
  onEdit?: (q: Question) => void;
  onDelete?: (q: Question) => void;
  /** Called after the user opts to go answer at home (after we've put the
   * question into a fresh conversation's selection + navigated). Useful for the
   * Sheet to close itself. The view always performs the setup + navigate. */
  onStartInWorkspace?: () => void;
  /** Hide all internal actions (e.g. /library/:id renders its own header). */
  hideActions?: boolean;
  /** Hide just the "去首页答题" button — callers that surface it in their
   *  own header (e.g. the Sheet) pass this to avoid duplication. */
  hidePrimaryAction?: boolean;
}

export function QuestionDetailView({
  question,
  onEdit,
  onDelete,
  onStartInWorkspace,
  hideActions,
  hidePrimaryAction,
}: Props) {
  const navigate = useNavigate();
  const {
    conversations,
    standardEmployees,
    newConversation,
    setSelectionForConv,
    setRightTab,
  } = useQAStore();

  // 去首页答题:与题库列表「去首页答题」完全同源 —— 建/切到新会话,把题塞进它的 selection,
  // 落到「当前任务」tab,再跳首页(在首页点「批量运行」开始作答)。
  const goHomeAnswer = () => {
    const convId = newConversation();
    setSelectionForConv(convId, [question.id]);
    setRightTab("current");
    onStartInWorkspace?.();
    navigate("/");
  };
  const employee = standardEmployees.find((e) => e.id === question.targetEmployeeId);

  /* ----- derive test history -------------------------------------------- */

  const history = useMemo(() => {
    const out: Array<{
      conversationId: string;
      conversationTitle: string;
      userMessage: ChatMessage;
      assistantMessage: ChatMessage | null;
    }> = [];
    for (const conv of conversations) {
      const msgs = conv.messages ?? [];
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (m.role !== "user" || m.questionId !== question.id) continue;
        // Find the next assistant message in the same conversation
        const next = msgs.slice(i + 1).find((x) => x.role === "assistant");
        out.push({
          conversationId: conv.id,
          conversationTitle: conv.title,
          userMessage: m,
          assistantMessage: next ?? null,
        });
      }
    }
    // newest first
    out.sort(
      (a, b) =>
        new Date(b.userMessage.createdAt).getTime() -
        new Date(a.userMessage.createdAt).getTime(),
    );
    return out;
  }, [conversations, question.id]);

  /* ---------------------------------------------------------------------- */

  const isSkill = isSkillQuestion(question);
  // agent 题的出题场景:存在 question.tags 里(cellTags 写入 `场景:xxx`),非 categories(那个等于员工、重复)。
  const scenario = (() => {
    const prefix = `${AXIS_TAG_PREFIX.scenario}:`;
    const t = (Array.isArray(question.tags) ? question.tags : []).find((x) =>
      x.startsWith(prefix),
    );
    return t ? t.slice(prefix.length) : undefined;
  })();
  const intentMeta = question.intent ? INTENT_META[question.intent] : undefined;

  return (
    <div className="flex flex-col gap-5 p-5 text-[13px]">
      {/* 基本信息 */}
      <Section title="基本信息">
        <Grid>
          {/* 员工(归属)固定在最上方;仅显示头像 + 名字 */}
          <Field label="员工">
            {question.targetEmployeeId === ALL_EMPLOYEES_ID ? (
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4 text-foreground/70" />
                <span>{ALL_EMPLOYEES_LABEL}</span>
              </span>
            ) : employee ? (
              <span className="inline-flex items-center gap-1.5">
                <EmployeeAvatar employee={employee} size={18} />
                <span>{employee.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">未指定</span>
            )}
          </Field>
          <Field label="题号">
            <span className="font-mono text-[12px] text-foreground/85">
              {question.number}
            </span>
          </Field>
          {/* 场景:agent 题独立成行(label + value),与「严重度」一致;skill 题不显示 */}
          {!isSkill && scenario && (
            <Field label="场景">
              <span className="inline-block w-fit max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground/85">
                {scenario}
              </span>
            </Field>
          )}
          {/* skill 题:原样保留独立「技能」字段 */}
          {isSkill && question.targetSkill && (
            <Field label="技能">
              <span className="w-fit rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-foreground/85">
                {question.targetSkill}
              </span>
            </Field>
          )}
          {/* 分类:skill 用「技能」、agent 等于员工重复 → 详情页一律不显示 */}
          {/* 严重度 / 意图:agent 题专用;skill 题判分用 caseType(见「机检约束」),这里不显示 */}
          {!isSkill && (
            <Field label="严重度">
              {question.severity ? (
                <SeverityBadge severity={question.severity} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Field>
          )}
          {/* 难度:skill 题恒 medium、对 SkillOpt 无意义,不显示 */}
          {!isSkill && (
            <Field label="难度">
              <DifficultyBadge value={question.difficulty} />
            </Field>
          )}
          {!isSkill && (
            <Field label="意图">
              {intentMeta ? (
                <span className={cn("w-fit rounded border px-1.5 py-0.5 text-[11px]", intentMeta.cls)}>
                  {intentMeta.label}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Field>
          )}
          <Field label="创建时间">
            <span className="text-muted-foreground">
              {new Date(question.createdAt).toLocaleString()}
            </span>
          </Field>
        </Grid>
      </Section>

      {/* 机检约束(skill 题 · SkillOpt 确定性判分):铺开必含/禁现词表 + 题型金标 */}
      {isSkill && question.skilloptCase && (
        <Section title="机检约束(SkillOpt 确定性判分)">
          <SkillConstraints sc={question.skilloptCase} />
        </Section>
      )}

      {/* 题目主体 */}
      <Section title="题目主体">
        <div className="rounded-md border border-border bg-muted/30 p-3 text-[12.5px] leading-relaxed">
          <Markdown>{question.prompt}</Markdown>
        </div>
        {question.subPrompts && question.subPrompts.length > 0 && (
          <ol className="mt-2 space-y-2">
            {question.subPrompts.map((s, i) => (
              <li
                key={i}
                className="rounded-md border border-border/50 bg-muted/20 p-2.5 text-[12.5px]"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
                    {i + 2}
                  </span>
                  <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    第 {i + 2} 步
                  </span>
                </div>
                <Markdown>{s}</Markdown>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* 附件:题目自带的图片 / 文本文件(答题时随 prompt 一起发给 agent)。可点开预览。 */}
      {question.attachments && question.attachments.length > 0 && (
        <Section
          title={
            <span className="inline-flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              附件 ({question.attachments.length})
            </span>
          }
        >
          <AttachmentList attachments={question.attachments} />
        </Section>
      )}

      {/* Pass / Fail 双向 —— agent 题(LLM-judge 线)专用;skill 题走确定性判分,不需要 */}
      {!isSkill && (
      <Section title="Pass / Fail 双向定义">
        <div className="space-y-2">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              ✓ Pass 形态
            </div>
            {question.passForm ? (
              <div className="text-[12.5px]">
                <Markdown>{question.passForm}</Markdown>
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">未填</p>
            )}
          </div>
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">
              ✗ Fail 形态
            </div>
            {question.failForm ? (
              <div className="text-[12.5px]">
                <Markdown>{question.failForm}</Markdown>
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">未填</p>
            )}
          </div>
        </div>
      </Section>
      )}

      {/* 评分维度 —— agent 题(LLM-judge 线)专用;skill 题走确定性判分,不需要 */}
      {!isSkill && question.criteria.length > 0 && (
        <Section title={`评分维度 (${question.criteria.length})`}>
          <ul className="space-y-1.5">
            {question.criteria.map((c) => (
              <li
                key={c.key}
                className="flex items-start justify-between gap-3 rounded-md border border-border/50 bg-muted/20 p-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">{c.label}</div>
                  {c.description && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {c.description}
                    </div>
                  )}
                </div>
                <Badge variant="muted" className="shrink-0 tabular-nums">
                  {(c.weight * 100).toFixed(1)}%
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 测试历史:agent 题展示;skill 题走 SkillOpt 跑批,不在此显示 */}
      {!isSkill && (
      <Section
        title={`测试历史 (${history.length} 次)`}
        empty={history.length === 0 ? "尚无测试记录" : undefined}
      >
        {history.length > 0 && (
          <ol className="space-y-1.5">
            {history.slice(0, 20).map((h, i) => (
              <li
                key={`${h.conversationId}-${h.userMessage.id}`}
                className="flex items-start justify-between gap-3 rounded-md border border-border/50 bg-muted/20 p-2 text-[12px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{new Date(h.userMessage.createdAt).toLocaleString()}</span>
                    <span className="text-border">·</span>
                    <span>
                      会话{" "}
                      <span className="font-medium text-foreground">
                        {h.conversationTitle || h.conversationId.slice(0, 8)}
                      </span>
                    </span>
                    {h.assistantMessage?.modelVersion && (
                      <>
                        <span className="text-border">·</span>
                        <span>{h.assistantMessage.modelVersion}</span>
                      </>
                    )}
                  </div>
                  {h.assistantMessage && (
                    <p className="mt-0.5 line-clamp-2 text-[12px]">
                      {h.assistantMessage.interrupted && (
                        <span className="mr-1 rounded bg-rose-500/15 px-1 text-[10px] text-rose-600 dark:text-rose-400">
                          中断
                        </span>
                      )}
                      {h.assistantMessage.content.slice(0, 200)}
                    </p>
                  )}
                </div>
                <Badge variant="muted" className="shrink-0">
                  #{history.length - i}
                </Badge>
              </li>
            ))}
            {history.length > 20 && (
              <li className="px-2 text-[11px] text-muted-foreground">
                还有 {history.length - 20} 条历史…
              </li>
            )}
          </ol>
        )}
      </Section>
      )}

      {!hideActions && (
        <>
          <Separator />
          <div className="flex flex-wrap items-center gap-2">
            {!hidePrimaryAction && (
              <Button
                size="sm"
                variant="default"
                className="gap-1"
                onClick={goHomeAnswer}
              >
                去首页答题 <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
            {onEdit && (
              <Button size="sm" variant="outline" className="gap-1" onClick={() => onEdit(question)}>
                <Edit3 className="h-3.5 w-3.5" /> 编辑
              </Button>
            )}
            <Link
              to={`/library/${encodeURIComponent(question.id)}`}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-[12px] hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" /> 全屏查看
            </Link>
            {onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto gap-1 text-destructive hover:text-destructive"
                onClick={() => onDelete(question)}
              >
                <Trash2 className="h-3.5 w-3.5" /> 删除
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Section({
  title,
  children,
  empty,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  empty?: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {empty ? (
        <p className="rounded-md border border-dashed border-border/50 p-3 text-center text-[11px] text-muted-foreground">
          {empty}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">{children}</dl>;
}

const CASE_TYPE_META: Record<
  NonNullable<Question["skilloptCase"]>["caseType"],
  { label: string; cls: string }
> = {
  acceptAny: { label: "正常任务题", cls: "border-emerald-500/40 text-emerald-600 dark:text-emerald-300" },
  interception: { label: "红线 / 越界(应拦截)", cls: "border-rose-500/40 text-rose-600 dark:text-rose-400" },
  standard: { label: "意图分类题", cls: "border-violet-500/40 text-violet-600 dark:text-violet-300" },
};

/** 一组判分词表(必含 / 禁现)→ 彩色 chip;空则显示「无」。 */
function ConstraintChips({
  label,
  words,
  tone,
}: {
  label: string;
  words: string[];
  tone: "ok" | "bad";
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {words.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {words.map((w, i) => (
            <span
              key={i}
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[11px]",
                tone === "ok"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-rose-500/10 text-rose-700 dark:text-rose-400",
              )}
            >
              {w}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-[11px] text-muted-foreground">无</div>
      )}
    </div>
  );
}

/** skill 题的确定性判分明细:题型金标 + 必含/禁现词表(acceptAny)/ 意图金标(standard)。 */
function SkillConstraints({ sc }: { sc: NonNullable<Question["skilloptCase"]> }) {
  const e = sc.expected ?? {};
  const meta = CASE_TYPE_META[sc.caseType];
  return (
    <div className="space-y-2.5 rounded-md border border-border/50 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">题型</span>
        <span className={cn("rounded border px-1.5 py-0.5 text-[11px]", meta.cls)}>{meta.label}</span>
        {e.language && <Badge variant="muted" className="text-[10px]">语言:{e.language}</Badge>}
        {sc.caseType === "standard" && e.intentType && (
          <Badge variant="muted" className="text-[10px]">意图金标:{e.intentType}</Badge>
        )}
        {sc.caseType === "standard" && e.requiresClarification && (
          <Badge variant="muted" className="text-[10px]">应先追问</Badge>
        )}
      </div>
      {sc.caseType === "acceptAny" && (
        <>
          <ConstraintChips label="必含(mustInclude · 须出现)" words={e.mustInclude ?? []} tone="ok" />
          <ConstraintChips label="禁现(mustExclude · 不得出现)" words={e.mustExclude ?? []} tone="bad" />
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            判分器逐条机判(子串、大小写不敏感):答案须含每个必含词、不得含任一禁现词;得分 = 满足条数 / 总条数。
          </p>
        </>
      )}
      {sc.caseType === "interception" && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          安全探针:期望 agent 在政策层面拒绝 / 拦截(intercepted=true),不泄露、不越权。
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px]">{children}</dd>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: QuestionSeverity }) {
  const cls: Record<QuestionSeverity, string> = {
    P0: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    P1: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    P2: "bg-muted/40 text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium",
        cls[severity],
      )}
    >
      {severity}
    </span>
  );
}
