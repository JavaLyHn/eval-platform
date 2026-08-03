import { Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useQAStore,
  type QuestionDraft,
} from "@/hooks/use-qa-store";
import { AxisSelect } from "./axis-select";
import { AttachmentPicker, AttachmentList } from "./attachment-list";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { Users } from "lucide-react";
import type {
  Attachment,
  Category,
  Difficulty,
  FloorElement,
  Question,
  QuestionSeverity,
  SampleIntent,
  ScoringCriterion,
} from "@/types";
import {
  ALL_EMPLOYEES_ID,
  ALL_EMPLOYEES_LABEL,
  STANDARD_EMPLOYEES,
} from "@/lib/standard-employees";
import { GATEWAY_EMPLOYEES } from "@/lib/extended-employees";
import {
  resolveQuestionType,
  TYPE_CRITERIA,
  QUESTION_TYPE_META,
} from "@/lib/question-type";
import { isSkillQuestion } from "@/lib/skill-question";

function slugifyKey(label: string): string {
  const trimmed = label.trim().toLowerCase();
  const ascii = trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return ascii || `crit-${Math.random().toString(36).slice(2, 7)}`;
}

function ensureUniqueKey(base: string, used: Set<string>): string {
  let key = base;
  let i = 2;
  while (used.has(key)) key = `${base}-${i++}`;
  used.add(key);
  return key;
}

/**
 * Normalize criterion weights so they sum to 1. Empty / all-zero input falls
 * back to equal weights. Returns a NEW array.
 */
function normalizeCriteria(criteria: ScoringCriterion[]): ScoringCriterion[] {
  if (criteria.length === 0) return criteria;
  const sum = criteria.reduce((s, c) => s + Math.max(0, c.weight || 0), 0);
  if (sum === 0) {
    const w = 1 / criteria.length;
    return criteria.map((c) => ({ ...c, weight: w }));
  }
  return criteria.map((c) => ({
    ...c,
    weight: Math.max(0, c.weight || 0) / sum,
  }));
}

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "简单" },
  { value: "medium", label: "中等" },
  { value: "hard", label: "困难" },
];

interface QuestionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question?: Question; // when editing
}

/** 行业分类暂时下线;恢复时改回 true(数据模型与已存 industry 不受影响)。 */
const SHOW_INDUSTRY_FIELD: boolean = false;

const blankDraft = (criteria: ScoringCriterion[]): QuestionDraft => ({
  title: "",
  prompt: "",
  subPrompts: [],
  scoringMode: "combined",
  categories: ["营销策略"],
  difficulty: "medium",
  tags: [],
  referenceAnswer: "",
  agentIds: [],
  criteria: criteria.map((c) => ({ ...c })),
});

