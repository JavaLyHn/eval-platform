import {
  ArrowDownUp,
  Download,
  Eraser,
  Filter,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import {
  ALL_EMPLOYEES_ID,
  ALL_EMPLOYEES_LABEL,
} from "@/lib/standard-employees";
import { isSkillQuestion } from "@/lib/skill-question";
import { useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmployeeAvatar } from "@/components/employee-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DifficultyBadge,
  StatusBadge,
} from "@/components/status-indicator";
import { QuestionFormDialog } from "./question-form-dialog";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { TagFilter } from "./tag-filter";
import { BulkQueueBar } from "./bulk-queue-bar";
import { useQAStore, type SortField, type SortDirection } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";
import {
  downloadBlob,
  parseQuestionsFromCSV,
  parseQuestionsFromJSON,
  questionsToCSV,
  questionsToJSON,
} from "@/lib/io";
import type { Category, Difficulty, Question, QuestionStatus } from "@/types";
import { GroundTruthBadge } from "./ground-truth-badge";

/** ground-truth 徽章暂时下线(可恢复):置回 true 即恢复。 */
const SHOW_GROUND_TRUTH_BADGE: boolean = false;

const DIFFICULTIES: Array<Difficulty | "all"> = [
  "all",
  "easy",
  "medium",
  "hard",
];

const STATUSES: Array<QuestionStatus | "all"> = [
  "all",
  "untested",
  "tested",
  "passed",
  "failed",
];

const STATUS_LABEL: Record<QuestionStatus | "all", string> = {
  all: "全部状态",
  untested: "未测",
  tested: "已测",
  passed: "通过",
  failed: "失败",
};

const DIFF_LABEL: Record<Difficulty | "all", string> = {
  all: "全部难度",
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

const DIFFICULTY_ORDER: Record<Difficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};

const SORT_LABELS: Record<SortField, string> = {
  created: "创建时间",
  difficulty: "难度",
  lastScore: "上次得分",
  number: "题号",
  manual: "手动排序",
};

