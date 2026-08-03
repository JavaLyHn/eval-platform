/**
 * Compact in-place question picker used by the empty state of "当前任务".
 *
 * Mirrors the search + employee filter from /library but in a narrow column
 * (~360px). Picking a row calls setSelectedQuestion, which causes the parent
 * tab to flip into the question-detail layout automatically.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eraser, Library, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { isSkillQuestion } from "@/lib/skill-question";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";
import type { Question, QuestionSeverity } from "@/types";

export function QuestionPickerInline() {
  const { questions, standardEmployees, setSelectedQuestion, clearMessages } =
    useQAStore();

  const [query, setQuery] = useState("");
  const [employee, setEmployee] = useState<string>("all");
  const [confirmingClear, setConfirmingClear] = useState<Question | null>(null);

  const filtered = useMemo(() => {
    const out = questions.filter((q) => {
      if (isSkillQuestion(q)) return false; // 技能题只用于 Skill 评测,不进选题器
      if (employee !== "all" && q.targetEmployeeId !== employee) return false;
      if (query) {
        const needle = query.toLowerCase();
        const cats = Array.isArray(q.categories) ? q.categories : [];
        const hay = [q.number, q.title, ...cats, ...q.tags].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    // newest first
    out.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return out;
  }, [questions, query, employee]);

  if (questions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="rounded-full bg-muted p-3 text-muted-foreground">
          <Library className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium">题库为空</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          先去题库新建题目，或导入 JSON / CSV。
        </p>
        <Link to="/library">
          <Button size="sm" variant="outline" className="gap-1">
            <Library className="h-3.5 w-3.5" /> 进入题库
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {/* Header line */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          挑一道题开始测试 ·{" "}
          <span className="font-mono text-foreground">{filtered.length}</span>
          {filtered.length !== questions.length && (
            <span className="text-muted-foreground"> / {questions.length}</span>
          )}
        </span>
        <Link
          to="/library"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
        >
          <Library className="h-3 w-3" /> 完整题库
        </Link>
      </div>

      {/* Search + filter */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索题号 / 标题 / 标签"
            className="h-8 pl-8 text-[12.5px]"
          />
        </div>
        <Select value={employee} onValueChange={setEmployee}>
          <SelectTrigger className="h-8 w-[120px] text-[11.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部员工</SelectItem>
            {standardEmployees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                <span className="inline-flex items-center gap-1.5">
                  <EmployeeAvatar employee={e} size={16} />
                  {e.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <ScrollArea className="-mx-1 flex-1 min-h-0">
        {filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            没有匹配的题目
          </div>
        ) : (
          <ul className="space-y-1 px-1 pb-2">
            {filtered.map((q) => (
              <li key={q.id}>
                <div className="flex items-stretch rounded-md border border-border bg-card transition-colors hover:border-accent/50">
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-l-md px-2.5 py-2 text-left transition-colors hover:bg-accent/30 focus:outline-none focus-visible:bg-accent/30"
                    onClick={() => setSelectedQuestion(q.id)}
                  >
                    <PickerRow
                      q={q}
                      employee={
                        standardEmployees.find((e) => e.id === q.targetEmployeeId) ??
                        null
                      }
                    />
                  </button>
                  <button
                    type="button"
                    title="清空当前会话再答此题（避免上下文干扰）"
                    aria-label="清空会话并答此题"
                    className="flex shrink-0 items-center justify-center rounded-r-md border-l border-border px-2 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus:outline-none focus-visible:bg-accent/40 focus-visible:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingClear(q);
                    }}
                  >
                    <Eraser className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <ConfirmDeleteDialog
        open={!!confirmingClear}
        onOpenChange={(o) => !o && setConfirmingClear(null)}
        title="清空当前会话并答此题？"
        description={
          confirmingClear
            ? `「${confirmingClear.title}」将在新的空白上下文里开始答题。当前会话的历史消息会被清空（题库中的题目和历史评测记录不受影响）。`
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

function PickerRow({
  q,
  employee,
}: {
  q: Question;
  employee: { name?: string; avatar?: string; avatarUrl?: string } | null;
}) {
  return (
    <>
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
          {q.number}
        </span>
        <span className="truncate font-medium">{q.title}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground">
        {employee?.name && (
          <span className="inline-flex items-center gap-1">
            <EmployeeAvatar employee={employee} size={12} />
            {employee.name}
          </span>
        )}
        {q.severity && (
          <span className="text-border">·</span>
        )}
        {q.severity && <SeverityPill severity={q.severity} />}
        {q.intent && (
          <>
            <span className="text-border">·</span>
            <span>{q.intent}</span>
          </>
        )}
      </div>
    </>
  );
}

function SeverityPill({ severity }: { severity: QuestionSeverity }) {
  const cls: Record<QuestionSeverity, string> = {
    P0: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    P1: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    P2: "bg-muted/40 text-muted-foreground",
  };
  return (
    <span className={cn("rounded px-1 text-[10px] font-medium", cls[severity])}>
      {severity}
    </span>
  );
}