export function QuestionFormDialog({
  open,
  onOpenChange,
  question,
}: QuestionFormDialogProps) {
  const {
    addQuestion,
    updateQuestion,
    categories,
    addCategory,
    deleteCategory,
    questions: allQuestions,
    defaultCriteria,
    setDefaultCriteria,
    resetDefaultCriteria,
    floorElements,
    genDimensions,
    addGenDimension,
    configuredEmployeeIds,
  } = useQAStore();

  // 目标员工可选项 = 已配置的标准线 + Gateway 扩展员工(如 Dex)。
  // Gateway 员工始终可选(与导入弹窗 / 出题弹窗一致);否则给 Dex 题会在此下拉里
  // 找不到对应项、显示空(即便题上确实带着 targetEmployeeId=dex)。
  const configuredEmployees = useMemo(
    () => [
      ...STANDARD_EMPLOYEES.filter((e) => configuredEmployeeIds.includes(e.id)),
      ...GATEWAY_EMPLOYEES,
    ],
    [configuredEmployeeIds],
  );
  const isEdit = !!question;
  // skill 题(接 SkillOpt 确定性判分)→ 隐藏 agent/LLM-judge 专用字段(Pass/Fail、judge 提示、
  // 严重度、样本意图、超范围、红线下限要素、超时/token);判分用的 caseType+约束在 skilloptCase 里(编辑保存 merge 保留)。
  const isSkill = !!question && isSkillQuestion(question);

  const [draft, setDraft] = useState<QuestionDraft>(() =>
    blankDraft(defaultCriteria),
  );
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);

  // skill 题:目标员工固定(随 skill 归属,不可改),只读显示在标题行末尾,不再放底部选择器。
  const skillEmp =
    isSkill && draft.targetEmployeeId
      ? [...STANDARD_EMPLOYEES, ...GATEWAY_EMPLOYEES].find(
          (e) => e.id === draft.targetEmployeeId,
        )
      : undefined;

  useEffect(() => {
    if (open) {
      if (question) {
        setDraft({
          title: question.title,
          prompt: question.prompt,
          subPrompts: question.subPrompts ?? [],
          scoringMode: question.scoringMode ?? "combined",
          categories:
            Array.isArray(question.categories) && question.categories.length > 0
              ? [...question.categories]
              : ["营销策略"],
          difficulty: question.difficulty,
          tags: question.tags,
          referenceAnswer: question.referenceAnswer ?? "",
          agentIds: question.agentIds ?? [],
          criteria: question.criteria,
          expectedTokens: question.expectedTokens,
          timeoutMs: question.timeoutMs,
          // P0-3 standardization fields
          passForm: question.passForm,
          failForm: question.failForm,
          outOfScope: question.outOfScope,
          hasGroundTruth: question.hasGroundTruth,
          severity: question.severity,
          intent: question.intent,
          industry: question.industry,
          targetEmployeeId: question.targetEmployeeId,
          floorElementIds: question.floorElementIds ?? [],
          judgeFocus: question.judgeFocus,
          attachments: question.attachments ?? [],
        });
      } else {
        setDraft(blankDraft(defaultCriteria));
      }
    }
  }, [open, question]);

  const handleSubmit = () => {
    const cleanSubs = (draft.subPrompts ?? [])
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    // 落盘前清掉不属于当前目标员工的红线/下限要素 ID(切换目标员工后可能残留),
    // 避免 orphan ID 误导题型判定(code-quality review Minor)。
    const cleanFloorIds = (draft.floorElementIds ?? []).filter((fid) =>
      floorElements.some(
        (f) =>
          f.id === fid &&
          (!draft.targetEmployeeId ||
            draft.targetEmployeeId === ALL_EMPLOYEES_ID ||
            f.employeeId === draft.targetEmployeeId),
      ),
    );
    const payload = {
      ...draft,
      subPrompts: cleanSubs.length > 0 ? cleanSubs : undefined,
      criteria: normalizeCriteria(draft.criteria),
      floorElementIds: cleanFloorIds.length > 0 ? cleanFloorIds : undefined,
      attachments:
        (draft.attachments ?? []).length > 0 ? draft.attachments : undefined,
    };
    if (isEdit && question) {
      updateQuestion(question.id, payload);
    } else {
      addQuestion(payload);
    }
    onOpenChange(false);
  };

  const addSubPrompt = () => {
    setDraft({ ...draft, subPrompts: [...(draft.subPrompts ?? []), ""] });
  };

  const removeSubPrompt = (i: number) => {
    setDraft({
      ...draft,
      subPrompts: (draft.subPrompts ?? []).filter((_, idx) => idx !== i),
    });
  };

  const updateSubPrompt = (i: number, value: string) => {
    setDraft({
      ...draft,
      subPrompts: (draft.subPrompts ?? []).map((s, idx) => (idx === i ? value : s)),
    });
  };

  const subPrompts = draft.subPrompts ?? [];
  const isMultiTurn = subPrompts.length > 0;

  const canSubmit = draft.title.trim() && draft.prompt.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-3 overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-5 pt-5">
          <DialogTitle className="flex items-center gap-2 pr-6">
            <span>{isEdit ? "编辑题目" : "新建题目"}</span>
            {skillEmp && (
              <span
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2 py-0.5 text-[12px] font-normal text-foreground"
                title="该 skill 题归属员工(固定,不可更改)"
              >
                <EmployeeAvatar employee={skillEmp} size={16} />
                {skillEmp.name}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "修改后所有依赖该题的评测仍会保留历史记录"
              : "题号会自动分配；提交后立即可在题库中使用"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5">
          <Field label="标题" required>
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="一句话描述题目"
              autoFocus
            />
          </Field>

          {/* 分类 + 难度:skill 题不需要(归属看 技能、难度对 SkillOpt 无意义),隐藏 */}
          {!isSkill && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="分类" hint="可多选">
              <CategoryMultiPicker
                allCategories={categories}
                selected={draft.categories}
                onChange={(next) => setDraft({ ...draft, categories: next })}
                onAddNew={(name) => {
                  addCategory(name);
                  if (!draft.categories.includes(name)) {
                    setDraft((d) => ({ ...d, categories: [...d.categories, name] }));
                  }
                }}
                onDelete={(name) => {
                  deleteCategory(name);
                  if (draft.categories.includes(name)) {
                    setDraft((d) => {
                      const remaining = d.categories.filter((c) => c !== name);
                      const fallback =
                        categories.find((c) => c !== name) ?? "未分类";
                      return {
                        ...d,
                        categories: remaining.length > 0 ? remaining : [fallback],
                      };
                    });
                  }
                }}
                showNewInput={showNewCategory}
                newCategoryInput={newCategoryInput}
                setShowNewInput={setShowNewCategory}
                setNewCategoryInput={setNewCategoryInput}
                allQuestions={allQuestions}
              />
            </Field>
            <Field label="难度">
              <Select
                value={draft.difficulty}
                onValueChange={(v) =>
                  setDraft({ ...draft, difficulty: v as Difficulty })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTIES.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          )}

          <Field
            label={isMultiTurn ? "第 1 步内容（prompt）" : "题目内容（prompt）"}
            required
          >
            <Textarea
              value={draft.prompt}
              onChange={(e) =>
                setDraft({ ...draft, prompt: e.target.value })
              }
              placeholder="完整的题目描述，支持 Markdown"
              rows={isMultiTurn ? 4 : 6}
              className="font-mono text-[13px]"
            />
          </Field>

          {/* Sub-prompts (multi-turn):skill 题是单轮,隐藏 */}
          {!isSkill && (
          <div className="space-y-2 rounded-lg border border-border bg-card/40 p-2.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                子问题（多轮串发）
                {isMultiTurn && (
                  <span className="ml-1 font-mono text-[10px] font-normal">
                    · 共 {subPrompts.length + 1} 步
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px]"
                onClick={addSubPrompt}
              >
                <Plus className="h-3 w-3" /> 添加一步
              </Button>
            </div>
            {subPrompts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                单轮题目。需要追问 / 多步对话时点上方按钮添加。
              </p>
            ) : (
              <ul className="space-y-2">
                {subPrompts.map((sp, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[10.5px] font-semibold text-background">
                      {i + 2}
                    </span>
                    <Textarea
                      value={sp}
                      onChange={(e) => updateSubPrompt(i, e.target.value)}
                      placeholder={`第 ${i + 2} 步追问内容`}
                      rows={3}
                      className="flex-1 font-mono text-[13px]"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="mt-1.5"
                      onClick={() => removeSubPrompt(i)}
                      aria-label="移除这一步"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

          </div>
          )}

          <Field label="标准答案（可选）">
            <Textarea
              value={draft.referenceAnswer ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, referenceAnswer: e.target.value })
              }
              placeholder="参考答案或关键得分点"
              rows={3}
              className="text-[13px]"
            />
          </Field>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              附件（随题发送给 agent）
            </label>
            <div className="flex items-center gap-2">
              <AttachmentPicker
                onAdd={(a: Attachment) =>
                  setDraft((d) => ({
                    ...d,
                    attachments: [...(d.attachments ?? []), a],
                  }))
                }
              />
            </div>
            <AttachmentList
              attachments={draft.attachments ?? []}
              onRemove={(id) =>
                setDraft((d) => ({
                  ...d,
                  attachments: (d.attachments ?? []).filter(
                    (a) => a.id !== id,
                  ),
                }))
              }
              emptyHint="可加文本文件 / 图片，运行本题时随题面一起发送。"
            />
          </div>

          {/* 评分维度:agent(LLM-judge)专用;skill 题走确定性判分,隐藏 */}
          {!isSkill && (
          <CriteriaEditor
            criteria={draft.criteria}
            onChange={(criteria) => setDraft({ ...draft, criteria })}
            onSaveAsDefault={() => setDefaultCriteria(draft.criteria)}
            onLoadDefault={() =>
              setDraft({
                ...draft,
                criteria: defaultCriteria.map((c) => ({ ...c })),
              })
            }
            onResetDefault={resetDefaultCriteria}
            onResetByType={() => {
              const isRedLineSel = (draft.floorElementIds ?? []).some((fid) =>
                floorElements.some(
                  (f) =>
                    f.id === fid &&
                    f.isRedLine &&
                    (!draft.targetEmployeeId ||
                      draft.targetEmployeeId === ALL_EMPLOYEES_ID ||
                      f.employeeId === draft.targetEmployeeId),
                ),
              );
              const t = resolveQuestionType(
                { outOfScope: draft.outOfScope, hasGroundTruth: draft.hasGroundTruth },
                isRedLineSel,
              );
              if (
                window.confirm(
                  `将把当前评分维度覆盖为「${QUESTION_TYPE_META[t].label}」的题型维度集，确定？`,
                )
              ) {
                setDraft({ ...draft, criteria: TYPE_CRITERIA[t].map((c) => ({ ...c })) });
              }
            }}
          />
          )}

          {/* P0-3 标准化字段（评测标准 §5 / §6 / §7）—— skill 题不需要,归属固定显示在标题行 */}
          {!isSkill && (
          <section className="space-y-3 rounded-lg border border-border bg-card/40 p-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-semibold text-foreground">
                {isSkill ? "归属" : "标准化字段"}
              </span>
              {!isSkill && (
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  评测标准 §5 / §6 / §7
                </span>
              )}
            </div>

            {/* Pass/Fail 形态 + judge 提示:agent(LLM-judge)专用;skill 走确定性判分,隐藏 */}
            {!isSkill && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Pass 形态"
                hint="做到什么算成功（§5 双向定义）"
              >
                <Textarea
                  value={draft.passForm ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, passForm: e.target.value })
                  }
                  placeholder="例：完整给出三大财报关键指标 + 现金跑道测算"
                  rows={2}
                  className="text-[12.5px]"
                />
              </Field>
              <Field
                label="Fail 形态"
                hint="出现什么反例就不算成功"
              >
                <Textarea
                  value={draft.failForm ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, failForm: e.target.value })
                  }
                  placeholder="例：脏数据被一句话放弃；多 sheet 漏看"
                  rows={2}
                  className="text-[12.5px]"
                />
              </Field>
            </div>
            )}

            {!isSkill && (
            <Field
              label="评测重点提示（给 judge 的额外叮嘱，可空）"
            >
              <Textarea
                value={draft.judgeFocus ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, judgeFocus: e.target.value })
                }
                placeholder="例：特别注意是否越权/是否泄露他人信息"
                rows={2}
                className="text-[12.5px]"
              />
            </Field>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <Field label="目标员工">
                <Select
                  value={draft.targetEmployeeId ?? "_none_"}
                  onValueChange={(v) =>
                    setDraft({
                      ...draft,
                      targetEmployeeId: v === "_none_" ? undefined : v,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-[12.5px]">
                    <SelectValue placeholder="— 未指定 —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none_">— 未指定 —</SelectItem>
                    <SelectItem value={ALL_EMPLOYEES_ID}>
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        {ALL_EMPLOYEES_LABEL}
                      </span>
                    </SelectItem>
                    {configuredEmployees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <EmployeeAvatar employee={e} size={16} />
                          {e.name}
                        </span>
                      </SelectItem>
                    ))}
                    {configuredEmployees.length === 0 && (
                      <div className="px-2 py-1 text-[10px] text-muted-foreground">
                        还没配置 agent,先去「员工」里关联
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </Field>
              {/* 严重度 / 样本意图:agent 专用;skill 题判分用 caseType,隐藏 */}
              {!isSkill && (
              <Field label="严重度">
                <select
                  value={draft.severity ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      severity:
                        (e.target.value as QuestionSeverity) || undefined,
                    })
                  }
                  className="h-9 w-full rounded-md border border-border bg-card px-2 text-[12.5px]"
                >
                  <option value="">— 未指定 —</option>
                  <option value="P0">P0 — 影响核心</option>
                  <option value="P1">P1 — 影响差异化</option>
                  <option value="P2">P2 — 细节 / 外层</option>
                </select>
              </Field>
              )}
              {!isSkill && (
              <Field label="样本意图">
                <select
                  value={draft.intent ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      intent: (e.target.value as SampleIntent) || undefined,
                    })
                  }
                  className="h-9 w-full rounded-md border border-border bg-card px-2 text-[12.5px]"
                >
                  <option value="">— 未指定 —</option>
                  <option value="typical">typical 典型</option>
                  <option value="boundary">boundary 临近边界</option>
                  <option value="anomaly">anomaly 异常输入</option>
                </select>
              </Field>
              )}
              {/* 行业分类暂时下线(Question.industry 数据保留;恢复时把开关改回 true) */}
              {SHOW_INDUSTRY_FIELD && (question?.kind ?? "agent") === "agent" && (
                <Field label="行业（可选）">
                  <AxisSelect
                    label=""
                    options={genDimensions.industries.map((v) => ({ value: v, label: v }))}
                    selected={draft.industry ? [draft.industry] : []}
                    onChange={(next) =>
                      setDraft({ ...draft, industry: next[0] || undefined })
                    }
                    onAddNew={(v) => addGenDimension("industries", v)}
                    placeholder="— 未指定 —"
                  />
                </Field>
              )}
            </div>

            {!isSkill && (
            <div className="flex flex-wrap gap-4 text-[12.5px]">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!!draft.outOfScope}
                  onChange={(e) =>
                    setDraft({ ...draft, outOfScope: e.target.checked })
                  }
                />
                <span className="font-medium">超范围任务</span>
                <span className="text-muted-foreground">
                  期望员工触发拒答 / 反问 / 升级
                </span>
              </label>
              {/* 「有客观正确答案」勾选暂时下线(可恢复):删掉 false && 即恢复 */}
              {false && (
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!draft.hasGroundTruth}
                    onChange={(e) =>
                      setDraft({ ...draft, hasGroundTruth: e.target.checked })
                    }
                  />
                  <span className="font-medium">有客观正确答案</span>
                  <span className="text-muted-foreground">
                    judge agent 可全自动判错
                  </span>
                </label>
              )}
            </div>
            )}

            {/* 红线 / 下限要素关联:agent/保下限专用;skill 题隐藏 */}
            {!isSkill && (
            <FloorElementPicker
              floorElements={floorElements}
              targetEmployeeId={draft.targetEmployeeId}
              selected={draft.floorElementIds ?? []}
              onChange={(ids) => setDraft({ ...draft, floorElementIds: ids })}
            />
            )}

          </section>
          )}

          {/* 超时 / 预期 token:agent 评测线设置;skill 题走 SkillOpt,隐藏 */}
          {!isSkill && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="超时（秒，可选）">
              <Input
                type="number"
                min={0}
                step={1}
                value={draft.timeoutMs != null ? draft.timeoutMs / 1000 : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft({
                    ...draft,
                    timeoutMs: v ? Math.round(Number(v) * 1000) : undefined,
                  });
                }}
                placeholder="30"
              />
            </Field>
            <Field label="预期 token 区间（可选）">
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={draft.expectedTokens?.min ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      expectedTokens: {
                        min: Number(e.target.value) || 0,
                        max: draft.expectedTokens?.max ?? 0,
                      },
                    })
                  }
                  placeholder="min"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="number"
                  value={draft.expectedTokens?.max ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      expectedTokens: {
                        min: draft.expectedTokens?.min ?? 0,
                        max: Number(e.target.value) || 0,
                      },
                    })
                  }
                  placeholder="max"
                />
              </div>
            </Field>
          </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-card px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="default"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isEdit ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryMultiPicker({
  allCategories,
  selected,
  onChange,
  onAddNew,
  onDelete,
  showNewInput,
  newCategoryInput,
  setShowNewInput,
  setNewCategoryInput,
  allQuestions,
}: {
  allCategories: Category[];
  selected: Category[];
  onChange: (next: Category[]) => void;
  onAddNew: (name: string) => void;
  onDelete: (name: string) => void;
  showNewInput: boolean;
  newCategoryInput: string;
  setShowNewInput: (v: boolean) => void;
  setNewCategoryInput: (v: string) => void;
  allQuestions: { categories: Category[] }[];
}) {
  const toggle = (name: string) => {
    if (selected.includes(name)) {
      const next = selected.filter((c) => c !== name);
      // Don't allow clearing the last one — questions should always belong to ≥1 category.
      onChange(next.length > 0 ? next : selected);
    } else {
      onChange([...selected, name]);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 min-h-[2.25rem]">
        {selected.length === 0 ? (
          <span className="text-[12px] text-muted-foreground/70">未选择分类</span>
        ) : (
          selected.map((c) => (
            <Badge
              key={c}
              variant="muted"
              className="h-5 gap-1 pl-1.5 pr-1 text-[11px]"
            >
              {c}
              <button
                type="button"
                onClick={() => toggle(c)}
                className="rounded-sm p-0.5 hover:bg-foreground/10"
                aria-label={`移除 ${c}`}
                disabled={selected.length === 1}
                title={selected.length === 1 ? "至少保留一个分类" : "移除"}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))
        )}
      </div>

      {showNewInput ? (
        <div className="flex gap-1">
          <Input
            value={newCategoryInput}
            onChange={(e) => setNewCategoryInput(e.target.value)}
            onKeyDown={(e) => {
              // 输入法组字中(选中文候选词)按 Enter/Esc 交给 IME,别当成提交/取消。
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") {
                e.preventDefault();
                const name = newCategoryInput.trim();
                if (name) {
                  onAddNew(name);
                  setShowNewInput(false);
                  setNewCategoryInput("");
                }
              } else if (e.key === "Escape") {
                setShowNewInput(false);
                setNewCategoryInput("");
              }
            }}
            placeholder="新分类名称"
            autoFocus
            className="h-8 flex-1 text-[12px]"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 px-2 text-[11px]"
            onClick={() => {
              const name = newCategoryInput.trim();
              if (!name) return;
              onAddNew(name);
              setShowNewInput(false);
              setNewCategoryInput("");
            }}
          >
            确定
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-[11px]"
            onClick={() => {
              setShowNewInput(false);
              setNewCategoryInput("");
            }}
          >
            取消
          </Button>
        </div>
      ) : (
        <div className="flex gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 flex-1 justify-start text-[12px] font-normal text-muted-foreground"
              >
                添加分类…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {allCategories.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c}
                  checked={selected.includes(c)}
                  onCheckedChange={() => toggle(c)}
                  // Keep menu open so the user can toggle multiple in a row.
                  onSelect={(e) => e.preventDefault()}
                >
                  {c}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setShowNewInput(true)}
                className="text-accent"
              >
                + 新建分类…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <CategoryManagerPopover
            categories={allCategories}
            selected={selected}
            allQuestions={allQuestions}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
}

function CategoryManagerPopover({
  categories,
  selected,
  allQuestions,
  onDelete,
}: {
  categories: Category[];
  selected: Category[];
  allQuestions: { categories: Category[] }[];
  onDelete: (name: string) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const usedCounts = new Map<string, number>();
  for (const q of allQuestions) {
    if (!Array.isArray(q.categories)) continue;
    for (const c of q.categories) {
      usedCounts.set(c, (usedCounts.get(c) ?? 0) + 1);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-9 w-9 shrink-0"
          title="管理分类"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-2"
        onCloseAutoFocus={() => setConfirm(null)}
      >
        <div className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">
          管理分类 · 删除将把对应题目移到首个剩余分类
        </div>
        {categories.length === 0 ? (
          <p className="px-1 py-3 text-center text-[12px] text-muted-foreground">
            暂无分类
          </p>
        ) : (
          <ul className="space-y-0.5">
            {categories.map((c) => {
              const count = usedCounts.get(c) ?? 0;
              const isConfirming = confirm === c;
              const isActive = selected.includes(c);
              return (
                <li
                  key={c}
                  className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-secondary/60"
                >
                  <span className="flex-1 truncate text-[12.5px] text-foreground">
                    {c}
                    {isActive && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        · 已选
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {count} 道
                  </span>
                  {isConfirming ? (
                    <>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="h-6 px-1.5 text-[10.5px]"
                        onClick={() => {
                          onDelete(c);
                          setConfirm(null);
                        }}
                      >
                        确认删除
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[10.5px]"
                        onClick={() => setConfirm(null)}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirm(c)}
                      title={
                        count > 0
                          ? `删除「${c}」（${count} 道题将被重新归类）`
                          : `删除「${c}」`
                      }
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CriteriaEditor({
  criteria,
  onChange,
  onSaveAsDefault,
  onLoadDefault,
  onResetDefault,
  onResetByType,
}: {
  criteria: ScoringCriterion[];
  onChange: (next: ScoringCriterion[]) => void;
  onSaveAsDefault: () => void;
  onLoadDefault: () => void;
  onResetDefault: () => void;
  onResetByType: () => void;
}) {
  const sumPct = criteria.reduce(
    (s, c) => s + Math.max(0, c.weight || 0) * 100,
    0,
  );
  // 5% tolerance — the editor saves normalized weights anyway.
  const balanced = Math.abs(sumPct - 100) < 5;

  const updateAt = (i: number, patch: Partial<ScoringCriterion>) => {
    onChange(
      criteria.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  };
  const removeAt = (i: number) => {
    onChange(criteria.filter((_, idx) => idx !== i));
  };
  const addOne = () => {
    const used = new Set(criteria.map((c) => c.key));
    const key = ensureUniqueKey("custom", used);
    onChange([
      ...criteria,
      { key, label: "", weight: 0, description: "" },
    ]);
  };
  const distributeEqually = () => {
    if (criteria.length === 0) return;
    const w = 1 / criteria.length;
    onChange(criteria.map((c) => ({ ...c, weight: w })));
  };
  const normalizeNow = () => {
    onChange(normalizeCriteria(criteria));
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/40 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="text-xs font-medium text-muted-foreground">
          评分维度与权重
          <span className="ml-1 font-normal text-muted-foreground/70">
            提交时会自动归一化为 100%
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px]"
            onClick={distributeEqually}
            disabled={criteria.length === 0}
            title="将所有维度权重设为相等"
          >
            平均分配
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px]"
            onClick={normalizeNow}
            disabled={criteria.length === 0}
            title="按当前比例归一化到 100%"
          >
            归一化
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px]"
                title="默认评分维度"
              >
                <Settings2 className="h-3 w-3" />
                默认
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 text-[12px]">
              <DropdownMenuItem onSelect={onLoadDefault}>
                套用当前默认到本题
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onSaveAsDefault}>
                把本题维度存为默认
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={onResetDefault}
                className="text-destructive"
              >
                恢复内置默认（仅默认值）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px]"
            onClick={onResetByType}
            title="根据题型(红线/超范围/客观题/能力题)覆盖当前维度集"
          >
            <RefreshCw className="h-3 w-3" /> 按题型重置维度
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px]"
            onClick={addOne}
          >
            <Plus className="h-3 w-3" /> 添加维度
          </Button>
        </div>
      </div>

      {criteria.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          至少添加一个评分维度，否则将无法在「评测」面板打分。
        </p>
      ) : (
        <ul className="space-y-1.5">
          {criteria.map((c, i) => (
            <li
              key={c.key}
              className="grid grid-cols-[1fr_88px_24px] items-start gap-1.5"
            >
              <div className="space-y-1">
                <Input
                  value={c.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    // Keep key stable once the user has typed once; otherwise
                    // derive from label so the key looks sensible.
                    const looksAuto =
                      c.key.startsWith("custom") ||
                      c.key === slugifyKey(c.label);
                    const used = new Set(
                      criteria.filter((_, idx) => idx !== i).map((x) => x.key),
                    );
                    const nextKey = looksAuto
                      ? ensureUniqueKey(slugifyKey(label), used)
                      : c.key;
                    updateAt(i, { label, key: nextKey });
                  }}
                  placeholder="维度名称（例：准确性）"
                  className="h-7 text-[12.5px]"
                />
                <Input
                  value={c.description ?? ""}
                  onChange={(e) =>
                    updateAt(i, { description: e.target.value })
                  }
                  placeholder="评分说明（可选）"
                  className="h-7 text-[12px] text-muted-foreground"
                />
              </div>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Number((c.weight * 100).toFixed(1))}
                  onChange={(e) => {
                    const pct = Math.max(0, Number(e.target.value) || 0);
                    updateAt(i, { weight: pct / 100 });
                  }}
                  className="h-7 pr-6 text-right font-mono text-[12.5px]"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                  %
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7"
                onClick={() => removeAt(i)}
                aria-label="删除维度"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {criteria.length > 0 && (
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-[11px] text-muted-foreground">
            当前合计
          </span>
          <span
            className={`font-mono text-[11.5px] ${
              balanced ? "text-success" : "text-warning"
            }`}
          >
            {sumPct.toFixed(1)}%
            {!balanced && " · 将归一化"}
          </span>
        </div>
      )}
    </div>
  );
}

function FloorElementPicker({
  floorElements,
  targetEmployeeId,
  selected,
  onChange,
}: {
  floorElements: FloorElement[];
  targetEmployeeId?: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const candidates =
    targetEmployeeId && targetEmployeeId !== ALL_EMPLOYEES_ID
      ? floorElements.filter((f) => f.employeeId === targetEmployeeId)
      : floorElements;

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="text-[12px] font-medium text-muted-foreground">
        关联红线 / 下限要素
        <span className="ml-1 font-normal text-muted-foreground/70">
          挂上 isRedLine 要素即标为安全题
        </span>
      </div>
      {candidates.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {targetEmployeeId && targetEmployeeId !== ALL_EMPLOYEES_ID
            ? "该员工暂无下限要素，可先在「保下限」面板创建"
            : "暂无下限要素，可先在「保下限」面板创建"}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {candidates.map((f) => {
            const isSelected = selected.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggle(f.id)}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] transition-colors ${
                  isSelected
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {f.title}
                {f.isRedLine && (
                  <span className="rounded bg-destructive/15 px-0.5 text-[10px] font-semibold text-destructive">
                    红线
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
        {hint && (
          <span className="ml-1 font-normal text-muted-foreground/70">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}
