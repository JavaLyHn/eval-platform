/**
 * Full list of generated evaluation reports —— agent 评测 + Skill 评测 并列。
 *
 *   /reports
 *
 * 行点击:agent → /reports/:id;skill → /skill-reports/:id。
 */

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDownUp, ArrowDown, ArrowUp, FileText, Search, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HomeButton } from "@/components/home-button";
import { HeaderIconBadge } from "@/components/header-icon-badge";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { resolveEmployeeForProfile } from "@/lib/employee-resolve";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn, formatRelativeTime } from "@/lib/utils";
import { reportVisibleTo } from "@/lib/report-visibility";
import { skillReportStats } from "@/lib/skill-report";
import type { EvaluationReport } from "@/types";
import type { SkillEvalReport } from "@/lib/skill-report";

type SortField = "created" | "title";
type SortDir = "asc" | "desc";
type TypeFilter = "all" | "agent" | "skill";

type Row =
  | { kind: "agent"; id: string; createdAt: string; title: string; report: EvaluationReport }
  | { kind: "skill"; id: string; createdAt: string; title: string; report: SkillEvalReport };

const softFmt = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

function agentStats(r: EvaluationReport) {
  const passed = r.items.filter((i) => i.verdict === "passed").length;
  const scored = r.items.filter((i) => typeof i.autoScore === "number");
  const avg = scored.length > 0 ? scored.reduce((s, i) => s + (i.autoScore ?? 0), 0) / scored.length : 0;
  return { passed, total: r.items.length, rate: r.items.length > 0 ? (passed / r.items.length) * 100 : 0, avg, scored: scored.length };
}

