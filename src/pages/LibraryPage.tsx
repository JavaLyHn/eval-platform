/**
 * Full-screen question library at /library.
 *
 *  ┌─ Header (title + breadcrumb + actions) ────────┐
 *  ├─ Toolbar (search + filters + sort, URL bound)   │
 *  ├─ Table (sortable, multi-select)                 │
 *  └─ Bulk-action footer (only when selection > 0)   │
 *
 * Row click opens QuestionDetailSheet (right drawer). The sheet's "⤢" button
 * navigates to /library/:id (full-screen detail page).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HomeButton } from "@/components/home-button";
import { HeaderIconBadge } from "@/components/header-icon-badge";
import {
  ArrowDownUp,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  ChevronDown,
  Download,
  GripVertical,
  Library as LibraryIcon,
  Paperclip,
  PenLine,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StartEvaluationRunDialog } from "@/components/question-panel/start-evaluation-run-dialog";
import { MultiSelectFilter } from "@/components/question-panel/multi-select-filter";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DifficultyBadge } from "@/components/status-indicator";
import { QuestionFormDialog } from "@/components/question-panel/question-form-dialog";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import { DashboardTab } from "@/components/question-panel/dashboard-tab";
import { GenerateQuestionsDialog } from "@/components/question-panel/generate-questions-dialog";
import { GroundTruthGeneratorDialog } from "@/components/question-panel/ground-truth-generator-dialog";
import { ImportQuestionsDialog } from "@/components/question-panel/import-questions-dialog";
import { ExportBankDialog } from "@/components/question-panel/export-bank-dialog";
import { QuestionDetailSheet } from "@/components/library/question-detail-sheet";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { AXIS_TAG_PREFIX } from "@/lib/gen-dimensions";
import { ADAPTIVE_TAG } from "@/lib/adaptive-followup";
import {
  ALL_EMPLOYEES_ID,
  ALL_EMPLOYEES_LABEL,
} from "@/lib/standard-employees";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { useQAStore, type SortField, type SortDirection } from "@/hooks/use-qa-store";
import { selectQuestionsForExport } from "@/lib/bank-export";
import { isSkillQuestion, skillCaseType } from "@/lib/skill-question";
import { cn } from "@/lib/utils";
import {
  downloadBlob,
  parseQuestionsFromCSV,
  parseQuestionsFromJSON,
  questionsToCSV,
  questionsToJSON,
} from "@/lib/io";
import type {
  AgentSkill,
  Difficulty,
  Question,
  SampleIntent,
  QuestionSeverity,
} from "@/types";

const DIFFICULTY_ORDER: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

/** Field user picks for visual grouping. "none" = flat list (default). */
type GroupKey = "none" | "employee" | "industry" | "severity" | "intent" | "difficulty" | "caseType";

const GROUP_LABELS: Record<GroupKey, string> = {
  none: "不分组",
  employee: "员工",
  industry: "行业",
  severity: "P 级",
  intent: "意图",
  difficulty: "难度",
  caseType: "题型",
};

/** skill 题(接 SkillOpt)的题型/SkillOpt 维度,从 skilloptCase 载体派生(旧题回落 outOfScope)。
 * agent 题的 P级/意图对 skill 无意义,skill 视图改用这套。 */