export function LibraryTab() {
  const {
    questions,
    selectedQuestionId,
    setSelectedQuestion,
    selection,
    toggleSelection,
    setSelection,
    deleteQuestion,
    importQuestions,
    queue,
    categories,
    getQStatusInActiveConv,
    getQLastScoreInActiveConv,
    standardEmployees,
    clearMessages,
    configuredEmployeeIds,
  } = useQAStore();
  const configuredEmployees = useMemo(
    () => standardEmployees.filter((e) => configuredEmployeeIds.includes(e.id)),
    [standardEmployees, configuredEmployeeIds],
  );
  const categoryOptions: Array<Category | "all"> = ["all", ...categories];

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [difficulty, setDifficulty] = useState<Difficulty | "all">("all");
  const [status, setStatus] = useState<QuestionStatus | "all">("all");
  const [tagsSel, setTagsSel] = useState<string[]>([]);
  const [sortField, setSortField] = useState<SortField>("created");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  // P0-3 standardization filters
  const [targetEmployee, setTargetEmployee] = useState<string | "all">("all");
  const [severity, setSeverity] = useState<"all" | "P0" | "P1" | "P2">("all");
  const [scopeFilter, setScopeFilter] = useState<
    "all" | "out-of-scope" | "in-scope"
  >("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Question | undefined>(undefined);
  const [deleting, setDeleting] = useState<Question | null>(null);
  const [confirmingClear, setConfirmingClear] = useState<Question | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    questions.forEach((q) => q.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [questions]);

  const filtered = useMemo(() => {
    const out = questions.filter((q) => {
      if (q.transient) return false; // 临时题(手动对话未保存)不进题库列表
      // 技能题只用于 Skill 评测,不在工作台选题/发给 agent 的列表里出现。
      if (isSkillQuestion(q)) return false;
      const qCats = Array.isArray(q.categories) ? q.categories : [];
      if (category !== "all" && !qCats.includes(category)) return false;
      if (difficulty !== "all" && q.difficulty !== difficulty) return false;
      if (status !== "all" && getQStatusInActiveConv(q.id) !== status)
        return false;
      if (tagsSel.length > 0 && !tagsSel.every((t) => q.tags.includes(t)))
        return false;
      // Standardization filters (P0-3)
      if (targetEmployee !== "all" && q.targetEmployeeId !== targetEmployee)
        return false;
      if (severity !== "all" && q.severity !== severity) return false;
      if (scopeFilter === "out-of-scope" && !q.outOfScope) return false;
      if (scopeFilter === "in-scope" && q.outOfScope) return false;
      if (query) {
        const needle = query.toLowerCase();
        const haystack = [q.number, q.title, ...qCats, ...q.tags]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
    const sign = sortDir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      switch (sortField) {
        case "created":
          return (
            sign *
            (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          );
        case "difficulty":
          return (
            sign * (DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty])
          );
        case "lastScore":
          return (
            sign *
            ((getQLastScoreInActiveConv(a.id) ?? -1) -
              (getQLastScoreInActiveConv(b.id) ?? -1))
          );
        case "number":
          return sign * a.number.localeCompare(b.number);
        case "manual":
          return 0; // preserve questions[] array order
      }
    });
    return out;
  }, [
    questions,
    category,
    difficulty,
    status,
    tagsSel,
    query,
    sortField,
    sortDir,
    targetEmployee,
    severity,
    scopeFilter,
    getQStatusInActiveConv,
    getQLastScoreInActiveConv,
  ]);

  const visibleIds = filtered.map((q) => q.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selection.has(id));
  const someVisibleSelected =
    visibleIds.some((id) => selection.has(id)) && !allVisibleSelected;

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      const next = Array.from(selection).filter((id) => !visibleIds.includes(id));
      setSelection(next);
    } else {
      const merged = new Set(selection);
      visibleIds.forEach((id) => merged.add(id));
      setSelection(Array.from(merged));
    }
  };

  const hasFilters =
    query !== "" ||
    category !== "all" ||
    difficulty !== "all" ||
    status !== "all" ||
    tagsSel.length > 0;

  const handleExport = (format: "json" | "csv") => {
    const ts = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      downloadBlob(
        `qa-questions-${ts}.json`,
        questionsToJSON(questions),
        "application/json",
      );
    } else {
      downloadBlob(
        `qa-questions-${ts}.csv`,
        questionsToCSV(questions),
        "text/csv;charset=utf-8",
      );
    }
  };

  const handleImportFile = async (
    file: File,
    mode: "append" | "replace",
  ) => {
    try {
      const text = await file.text();
      const parsed = file.name.endsWith(".csv")
        ? parseQuestionsFromCSV(text)
        : parseQuestionsFromJSON(text);
      if (parsed.length === 0) {
        alert("文件中没有可导入的题目（请检查格式）");
        return;
      }
      const { added, skipped } = importQuestions(parsed, mode);
      alert(`导入完成：新增 ${added} 道${skipped > 0 ? `，跳过重复 ${skipped} 道` : ""}`);
    } catch (e) {
      alert(`导入失败：${(e as Error).message}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          共 <span className="font-mono text-foreground">{questions.length}</span> 道
          {hasFilters && (
            <>
              <span className="text-border"> · </span>
              <span className="font-mono text-foreground">{filtered.length}</span>{" "}
              符合筛选
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => fileInputRef.current?.click()}
                aria-label="导入"
              >
                <Upload className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>导入 JSON / CSV（追加）</TooltipContent>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f, "append");
            }}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="导出">
                <Download className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>导出题库</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => handleExport("json")}>
                JSON 格式
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport("csv")}>
                CSV 格式
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="default"
            size="sm"
            className="h-8 gap-1 px-2.5 text-xs"
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> 新建
          </Button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索题号、标题、标签..."
            className="h-8 pl-8 text-[13px]"
          />
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as Category | "all")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === "all" ? "全部分类" : c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={difficulty}
            onValueChange={(v) => setDifficulty(v as Difficulty | "all")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIFFICULTIES.map((d) => (
                <SelectItem key={d} value={d}>
                  {DIFF_LABEL[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(v) => setStatus(v as QuestionStatus | "all")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* P0-3 standardization filters */}
        <div className="grid grid-cols-3 gap-1.5">
          <Select
            value={targetEmployee}
            onValueChange={(v) => setTargetEmployee(v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部员工</SelectItem>
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
            </SelectContent>
          </Select>

          <Select
            value={severity}
            onValueChange={(v) =>
              setSeverity(v as "all" | "P0" | "P1" | "P2")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部严重度</SelectItem>
              <SelectItem value="P0">P0 — 核心</SelectItem>
              <SelectItem value="P1">P1 — 差异化</SelectItem>
              <SelectItem value="P2">P2 — 细节</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={scopeFilter}
            onValueChange={(v) =>
              setScopeFilter(v as "all" | "out-of-scope" | "in-scope")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部范围</SelectItem>
              <SelectItem value="in-scope">职责内</SelectItem>
              <SelectItem value="out-of-scope">超范围（边界）</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <TagFilter
            allTags={allTags}
            selected={tagsSel}
            onChange={setTagsSel}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs"
              >
                <ArrowDownUp className="h-3 w-3" />
                {SORT_LABELS[sortField]}
                <span className="text-muted-foreground">
                  {sortDir === "desc" ? "↓" : "↑"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>排序字段</DropdownMenuLabel>
              {(Object.keys(SORT_LABELS) as SortField[]).map((f) => (
                <DropdownMenuItem
                  key={f}
                  onSelect={() => setSortField(f)}
                  className={cn(sortField === f && "text-foreground")}
                >
                  {SORT_LABELS[f]}
                  {sortField === f && (
                    <span className="ml-auto text-muted-foreground">✓</span>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>方向</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => setSortDir("desc")}
                className={cn(sortDir === "desc" && "text-foreground")}
              >
                降序 ↓
                {sortDir === "desc" && (
                  <span className="ml-auto text-muted-foreground">✓</span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setSortDir("asc")}
                className={cn(sortDir === "asc" && "text-foreground")}
              >
                升序 ↑
                {sortDir === "asc" && (
                  <span className="ml-auto text-muted-foreground">✓</span>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-8 px-2 text-[11px] text-muted-foreground"
              onClick={() => {
                setQuery("");
                setCategory("all");
                setDifficulty("all");
                setStatus("all");
                setTagsSel([]);
              }}
            >
              <Filter className="h-3 w-3" /> 清除筛选
            </Button>
          )}
        </div>
      </div>

      <BulkQueueBar />

      {/* Select-all row */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
          <Checkbox
            checked={
              allVisibleSelected
                ? true
                : someVisibleSelected
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={toggleSelectAll}
            aria-label="全选当前筛选结果"
          />
          <span>
            {allVisibleSelected
              ? "已全选"
              : someVisibleSelected
                ? "已部分选中"
                : "选择全部 (当前筛选)"}
          </span>
        </div>
      )}

      {/* List */}
      <ScrollArea className="-mx-1 flex-1">
        <ul className="space-y-1 px-1 pb-2" role="listbox">
          {filtered.map((q) => (
            <QuestionRow
              key={q.id}
              question={q}
              convStatus={getQStatusInActiveConv(q.id)}
              convLastScore={getQLastScoreInActiveConv(q.id)}
              selected={selection.has(q.id)}
              viewing={q.id === selectedQuestionId}
              queueState={
                queue.current?.questionId === q.id
                  ? "running"
                  : queue.completed.some((it) => it.questionId === q.id)
                    ? "done"
                    : queue.errored.some((it) => it.questionId === q.id)
                      ? "errored"
                      : queue.pending.some((it) => it.questionId === q.id) &&
                          queue.running
                        ? "pending"
                        : null
              }
              onSelect={() => setSelectedQuestion(q.id)}
              onClearAndSelect={() => setConfirmingClear(q)}
              onCheck={() => toggleSelection(q.id)}
              onEdit={() => {
                setEditing(q);
                setFormOpen(true);
              }}
              onDelete={() => setDeleting(q)}
            />
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-10 text-center text-xs text-muted-foreground">
              {questions.length === 0
                ? "题库为空，点击右上角「新建」或「导入」开始"
                : "没有匹配的题目，尝试调整筛选条件"}
            </li>
          )}
        </ul>
      </ScrollArea>

      <QuestionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        question={editing}
      />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`删除「${deleting?.title ?? ""}」？`}
        description="此操作无法撤销。该题目的历史评测记录仍会保留，但题目本身将从题库中移除。"
        onConfirm={() => deleting && deleteQuestion(deleting.id)}
      />
      <ConfirmDeleteDialog
        open={!!confirmingClear}
        onOpenChange={(o) => !o && setConfirmingClear(null)}
        title="清空当前会话并答此题？"
        description={
          confirmingClear
            ? `「${confirmingClear.title}」将在新的空白上下文里开始答题。当前会话的历史消息会被清空（题库和历史评测记录不受影响）。`
            : undefined
        }
        confirmLabel="清空并答题"
        onConfirm={() => {
          if (confirmingClear) {
            clearMessages();
            setSelectedQuestion(confirmingClear.id);
          }
        }}
      />
    </div>
  );
}

type QueueRowState = "running" | "done" | "errored" | "pending" | null;

interface RowProps {
  question: Question;
  /** Status scoped to the active conversation (defaults to "untested" in fresh convs). */
  convStatus: import("@/types").QuestionStatus;
  /** Score from the latest eval IN THIS CONV (undefined → no row-side score shown). */
  convLastScore: number | undefined;
  selected: boolean;
  viewing: boolean;
  queueState: QueueRowState;
  onSelect: () => void;
  /** Clear the active conversation, then select — for clean-context answering. */
  onClearAndSelect: () => void;
  onCheck: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function QuestionRow({
  question: q,
  convStatus,
  convLastScore,
  selected,
  viewing,
  queueState,
  onSelect,
  onClearAndSelect,
  onCheck,
  onEdit,
  onDelete,
}: RowProps) {
  return (
    <li>
      <div
        className={cn(
          "group relative flex items-start gap-2 rounded-lg border px-2.5 py-2.5 transition-all duration-150 hover:border-foreground/20 hover:bg-surface",
          viewing
            ? "border-foreground/30 bg-surface shadow-sm"
            : "border-border bg-card",
          selected && "ring-1 ring-foreground/20",
        )}
      >
        <div
          className="mt-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={onCheck}
            aria-label={`选择 ${q.number}`}
          />
        </div>

        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left focus:outline-none"
        >
          <div className="flex items-center gap-2">
            <DifficultyBadge value={q.difficulty} />
            <StatusBadge value={convStatus} />
            {queueState && <QueueDot state={queueState} />}
          </div>
          <p className="mt-1 line-clamp-1 text-[13.5px] font-medium text-foreground">
            {q.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {(Array.isArray(q.categories) ? q.categories : []).map((c) => (
              <Badge key={c} variant="muted" className="text-[10px]">
                {c}
              </Badge>
            ))}
            {SHOW_GROUND_TRUTH_BADGE && q.groundTruthChecks?.length ? (
              <GroundTruthBadge
                kinds={q.groundTruthChecks.map((c) => c.kind)}
              />
            ) : null}
          </div>
        </button>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {convLastScore != null && (
            <div className="text-right">
              <div className="font-mono text-[15px] font-semibold tabular-nums leading-none text-foreground">
                {convLastScore.toFixed(2)}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                上次
              </div>
            </div>
          )}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearAndSelect();
                  }}
                  aria-label="清空会话并答此题"
                >
                  <Eraser className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                清空会话再答此题（避免上下文干扰）
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="更多操作"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onClearAndSelect}>
                  <Eraser /> 清空会话并答此题
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil /> 编辑
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={onDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 /> 删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </li>
  );
}

function QueueDot({ state }: { state: QueueRowState }) {
  const style: Record<NonNullable<QueueRowState>, { cls: string; label: string }> = {
    pending: { cls: "bg-muted-foreground/60", label: "排队中" },
    running: { cls: "bg-accent animate-pulse-dot", label: "运行中" },
    done: { cls: "bg-success", label: "已完成" },
    errored: { cls: "bg-destructive", label: "失败" },
  };
  const s = style[state!];
  return (
    <span
      className={cn(
        "inline-flex h-1.5 w-1.5 rounded-full",
        s.cls,
      )}
      title={s.label}
    />
  );
}