export function ReportsListPage() {
  const {
    reports: allReports, skillReports: allSkillReports,
    deleteReport, deleteSkillReport,
    user, profiles, standardEmployees, employeeProfileMap,
  } = useQAStore();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortField, setSortField] = useState<SortField>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  // 多选批量删除(与题库同款):key = `${kind}:${id}`(agent / skill 报告 id 可能撞)。
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const navigate = useNavigate();

  const keyOf = (row: Row) => `${row.kind}:${row.id}`;

  const rows = useMemo<Row[]>(() => {
    const agentRows: Row[] = allReports
      .filter((r) => reportVisibleTo(r, user))
      .map((r) => ({ kind: "agent" as const, id: r.id, createdAt: r.createdAt, title: r.title, report: r }));
    const skillRows: Row[] = allSkillReports
      .filter((r) => reportVisibleTo(r, user))
      .map((r) => ({ kind: "skill" as const, id: r.id, createdAt: r.createdAt, title: r.title, report: r }));
    return [...agentRows, ...skillRows];
  }, [allReports, allSkillReports, user]);

  const agentCount = rows.filter((r) => r.kind === "agent").length;
  const skillCount = rows.length - agentCount;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (typeFilter !== "all" && row.kind !== typeFilter) return false;
        if (!needle) return true;
        const hay = row.kind === "agent"
          ? [row.title, row.report.agentName].join(" ")
          : [row.title, row.report.meta.targetLabel].join(" ");
        return hay.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        const sign = sortDir === "asc" ? 1 : -1;
        if (sortField === "title") return sign * a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
        return sign * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) || a.id.localeCompare(b.id);
      });
  }, [rows, query, typeFilter, sortField, sortDir]);

  /* ----- selection(已删除的报告自动不计入) ----- */
  const selectedRows = useMemo(
    () => rows.filter((r) => selection.has(keyOf(r))),
    [rows, selection],
  );
  const visibleKeys = filtered.map(keyOf);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selection.has(k));
  const someVisibleSelected = visibleKeys.some((k) => selection.has(k)) && !allVisibleSelected;
  const toggleSelectAll = () => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleKeys.forEach((k) => next.delete(k));
      else visibleKeys.forEach((k) => next.add(k));
      return next;
    });
  };
  const toggleOne = (k: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const bulkDelete = () => {
    for (const row of selectedRows) {
      if (row.kind === "agent") deleteReport(row.id);
      else deleteSkillReport(row.id);
    }
    setSelection(new Set());
    setBulkConfirm(false);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };
  const sortIcon = (field: SortField) =>
    sortField !== field ? <ArrowDownUp className="h-3 w-3 text-muted-foreground/50" />
      : sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
        <HomeButton />
        <h1 className="inline-flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <HeaderIconBadge icon={FileText} /> 评测报告
        </h1>
        <Badge variant="muted" className="text-[10.5px]">{rows.length}</Badge>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface/40 px-4 py-2">
        <div className="relative w-full md:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题 / 被测对象..." className="h-8 pl-8 text-[13px]" />
        </div>
        <div className="inline-flex rounded-md border border-border p-0.5 text-[12px]">
          {(
            [
              { key: "all", label: `全部 ${rows.length}` },
              { key: "agent", label: `Agent ${agentCount}` },
              { key: "skill", label: `Skills ${skillCount}` },
            ] as { key: TypeFilter; label: string }[]
          ).map((seg) => (
            <button
              key={seg.key}
              type="button"
              onClick={() => setTypeFilter(seg.key)}
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                typeFilter === seg.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {seg.label}
            </button>
          ))}
        </div>
        {(query || typeFilter !== "all") && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => { setQuery(""); setTypeFilter("all"); }}>
            清除筛选
          </Button>
        )}
        {selectedRows.length > 0 && (
          <>
            <span className="text-[11.5px] text-muted-foreground">
              已选 <span className="font-mono text-foreground">{selectedRows.length}</span> 份
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs text-destructive hover:bg-destructive/10"
              onClick={() => setBulkConfirm(true)}
            >
              <Trash2 className="h-3 w-3" /> 删除所选
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => setSelection(new Set())}
            >
              取消选择
            </Button>
          </>
        )}
        <div className="ml-auto text-[11px] text-muted-foreground">
          共 <span className="font-mono text-foreground">{filtered.length}</span> / {rows.length} 份
        </div>
      </div>

      <ScrollArea horizontal className="flex-1 min-h-0">
        {rows.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center text-[12.5px] text-muted-foreground">没有匹配的报告</div>
        ) : (
          // min-w 只在手机:6 个固定列加起来约 648px,不给下限会被压成「挤+换行」而非横滑
          <table className="w-full min-w-[680px] text-[13px] md:min-w-0">
            <thead className="sticky top-0 z-10 bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <Th className="w-8 pl-4">
                  <Checkbox
                    checked={
                      allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false
                    }
                    onCheckedChange={toggleSelectAll}
                    aria-label="全选"
                  />
                </Th>
                <Th onClick={() => toggleSort("title")}><span className="inline-flex items-center gap-1">标题 {sortIcon("title")}</span></Th>
                <Th className="w-20">类型</Th>
                <Th className="w-40">被测对象</Th>
                <Th className="w-56">关键指标</Th>
                <Th className="w-28" onClick={() => toggleSort("created")}><span className="inline-flex items-center gap-1">生成时间 {sortIcon("created")}</span></Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const href = row.kind === "agent" ? `/reports/${encodeURIComponent(row.id)}` : `/skill-reports/${encodeURIComponent(row.id)}`;
                return (
                  <tr
                    key={`${row.kind}:${row.id}`}
                    className="cursor-pointer border-b border-border/50 hover:bg-muted/40"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("[data-row-action]")) return;
                      navigate(href);
                    }}
                  >
                    <td className="pl-4" data-row-action>
                      <Checkbox
                        checked={selection.has(keyOf(row))}
                        onCheckedChange={() => toggleOne(keyOf(row))}
                        aria-label="选择"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Link to={href} className="truncate font-medium text-foreground hover:underline">{row.title}</Link>
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge variant={row.kind === "skill" ? "accent" : "muted"} className="text-[10px]">
                        {row.kind === "skill" ? "Skill" : "Agent"}
                      </Badge>
                    </td>
                    <td className="px-2 py-2.5 text-[12.5px]">
                      {row.kind === "agent" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <EmployeeAvatar employee={resolveEmployeeForProfile(row.report.agentProfileId, profiles, standardEmployees, employeeProfileMap)} size={18} />
                          <span className="truncate">{row.report.agentName}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {/* skill 报告归属的员工头像:用 meta.employeeLabel(= 员工 name)解析,
                              targetLabel 是「xxx 题集」技能名,拿来匹配员工名永远落空 → 通用图标。 */}
                          <EmployeeAvatar employee={standardEmployees.find((e) => e.name === row.report.meta.employeeLabel)} size={18} />
                          <span className="truncate">{row.report.meta.targetLabel}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {row.kind === "agent" ? <AgentMetric report={row.report} /> : <SkillMetric report={row.report} />}
                    </td>
                    <td className="px-2 py-2.5 text-[11px] text-muted-foreground">
                      <span title={new Date(row.createdAt).toLocaleString()}>{formatRelativeTime(row.createdAt)}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right" data-row-action>
                      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(row); }} title="删除报告" aria-label="删除报告">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ScrollArea>

      <ConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={pendingDelete ? `删除报告「${pendingDelete.title}」？` : "确认删除？"}
        description="操作不可撤销。报告是只读快照,删除不影响底层题目 / 回答 / 评分 / skill。"
        onConfirm={() => {
          if (pendingDelete) {
            if (pendingDelete.kind === "agent") deleteReport(pendingDelete.id);
            else deleteSkillReport(pendingDelete.id);
            setSelection((prev) => {
              const next = new Set(prev);
              next.delete(keyOf(pendingDelete));
              return next;
            });
          }
          setPendingDelete(null);
        }}
      />

      <ConfirmDeleteDialog
        open={bulkConfirm}
        onOpenChange={(o) => { if (!o) setBulkConfirm(false); }}
        title={`删除所选 ${selectedRows.length} 份报告？`}
        description="操作不可撤销。报告是只读快照,删除不影响底层题目 / 回答 / 评分 / skill。"
        onConfirm={bulkDelete}
      />
    </div>
  );
}