function skillCaseMeta(q: Question): {
  type: "interception" | "acceptAny" | "standard";
  label: string;
  tone: string;
  detail: string;
  /** 悬停 tooltip 文本:acceptAny 列出具体「必含:… / 禁现:…」词表,其余同 detail。 */
  tip: string;
} {
  const sc = q.skilloptCase;
  const type = skillCaseType(q);
  const e = sc?.expected ?? {};
  if (type === "interception")
    return { type, label: "红线", tone: "bg-rose-500/15 text-rose-600 dark:text-rose-400", detail: "应拦截", tip: "应拦截" };
  if (type === "standard") {
    const detail = e.intentType ? `意图:${e.intentType}` : "意图分类";
    return {
      type,
      label: "意图",
      tone: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
      detail,
      tip: detail,
    };
  }
  const n = (e.mustInclude?.length ?? 0) + (e.mustExclude?.length ?? 0);
  const tip =
    n > 0
      ? [
          e.mustInclude?.length ? `必含:${e.mustInclude.join("、")}` : "",
          e.mustExclude?.length ? `禁现:${e.mustExclude.join("、")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "无约束";
  return {
    type,
    label: "正常",
    tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    detail: n > 0 ? `约束 ${n}` : "无约束",
    tip,
  };
}

const INTENT_LABEL: Record<SampleIntent | "all", string> = {
  all: "全部意图",
  typical: "typical 典型",
  boundary: "boundary 边界",
  anomaly: "anomaly 异常",
};

/** agent 意图徽标:中文短标签 + 红绿蓝配色(与 skill 题库列表彩色徽标 filled 同款)。 */
const INTENT_BADGE: Record<SampleIntent, { label: string; tone: string }> = {
  typical: { label: "典型", tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
  boundary: { label: "边界", tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  anomaly: { label: "异常", tone: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
};

/** agent 题的出题场景:存在 q.tags 里(cellTags 写 `场景:xxx`),非 categories。 */
function scenarioOf(q: Question): string | undefined {
  const prefix = `${AXIS_TAG_PREFIX.scenario}:`;
  const t = (Array.isArray(q.tags) ? q.tags : []).find((x) => x.startsWith(prefix));
  return t ? t.slice(prefix.length) : undefined;
}

/** 把 URL 里的 CSV 参数(如 `sev=P0,P1`)解析成去空白/去空串的数组;"all" 或空值 → []。 */
const csvParam = (v: string): string[] =>
  v && v !== "all" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];

/* -------------------------------------------------------------------------- */
/* URL-bound filter state                                                     */
/* -------------------------------------------------------------------------- */

function useUrlState() {
  const [params, setParams] = useSearchParams();
  const get = (key: string, fallback: string) => params.get(key) ?? fallback;

  /** Apply one or more (key, value, fallback) updates in a single setParams
   *  call. Coalescing matters: two back-to-back setParams calls race because
   *  the second reads stale `prev` and can clobber the first. */
  const setMany = (
    updates: Array<{ key: string; value: string; fallback: string }>,
  ) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const { key, value, fallback } of updates) {
          if (value === fallback) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };

  const set = (key: string, value: string, fallback: string) =>
    setMany([{ key, value, fallback }]);

  return { get, set, setMany };
}

/** 题库导入/导出已按需求下线(可恢复):置回 true 即恢复。 */
const SHOW_LIBRARY_IO: boolean = false;

export function LibraryPage() {
  const navigate = useNavigate();
  const {
    questions,
    setSelectionForConv,
    deleteQuestion,
    importQuestions,
    reorderQuestions,
    standardEmployees,
    configuredEmployeeIds,
    getQLastScoreInActiveConv,
    setSelectedQuestion,
    updateQuestion,
    showNotice,
    genDimensions,
    newConversation,
    setRightTab,
  } = useQAStore();

  const configuredEmployees = useMemo(
    () => standardEmployees.filter((e) => configuredEmployeeIds.includes(e.id)),
    [standardEmployees, configuredEmployeeIds],
  );

  // Entering /library means the user is back to "browse / pick" mode. Drop
  // any previously-active workspace question so navigating home with no fresh
  // pick lands on the empty state (per-user request: 没选题目时首页不显示题目).
  useEffect(() => {
    setSelectedQuestion(null);
    // Run once on mount — re-running on selectedQuestion changes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 题库的勾选是**本页本地状态**,不写进任何会话 —— 只有点「去首页答题」才会把选中题
  // 塞进一个新会话(setSelectionForConv)。这样「光勾选、没点去首页答题」绝不会污染首页。
  // 离开 /library 时本组件卸载,picked 自然清空。
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { get, set, setMany } = useUrlState();
  /** Filter setter that also resets page back to 1. */
  const setFilter = (key: string, value: string, fallback: string) =>
    setMany([
      { key, value, fallback },
      { key: "page", value: "1", fallback: "1" },
    ]);

  /** 切换 Agent / Skill 库 = 刷新到干净状态:清掉所有筛选 / 搜索 / 分组 / 选中 / 翻页,
   *  避免在 agent 选的员工(及场景等)残留到 skill 库。 */
  const switchBank = (kind: "agent" | "skill") =>
    setMany([
      { key: "kind", value: kind, fallback: "agent" },
      { key: "emp", value: "all", fallback: "all" },
      { key: "scene", value: "all", fallback: "all" },
      { key: "skill", value: "all", fallback: "all" },
      { key: "sev", value: "all", fallback: "all" },
      { key: "intent", value: "all", fallback: "all" },
      { key: "ct", value: "all", fallback: "all" },
      { key: "ind", value: "all", fallback: "all" },
      { key: "group", value: "none", fallback: "none" },
      { key: "q", value: "", fallback: "" },
      { key: "selected", value: "", fallback: "" },
      { key: "page", value: "1", fallback: "1" },
    ]);

  const view = (get("view", "table") as "table" | "dashboard") || "table";
  const query = get("q", "");
  const employee = get("emp", "all");
  const industryF = get("ind", "all");
  const sevRaw = get("sev", "all");
  const intentRaw = get("intent", "all");
  // 题号列已移除：旧 URL 上若有 sort=number 自动落回 created
  const rawSort = get("sort", "created") as SortField;
  const sortField: SortField = rawSort === "number" ? "created" : rawSort;
  const sortDir = get("dir", "desc") as SortDirection;
  const selectedId = get("selected", "");
  const groupBy = get("group", "none") as GroupKey;
  const kindFilter = get("kind", "agent") as "agent" | "skill";
  const isSkillView = kindFilter === "skill";
  // skill 视图专属:按题型(SkillOpt caseType)筛选(替代 agent 的 P级/意图)。
  const ctRaw = get("ct", "all");
  // 依赖所选员工的二级筛选:agent=场景、skill=优化的 skill。仅选定具体员工后才生效/显示。
  const sceneRaw = get("scene", "all");
  const skillRaw = get("skill", "all");
  const sevSel = useMemo(() => csvParam(sevRaw), [sevRaw]);
  const intentSel = useMemo(() => csvParam(intentRaw), [intentRaw]);
  const sceneSel = useMemo(() => csvParam(sceneRaw), [sceneRaw]);
  const ctSel = useMemo(() => csvParam(ctRaw), [ctRaw]);
  const skillSel = useMemo(() => csvParam(skillRaw), [skillRaw]);
  const page = Math.max(1, parseInt(get("page", "1"), 10) || 1);
  const pageSizeRaw = get("pageSize", "50");
  const pageSize: number | "all" =
    pageSizeRaw === "all" ? "all" : Math.max(1, parseInt(pageSizeRaw, 10) || 50);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Question | undefined>(undefined);
  const [deleting, setDeleting] = useState<Question | null>(null);
  // Drag-and-drop reorder — always enabled. The first drop auto-switches
  // sort to "manual" so the new order persists.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [genSkill, setGenSkill] = useState<AgentSkill | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [gtGenOpen, setGtGenOpen] = useState(false);
  const [autoEvalOpen, setAutoEvalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setOverId(null);
      return;
    }
    // If we're not already in manual sort, snapshot the currently-visible
    // order into questions[] FIRST so what the user sees matches what we
    // reorder against. Then flip sort to manual so subsequent renders keep
    // the new sequence stable instead of re-applying created/score/etc.
    const ids = filtered.map((q) => q.id);
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) {
      setDraggingId(null);
      setOverId(null);
      return;
    }
    ids.splice(from, 1);
    ids.splice(to, 0, draggingId);
    const filteredIds = new Set(ids);
    const fullOrder: string[] = [];
    for (const q of questions) {
      if (!filteredIds.has(q.id)) fullOrder.push(q.id);
    }
    const insertAt = Math.max(
      0,
      questions.findIndex((q) => filteredIds.has(q.id)),
    );
    fullOrder.splice(insertAt, 0, ...ids);
    reorderQuestions(fullOrder);
    if (sortField !== "manual") {
      setMany([
        { key: "sort", value: "manual", fallback: "created" },
        { key: "dir", value: "desc", fallback: "desc" },
      ]);
    }
    setDraggingId(null);
    setOverId(null);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ----- filtering + sorting -------------------------------------------- */

  // 行业筛选选项 = 预置(genDimensions)∪ 题目里已用到的(防止旧值选不回来)。
  const industryOptions = useMemo(() => {
    const set = new Set<string>(genDimensions.industries);
    for (const q of questions) if (q.industry) set.add(q.industry);
    return [...set];
  }, [genDimensions.industries, questions]);

  const filtered = useMemo(() => {
    const base = selectQuestionsForExport(questions, kindFilter, {
      employee,
      severities: sevSel,
      intents: intentSel,
      caseTypes: ctSel,
      skills: skillSel,
    });
    const out = base.filter((q) => {
      if (kindFilter === "agent") {
        // agent 题:行业(skill 题无此维度)
        if (industryF !== "all" && q.industry !== industryF) return false;
        // 场景:仅在选定员工后生效(全部员工时忽略,UI 也不显示该筛选)
        if (employee !== "all" && sceneSel.length && !sceneSel.includes(scenarioOf(q) ?? ""))
          return false;
      }
      if (query) {
        const needle = query.toLowerCase();
        const cats = Array.isArray(q.categories) ? q.categories : [];
        const hay = [q.number, q.title, ...cats, ...q.tags].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    // Manual sort keeps the questions[] array order — no in-place sort.
    if (sortField === "manual") return out;
    const sign = sortDir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      switch (sortField) {
        case "created":
          return (
            sign * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          );
        case "difficulty":
          return sign * (DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]);
        case "lastScore":
          return (
            sign *
            ((getQLastScoreInActiveConv(a.id) ?? -1) -
              (getQLastScoreInActiveConv(b.id) ?? -1))
          );
        default:
          return 0;
      }
    });
    return out;
  }, [
    questions,
    employee,
    industryF,
    sevSel,
    intentSel,
    ctSel,
    query,
    sortField,
    sortDir,
    getQLastScoreInActiveConv,
    kindFilter,
    sceneSel,
    skillSel,
  ]);

  // 两库各自计数(50/51 不再混算;胶囊库切换也用它显示各自数量)。
  const agentCount = useMemo(
    () => questions.filter((q) => !q.transient && (q.kind ?? "agent") === "agent").length,
    [questions],
  );
  const skillCount = useMemo(
    () => questions.filter((q) => !q.transient && (q.kind ?? "agent") === "skill").length,
    [questions],
  );

  // 所选员工范围内的二级筛选选项:agent=该员工出现过的场景,skill=该员工优化过的 skill。
  // 仅在选定具体员工(emp !== "all")时有意义,因此选项也按该员工题目收集。
  const scenarioOptions = useMemo(() => {
    if (isSkillView || employee === "all") return [];
    const set = new Set<string>();
    for (const q of questions) {
      if (q.transient || (q.kind ?? "agent") !== "agent") continue;
      if (q.targetEmployeeId !== employee) continue;
      const s = scenarioOf(q);
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [questions, employee, isSkillView]);

  const skillOptions = useMemo(() => {
    if (!isSkillView || employee === "all") return [];
    const set = new Set<string>();
    for (const q of questions) {
      if (q.transient || q.kind !== "skill") continue;
      if (q.targetEmployeeId !== employee) continue;
      if (q.targetSkill) set.add(q.targetSkill);
    }
    return Array.from(set).sort();
  }, [questions, employee, isSkillView]);

  /* ----- pagination ----------------------------------------------------- */

  const total = filtered.length;
  const pageSizeNum = pageSize === "all" ? Math.max(1, total) : pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSizeNum));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    if (pageSize === "all") return filtered;
    const start = (safePage - 1) * pageSizeNum;
    return filtered.slice(start, start + pageSizeNum);
  }, [filtered, safePage, pageSize, pageSizeNum]);

  /* ----- grouping (operates on the visible page) ------------------------ */

  const employeeNameOf = (id: string | undefined) => {
    if (!id) return "未指定员工";
    if (id === ALL_EMPLOYEES_ID) return ALL_EMPLOYEES_LABEL;
    return standardEmployees.find((e) => e.id === id)?.name ?? id;
  };
  const groupOf = (q: Question): { key: string; label: string } => {
    switch (groupBy) {
      case "employee":
        return {
          key: q.targetEmployeeId ?? "_none_",
          label: employeeNameOf(q.targetEmployeeId),
        };
      case "industry":
        return { key: q.industry ?? "_none_", label: q.industry ?? "未指定行业" };
      case "severity":
        return { key: q.severity ?? "_none_", label: q.severity ?? "未设" };
      case "intent":
        return { key: q.intent ?? "_none_", label: q.intent ?? "未设" };
      case "caseType": {
        const m = skillCaseMeta(q);
        return { key: m.type, label: m.label };
      }
      case "difficulty":
        return { key: q.difficulty, label: q.difficulty };
      default:
        return { key: "_all_", label: "" };
    }
  };

  const groupedPage = useMemo(() => {
    // 行业分组暂时下线:URL 残留 group=industry 一律回落为不分组
    const effectiveGroup = groupBy === "industry" ? "none" : groupBy;
    if (effectiveGroup === "none") return [{ key: "_all_", label: "", items: pageRows }];
    const order: string[] = [];
    const buckets = new Map<string, { label: string; items: Question[] }>();
    for (const q of pageRows) {
      const g = groupOf(q);
      if (!buckets.has(g.key)) {
        buckets.set(g.key, { label: g.label, items: [] });
        order.push(g.key);
      }
      buckets.get(g.key)!.items.push(q);
    }
    return order.map((k) => ({ key: k, ...buckets.get(k)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageRows, groupBy, kindFilter]);

  /* ----- selection ------------------------------------------------------ */

  const visibleIds = pageRows.map((q) => q.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));
  const someVisibleSelected =
    visibleIds.some((id) => picked.has(id)) && !allVisibleSelected;

  const toggleSelectAll = () => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  /* ----- bulk actions --------------------------------------------------- */

  const handleBulkDelete = () => {
    const count = picked.size;
    if (!count) return;
    if (!confirm(`确认删除 ${count} 道题？该操作不可撤销。`)) return;
    Array.from(picked).forEach((id) => deleteQuestion(id));
    setPicked(new Set());
  };

  /* ----- import / export ------------------------------------------------ */

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

  const handleImportFile = async (file: File, mode: "append" | "replace") => {
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


  /* ----- sort header click --------------------------------------------- */

  const toggleSort = (field: SortField) => {
    // Same field → just flip direction.
    // Different field → switch to it AND reset direction to desc, in ONE write.
    if (sortField === field) {
      setMany([
        { key: "dir", value: sortDir === "asc" ? "desc" : "asc", fallback: "desc" },
      ]);
    } else {
      setMany([
        { key: "sort", value: field, fallback: "created" },
        { key: "dir", value: "desc", fallback: "desc" },
      ]);
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowDownUp className="h-3 w-3 text-muted-foreground/50" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    );
  };

  /* ----- detail sheet --------------------------------------------------- */

  const selectedQuestion = useMemo(
    () => questions.find((q) => q.id === selectedId) ?? null,
    [questions, selectedId],
  );

  // Ensure URL stays clean: drop ?selected= when sheet closed.
  useEffect(() => {
    if (selectedId && !selectedQuestion) {
      set("selected", "", "");
    }
  }, [selectedId, selectedQuestion]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header ------------------------------------------------------------ */}
      <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 gap-y-2 border-b border-border bg-card px-4">
        <div className="flex items-center gap-3 min-w-0">
          <HomeButton />
          <HeaderIconBadge icon={LibraryIcon} />
          <h1 className="truncate text-sm font-semibold">题库</h1>
          {/* 胶囊库切换 + 各自计数徽标(agent / skill 两库独立) */}
          <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
            <BankPill active={!isSkillView} onClick={() => switchBank("agent")} label="Agent" count={agentCount} />
            <BankPill active={isSkillView} onClick={() => switchBank("skill")} label="Skill" count={skillCount} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {/* 视图切换:题目 / 数据看板 —— 仅 agent 库(skill 库无看板,只看题集) */}
          {!isSkillView && (
            <div className="mr-1 inline-flex h-7 rounded-md border border-border bg-card p-0.5">
              <ViewBtn
                active={view === "table"}
                onClick={() => set("view", "table", "table")}
                icon={LibraryIcon}
                label="题目"
              />
              <ViewBtn
                active={view === "dashboard"}
                onClick={() => set("view", "dashboard", "table")}
                icon={BarChart3}
                label="数据看板"
              />
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="h-3.5 w-3.5" /> 导入
              </Button>
            </TooltipTrigger>
            <TooltipContent>从 xlsx / csv / json 导入题目(预览后确认)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => setExportOpen(true)}
              >
                <Download className="h-3.5 w-3.5" /> 导出
              </Button>
            </TooltipTrigger>
            <TooltipContent>按分类导出题库为 JSON(可自定义文件名)</TooltipContent>
          </Tooltip>
          {/* 题库导入/导出已按需求下线(可恢复):置回 true 即恢复。 */}
          {SHOW_LIBRARY_IO && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImportFile(f, "append");
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1"
              >
                <Upload className="h-3.5 w-3.5" /> 导入
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1">
                    <Download className="h-3.5 w-3.5" /> 导出
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
            </>
          )}
          {/* 出题(人工 / AI)仅 agent 库:skill 题在「Skill 评测」页用 CaseGenerator 生成,不在题库出 */}
          {!isSkillView && (
          <Popover
            open={skillPickerOpen}
            onOpenChange={setSkillPickerOpen}
          >
            <PopoverTrigger asChild>
              <Button variant="default" size="sm" className="gap-1">
                <Plus className="h-3.5 w-3.5" /> 出题
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[320px] p-0">
              <div className="p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setSkillPickerOpen(false);
                    setEditing(undefined);
                    setFormOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-accent/30"
                >
                  <PenLine className="h-4 w-4 text-foreground/70" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-foreground">
                      人工出题
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSkillPickerOpen(false);
                    setGenSkill(null);
                    setGenOpen(true);
                  }}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-accent/30"
                >
                  <Sparkles className="h-4 w-4 text-foreground/70" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-foreground">
                      AI 出题
                    </div>
                  </div>
                </button>
                {/* ground-truth 功能暂时下线(可恢复):删掉 false && 即重新启用入口 */}
                {false && (
                  <button
                    type="button"
                    onClick={() => {
                      setSkillPickerOpen(false);
                      setGtGenOpen(true);
                    }}
                    className="mt-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-accent/30"
                  >
                    <ShieldCheck className="h-4 w-4 text-foreground/70" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground">
                        生成 Ground-Truth
                      </div>
                      <div className="text-[10.5px] text-muted-foreground">
                        为 Aria / Sam 生成确定性探针题，带可自动核验的检查项
                      </div>
                    </div>
                  </button>
                )}
              </div>
            </PopoverContent>
          </Popover>
          )}
        </div>
      </div>

      {/* Dashboard view replaces table when chosen(skill 库无看板,恒走题目表) */}
      {!isSkillView && view === "dashboard" ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <DashboardTab />
        </div>
      ) : (
        <>
      {/* Toolbar ---------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface/40 px-4 py-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setFilter("q", e.target.value, "")}
            placeholder="题号 / 标题 / 标签..."
            className="h-8 pl-8 text-[13px]"
          />
        </div>

        <Select
          value={employee}
          onValueChange={(v) =>
            // 换员工 → 清掉依赖员工的二级筛选(场景 / 优化skill),避免带着上个员工的残留值。
            setMany([
              { key: "emp", value: v, fallback: "all" },
              { key: "scene", value: "all", fallback: "all" },
              { key: "skill", value: "all", fallback: "all" },
              { key: "page", value: "1", fallback: "1" },
            ])
          }
        >
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部员工</SelectItem>
            {configuredEmployees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                <span className="inline-flex items-center gap-1.5">
                  <EmployeeAvatar employee={e} size={16} />
                  {e.name}
                </span>
              </SelectItem>
            ))}
            {configuredEmployees.length === 0 && (
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                还没配置 agent，先去「员工」里关联
              </div>
            )}
          </SelectContent>
        </Select>

        {/* 行业分类暂时下线(数据模型保留,Question.industry 仍持久化;恢复时解开此块) */}
        {false && kindFilter === "agent" && (
          <Select value={industryF} onValueChange={(v) => setFilter("ind", v, "all")}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部行业</SelectItem>
              {industryOptions.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* agent 题:P级 / 意图筛选(skill 题无这些维度) */}
        {!isSkillView && (
          <>
            <MultiSelectFilter
              allLabel="全部严重度"
              className="w-[120px]"
              options={[
                { value: "P0", label: "P0 核心" },
                { value: "P1", label: "P1 差异化" },
                { value: "P2", label: "P2 细节" },
              ]}
              selected={sevSel}
              onChange={(n) => setFilter("sev", n.length ? n.join(",") : "all", "all")}
            />

            <MultiSelectFilter
              allLabel="全部意图"
              className="w-[140px]"
              options={(["typical", "boundary", "anomaly"] as const).map((v) => ({
                value: v,
                label: INTENT_LABEL[v],
              }))}
              selected={intentSel}
              onChange={(n) => setFilter("intent", n.length ? n.join(",") : "all", "all")}
            />

            {/* 场景:仅在选定具体员工后出现,列出该员工出现过的场景 */}
            {employee !== "all" && scenarioOptions.length > 0 && (
              <MultiSelectFilter
                allLabel="全部场景"
                className="w-[150px]"
                options={scenarioOptions.map((s) => ({ value: s, label: s }))}
                selected={sceneSel}
                onChange={(n) => setFilter("scene", n.length ? n.join(",") : "all", "all")}
              />
            )}
          </>
        )}

        {/* skill 题:按 SkillOpt 题型筛选(替代 P级 / 意图) */}
        {isSkillView && (
          <MultiSelectFilter
            allLabel="全部题型"
            className="w-[130px]"
            options={[
              { value: "acceptAny", label: "正常(任务)" },
              { value: "interception", label: "红线" },
              { value: "standard", label: "意图" },
            ]}
            selected={ctSel}
            onChange={(n) => setFilter("ct", n.length ? n.join(",") : "all", "all")}
          />
        )}

        {/* 优化的 skill:仅在选定具体员工后出现,列出该员工题目所属的 skill */}
        {isSkillView && employee !== "all" && skillOptions.length > 0 && (
          <MultiSelectFilter
            allLabel="全部 skill"
            className="w-[160px]"
            options={skillOptions.map((s) => ({ value: s, label: s }))}
            selected={skillSel}
            onChange={(n) => setFilter("skill", n.length ? n.join(",") : "all", "all")}
          />
        )}

        <span className="text-border">·</span>

        <Select
          value={groupBy}
          onValueChange={(v) =>
            setMany([
              { key: "group", value: v, fallback: "none" },
              { key: "page", value: "1", fallback: "1" },
            ])
          }
        >
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <span className="text-muted-foreground">分组：</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              isSkillView
                ? (["none", "employee", "caseType", "difficulty"] as const)
                : // 行业分组暂时下线(恢复时:agent 题加回 "industry")
                  (["none", "employee", "severity", "intent", "difficulty"] as const)
            ).map((g) => (
              <SelectItem key={g} value={g}>
                {GROUP_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(query ||
          employee !== "all" ||
          sevSel.length > 0 ||
          intentSel.length > 0 ||
          sceneSel.length > 0 ||
          ctSel.length > 0 ||
          skillSel.length > 0) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={() => {
              // 必须用 setMany 一次清空:多次 set() 会 race、后者覆盖前者
              //(emp 等会被最后一个 set 冲掉,导致「全部员工」清不掉)。
              setMany([
                { key: "q", value: "", fallback: "" },
                { key: "emp", value: "all", fallback: "all" },
                { key: "ind", value: "all", fallback: "all" },
                { key: "sev", value: "all", fallback: "all" },
                { key: "intent", value: "all", fallback: "all" },
                { key: "scene", value: "all", fallback: "all" },
                { key: "ct", value: "all", fallback: "all" },
                { key: "skill", value: "all", fallback: "all" },
              ]);
            }}
          >
            <X className="h-3 w-3" /> 清除筛选
          </Button>
        )}
      </div>

      {/* Table ------------------------------------------------------------ */}
      <ScrollArea horizontal className="flex-1 min-h-0">
        {/* min-w 只在手机:各列声明宽加起来约 570-600px,不给下限的话列会被压到 min-content
            (中文逐字断行)→ 变成"挤成一坨 + 疯狂换行"而不是横滑看原样。桌面 md:min-w-0 复原。 */}
        <table className="w-full min-w-[640px] text-[13px] md:min-w-0">
          <thead className="sticky top-0 z-10 bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <Th className="w-6 pl-2" />
              <Th className="w-8 pl-4">
                <Checkbox
                  checked={
                    allVisibleSelected
                      ? true
                      : someVisibleSelected
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={toggleSelectAll}
                  aria-label="全选"
                />
              </Th>
              <Th className="w-20">题号</Th>
              <Th>标题</Th>
              <Th className="w-28">员工</Th>
              {isSkillView ? <Th className="w-16">题型</Th> : <Th className="w-16">P级</Th>}
              {isSkillView ? <Th className="w-28">约束 / 意图</Th> : <Th className="w-20">意图</Th>}
              <Th onClick={() => toggleSort("difficulty")} className="w-16">
                <span className="inline-flex items-center gap-1">
                  难度 {sortIcon("difficulty")}
                </span>
              </Th>
              <Th onClick={() => toggleSort("created")} className="w-28">
                <span className="inline-flex items-center gap-1">
                  创建 {sortIcon("created")}
                </span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {total === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-xs text-muted-foreground">
                  没有匹配的题目
                </td>
              </tr>
            ) : (
              groupedPage.flatMap((group) => {
                const rows = group.items.map((q) => (
                <Row
                  key={q.id}
                  q={q}
                  selected={picked.has(q.id)}
                  isOpen={q.id === selectedId}
                  employee={standardEmployees.find(
                    (e) => e.id === q.targetEmployeeId,
                  )}
                  skillView={isSkillView}
                  onToggle={() => togglePicked(q.id)}
                  onOpen={() => set("selected", q.id, "")}
                  dragging={draggingId === q.id}
                  dropOver={overId === q.id}
                  onDragStart={() => setDraggingId(q.id)}
                  onDragEnter={() => setOverId(q.id)}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setOverId(null);
                  }}
                  onDrop={() => handleDrop(q.id)}
                />
                ));
                if (groupBy === "none") return rows;
                return [
                  <tr key={`group-${group.key}`} className="bg-muted/40">
                    <td
                      colSpan={9}
                      className="px-4 py-1.5 text-[11.5px] font-medium text-foreground"
                    >
                      <span>{group.label}</span>
                      <span className="ml-2 font-mono text-[10.5px] text-muted-foreground">
                        {group.items.length}
                      </span>
                    </td>
                  </tr>,
                  ...rows,
                ];
              })
            )}
          </tbody>
        </table>
      </ScrollArea>

      {/* Pagination footer ---------------------------------------------- */}
      {total > 0 && (
        <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-end gap-2 gap-y-1 border-t border-border bg-card/40 px-4 text-[11.5px] text-muted-foreground">
          <span>
            {pageSize === "all" ? (
              <>
                共 <span className="font-mono text-foreground">{total}</span> 题
              </>
            ) : (
              <>
                第{" "}
                <span className="font-mono text-foreground">{safePage}</span> /{" "}
                {totalPages} 页 · 共{" "}
                <span className="font-mono text-foreground">{total}</span> 题
              </>
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={pageSize === "all" || safePage <= 1}
            onClick={() =>
              set("page", String(Math.max(1, safePage - 1)), "1")
            }
          >
            上一页
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={pageSize === "all" || safePage >= totalPages}
            onClick={() =>
              set("page", String(Math.min(totalPages, safePage + 1)), "1")
            }
          >
            下一页
          </Button>
          <Select
            value={pageSize === "all" ? "all" : String(pageSize)}
            onValueChange={(v) =>
              setMany([
                { key: "pageSize", value: v, fallback: "50" },
                { key: "page", value: "1", fallback: "1" },
              ])
            }
          >
            <SelectTrigger className="h-7 w-[96px] text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["10", "20", "50", "100", "all"].map((s) => (
                <SelectItem key={s} value={s}>
                  每页 {s === "all" ? "全部" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Bulk action footer ----------------------------------------------- */}
      {picked.size > 0 && (
        <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 gap-y-2 border-t border-border bg-accent/15 px-4 text-xs">
          <span className="text-muted-foreground">
            已选 <span className="font-mono text-foreground">{picked.size}</span> 题
          </span>
          <span className="text-border">·</span>
          {/* 去首页答题仅 agent 题:skill 题不在首页会话答,走 SkillOpt 跑 */}
          {!isSkillView && (
            <Button
              variant="default"
              size="sm"
              className="gap-1"
              onClick={() => {
                const ids = Array.from(picked);
                // 固定在新会话里答题:建/切到新会话,把选中题塞进它的 selection,再跳首页
                //(复用已有空「新对话」,不堆积空会话)。只有点这里才会把选择带去首页。
                const convId = newConversation();
                setSelectionForConv(convId, ids);
                // 固定落到「当前任务」tab —— 否则会沿用上次批量评分残留的「打分/结果」tab。
                setRightTab("current");
                navigate("/");
              }}
              title="新建一个会话，把选中的题目放进去,在这个全新会话里点「批量运行」开始作答"
            >
              去首页答题 <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {/* 自动化评测:一键 跑→评→出报告,留档到「评测运行」(skill 题走 SkillOpt,不在此) */}
          {!isSkillView && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setAutoEvalOpen(true)}
              title="对选中题一键自动化评测(答题→评分→出报告),结果留档到「评测运行」"
            >
              自动化评测
            </Button>
          )}
          <BulkAssignEmployee
            standardEmployees={configuredEmployees}
            onPick={(empId) => {
              for (const qid of picked) {
                updateQuestion(qid, { targetEmployeeId: empId ?? undefined });
              }
              showNotice({
                kind: "success",
                message: `已将 ${picked.size} 道题分配到「${labelFor(empId, standardEmployees)}」`,
              });
              setPicked(new Set());
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-destructive hover:text-destructive"
            onClick={handleBulkDelete}
          >
            <Trash2 className="h-3.5 w-3.5" /> {picked.size > 1 ? "批量删除" : "删除"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
            取消选择
          </Button>
        </div>
      )}
        </>
      )}

      {/* Sheet (detail drawer) -------------------------------------------- */}
      <QuestionDetailSheet
        question={selectedQuestion}
        onClose={() => set("selected", "", "")}
        onExpand={(id) => {
          set("selected", "", "");
          navigate(`/library/${encodeURIComponent(id)}`);
        }}
        onEdit={(q) => {
          setEditing(q);
          setFormOpen(true);
        }}
        onDelete={(q) => setDeleting(q)}
      />

      <StartEvaluationRunDialog
        open={autoEvalOpen}
        onOpenChange={setAutoEvalOpen}
        questionIds={Array.from(picked)}
      />

      <QuestionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        question={editing}
      />
      <GenerateQuestionsDialog
        open={genOpen}
        onOpenChange={(o) => {
          setGenOpen(o);
          if (!o) setGenSkill(null);
        }}
        skill={genSkill}
      />
      <GroundTruthGeneratorDialog
        open={gtGenOpen}
        onOpenChange={setGtGenOpen}
      />
      <ImportQuestionsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        bankKind={isSkillView ? "skill" : "agent"}
      />
      <ExportBankDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        kind={kindFilter}
        questions={questions}
        employeeOptions={configuredEmployees.map((e) => ({ id: e.id, name: e.name }))}
        initialCriteria={
          kindFilter === "agent"
            ? { employee, severities: sevSel, intents: intentSel }
            : { employee, caseTypes: ctSel, skills: skillSel }
        }
      />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={deleting ? `删除题目「${deleting.title}」？` : "确认删除？"}
        description="此操作不可撤销。"
        onConfirm={() => {
          if (deleting) deleteQuestion(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function Th({
  children,
  className,
  onClick,
}: {
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <th
      className={cn(
        "px-2 py-2 text-left font-medium",
        onClick && "cursor-pointer select-none hover:text-foreground",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </th>
  );
}

function Row({
  q,
  selected,
  isOpen,
  employee,
  skillView,
  onToggle,
  onOpen,
  dragging,
  dropOver,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
}: {
  q: Question;
  selected: boolean;
  isOpen: boolean;
  employee: import("@/types").StandardEmployee | undefined;
  skillView: boolean;
  onToggle: () => void;
  onOpen: () => void;
  dragging: boolean;
  dropOver: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  return (
    <tr
      draggable
      onDragStart={(e) => {
        // Required for Firefox to actually fire dragover/drop on this row.
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", q.id);
        onDragStart();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "cursor-pointer border-b border-border/50 hover:bg-muted/40",
        isOpen && "bg-accent/15",
        dragging && "opacity-40",
        dropOver && !dragging && "outline outline-2 outline-accent -outline-offset-2",
      )}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        // ignore clicks originating from the checkbox or drag-handle cells
        if (t.closest("[data-row-checkbox]")) return;
        if (t.closest("[data-row-drag]")) return;
        onOpen();
      }}
    >
      <td
        className="w-6 cursor-grab pl-2 text-muted-foreground"
        data-row-drag
        aria-label="拖拽以重排"
        title="拖拽以重排"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </td>
      <td className="pl-4" data-row-checkbox>
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label="选择" />
      </td>
      <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground">
        {q.number}
      </td>
      <td className="px-2 py-2 align-top">
        {skillView ? (
          // skill 题的 title 只是 prompt.slice(0,40) 的截断 → 直接显示完整题面,尽量多展示(超长 ... )
          <div className="line-clamp-3 break-words text-[13px] font-medium leading-snug">
            <AttachmentBadge count={q.attachments?.length ?? 0} />
            {q.prompt || q.title}
          </div>
        ) : (
          <>
            {/* agent:标题(短)尽量完整 + 题面(主题)一行,均超长 ... 截断 */}
            <div className="line-clamp-2 break-words text-[13px] font-medium leading-snug">
              {(q.tags ?? []).includes(ADAPTIVE_TAG) && (
                <span
                  className="mr-1 inline-block rounded bg-accent/15 px-1 py-px align-middle text-[9.5px] font-medium text-accent"
                  title="由自适应追问保存的多轮题"
                >
                  自适应
                </span>
              )}
              <AttachmentBadge count={q.attachments?.length ?? 0} />
              {q.title}
            </div>
            {q.prompt?.trim() && q.prompt.trim() !== q.title.trim() && (
              <div className="mt-0.5 line-clamp-2 break-words text-[11px] leading-snug text-muted-foreground">
                {q.prompt}
              </div>
            )}
          </>
        )}
      </td>
      <td className="px-2 py-2 text-[12px]">
        {q.targetEmployeeId === ALL_EMPLOYEES_ID ? (
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-4 w-4 text-foreground/70" />
            <span className="truncate">{ALL_EMPLOYEES_LABEL}</span>
          </span>
        ) : employee ? (
          <span className="inline-flex items-center gap-1.5">
            <EmployeeAvatar employee={employee} size={18} />
            <span className="truncate">{employee.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {/* skill 题:标出对应的技能,不然只见员工不知测哪个 skill */}
        {isSkillQuestion(q) && q.targetSkill && (
          <span
            className="mt-0.5 block w-fit max-w-full truncate rounded bg-muted px-1.5 py-px font-mono text-[10.5px] text-muted-foreground"
            title={`技能：${q.targetSkill}`}
          >
            {q.targetSkill}
          </span>
        )}
        {/* agent 题:名字下面挂「出题场景」chip(与 skill 同款) */}
        {!isSkillQuestion(q) && scenarioOf(q) && (
          <span
            className="mt-0.5 block w-fit max-w-full truncate rounded bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground"
            title={`场景：${scenarioOf(q)}`}
          >
            {scenarioOf(q)}
          </span>
        )}
      </td>
      {skillView ? (
        <td className="px-2 py-2">
          <span className={cn("inline-block rounded px-1.5 py-0.5 text-[11px] font-medium", skillCaseMeta(q).tone)}>
            {skillCaseMeta(q).label}
          </span>
        </td>
      ) : (
        <td className="px-2 py-2">
          {q.severity ? (
            <SeverityBadge severity={q.severity} />
          ) : (
            <span className="text-muted-foreground text-[11px]">—</span>
          )}
        </td>
      )}
      <td className="px-2 py-2 text-[11px] text-muted-foreground">
        {skillView ? (
          (() => {
            const meta = skillCaseMeta(q);
            // 有额外词表(必含/禁现)才挂悬浮(快、带样式);否则可见文字已说清,纯文本。
            return meta.tip !== meta.detail ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block max-w-full cursor-help truncate underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">
                    {meta.detail}
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="left"
                  className="max-w-xs whitespace-pre-line text-[11px] leading-relaxed"
                >
                  {meta.tip}
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="block max-w-full truncate">{meta.detail}</span>
            );
          })()
        ) : q.intent ? (
          <span
            className={cn(
              "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium",
              INTENT_BADGE[q.intent].tone,
            )}
          >
            {INTENT_BADGE[q.intent].label}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-2">
        <DifficultyBadge value={q.difficulty} />
      </td>
      <td className="px-2 py-2 text-[11px] text-muted-foreground">
        {new Date(q.createdAt).toLocaleDateString()}
      </td>
    </tr>
  );
}

/** 标题旁的附件标识:有附件才显示,回形针 + 数量,悬浮说明「随题发送」。 */
function AttachmentBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="mr-1 inline-flex items-center gap-0.5 rounded bg-accent/15 px-1 py-px align-middle text-[9.5px] font-medium text-accent"
      title={`${count} 个附件 · 运行本题时随题面一起发送给 agent`}
    >
      <Paperclip className="h-2.5 w-2.5" />
      {count}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: QuestionSeverity }) {
  const cls: Record<QuestionSeverity, string> = {
    P0: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    P1: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    P2: "bg-muted/40 text-muted-foreground",
  };
  return (
    <span className={cn("inline-block rounded px-1.5 py-0.5 text-[11px] font-medium", cls[severity])}>
      {severity}
    </span>
  );
}

/** 胶囊式库切换(Agent / Skill),选中填色,各自计数贴在标签上。 */
function BankPill({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
        active ? "bg-accent text-accent-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-px text-[10px] tabular-nums",
          active ? "bg-accent-foreground/20" : "bg-muted",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ViewBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 text-[11.5px] transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-secondary",
      )}
    >
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}

/**
 * Bulk "分配给员工" popover. Lets the user remap targetEmployeeId for every
 * selected question in one click. Options:
 *   - 未指定  (clears targetEmployeeId)
 *   - 全体员工 (sets to ALL_EMPLOYEES_ID — applies to all agents)
 *   - 每位标准员工
 */
function BulkAssignEmployee({
  standardEmployees,
  onPick,
}: {
  standardEmployees: ReturnType<typeof useQAStore>["standardEmployees"];
  onPick: (empId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1">
          <Users className="h-3.5 w-3.5" /> 分配员工
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-1.5">
        <button
          type="button"
          onClick={() => {
            onPick(null);
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-accent/30"
        >
          — 未指定 —
        </button>
        <button
          type="button"
          onClick={() => {
            onPick(ALL_EMPLOYEES_ID);
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent/30"
        >
          <Users className="h-3.5 w-3.5 text-foreground/70" />
          {ALL_EMPLOYEES_LABEL}
        </button>
        <div className="my-1 border-t border-border" />
        {standardEmployees.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => {
              onPick(e.id);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent/30"
          >
            <EmployeeAvatar employee={e} size={18} />
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
          </button>
        ))}
        {standardEmployees.length === 0 && (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
            还没配置 agent，先去「员工」里关联
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Display label for the picked employee id (used in success notice). */
function labelFor(
  empId: string | null,
  standardEmployees: ReturnType<typeof useQAStore>["standardEmployees"],
): string {
  if (!empId) return "未指定";
  if (empId === ALL_EMPLOYEES_ID) return ALL_EMPLOYEES_LABEL;
  return standardEmployees.find((e) => e.id === empId)?.name ?? empId;
}