function AgentMetric({ report }: { report: EvaluationReport }) {
  const s = agentStats(report);
  if (s.total === 0) return <span className="text-[11px] text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px]">
      <span className={cn("font-mono tabular-nums", s.rate >= 70 ? "text-success" : s.rate >= 40 ? "text-foreground" : "text-destructive")}>
        通过 {s.rate.toFixed(0)}% <span className="text-[10.5px] text-muted-foreground">{s.passed}/{s.total}</span>
      </span>
      <span className="text-muted-foreground">均分 {s.scored > 0 ? s.avg.toFixed(2) : "—"}</span>
    </div>
  );
}

function SkillMetric({ report }: { report: SkillEvalReport }) {
  const st = skillReportStats(report);
  const hasSoft = st.baselineSoft != null || st.bestSoft != null;
  if (!hasSoft && st.total === 0) {
    return <span className="text-[11px] text-muted-foreground">未评留出集</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
      {hasSoft && (
        <span className="text-muted-foreground">留出 soft {softFmt(st.baselineSoft)}→<span className="font-medium text-foreground">{softFmt(st.bestSoft)}</span></span>
      )}
      {st.total > 0 && <span className="text-muted-foreground">通过 {st.passN}/{st.total}</span>}
    </div>
  );
}

function Th({ children, className, onClick }: { children?: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <th onClick={onClick} className={cn("px-2 py-2 text-left font-medium", onClick && "cursor-pointer select-none hover:text-foreground", className)}>
      {children}
    </th>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="rounded-full bg-muted p-3"><FileText className="h-6 w-6 text-muted-foreground" /></div>
      <h2 className="text-[14px] font-semibold text-foreground">还没生成过报告</h2>
      <p className="max-w-[360px] text-[12px] text-muted-foreground">
        Agent 评测报告到「数据看板」点「生成报告」;Skill 评测报告到「Skill 评测」跑完点「保存为报告」。
      </p>
    </div>
  );
}
