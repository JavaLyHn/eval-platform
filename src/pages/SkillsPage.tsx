/**
 * Full-screen skills page at /skills.
 *
 * Shows every standard employee's Platform skills in a responsive card grid.
 * Mirrors LibraryPage's shell (back link + header + scrollable body).
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Boxes, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { useQAStore } from "@/hooks/use-qa-store";
import { STANDARD_EMPLOYEES } from "@/lib/standard-employees";
import { GATEWAY_EMPLOYEES } from "@/lib/extended-employees";
import { hasBundledSkills, loadBundledSkills } from "@/lib/bundled-skills";
import { api } from "@/lib/api";
import type { PlatformSkill } from "@/types";

/** 展示用员工全集 = 标准线 + Gateway 扩展员工(与「员工」页同口径)。 */
const ALL_EMPLOYEES = [...STANDARD_EMPLOYEES, ...GATEWAY_EMPLOYEES];

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type EmpState =
  | { state: "loading"; skills: PlatformSkill[] }
  | { state: "ok"; skills: PlatformSkill[] }
  | { state: "error"; skills: PlatformSkill[]; detail?: string }
  | { state: "unconfigured"; skills: PlatformSkill[] };

/* -------------------------------------------------------------------------- */
/* SkillsPage                                                                  */
/* -------------------------------------------------------------------------- */

export function SkillsPage() {
  const { employeeProfileMap, profiles, configuredEmployeeIds } = useQAStore();

  const configuredEmployees = useMemo(
    () => ALL_EMPLOYEES.filter((e) => configuredEmployeeIds.includes(e.id)),
    [configuredEmployeeIds],
  );

  const [byEmp, setByEmp] = useState<Record<string, EmpState>>({});

  /** Resolve the platform instanceId for a standard employee. */
  const instanceIdForEmployee = useCallback(
    (employeeId: string): string | undefined => {
      const emp = ALL_EMPLOYEES.find((e) => e.id === employeeId);
      if (!emp) return undefined;
      const bound = employeeProfileMap[emp.id] ?? emp.associatedProfileId;
      const prof = bound ? profiles.find((p) => p.id === bound) : undefined;
      const iid = (prof?.config as Record<string, unknown> | undefined)
        ?.instanceId;
      return typeof iid === "string" && iid ? iid : undefined;
    },
    [employeeProfileMap, profiles],
  );

  /**
   * 加载单个员工的技能:有内置技能集的(如 Dex / gateway)走 loadBundledSkills
   * (从 ai-skills-library 解析的静态数据),否则走 platform live API。
   */
  const loadEmp = useCallback(
    async (employeeId: string): Promise<EmpState> => {
      if (hasBundledSkills(employeeId)) {
        try {
          const skills = await loadBundledSkills(employeeId);
          return {
            state: "ok",
            skills: skills.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              isCommon: s.category === "通用",
            })),
          };
        } catch (e) {
          return {
            state: "error",
            skills: [],
            detail: e instanceof Error ? e.message : String(e),
          };
        }
      }
      const instanceId = instanceIdForEmployee(employeeId);
      if (!instanceId) return { state: "unconfigured", skills: [] };
      try {
        const res = await api.platform.skills({ instanceId });
        return res.ok
          ? { state: "ok", skills: res.skills }
          : {
              state: "error",
              skills: [],
              detail: res.detail ?? "接口返回 ok:false",
            };
      } catch (e) {
        return {
          state: "error",
          skills: [],
          detail: e instanceof Error ? e.message : String(e),
        };
      }
    },
    [instanceIdForEmployee],
  );

  const loadAll = useCallback(async () => {
    // 先同步标记:有内置技能或有 platform instanceId → loading,否则 unconfigured。
    const initial: Record<string, EmpState> = {};
    for (const emp of configuredEmployees) {
      const pending = hasBundledSkills(emp.id) || !!instanceIdForEmployee(emp.id);
      initial[emp.id] = pending
        ? { state: "loading", skills: [] }
        : { state: "unconfigured", skills: [] };
    }
    setByEmp(initial);

    await Promise.allSettled(
      configuredEmployees.map(async (emp) => {
        if (!hasBundledSkills(emp.id) && !instanceIdForEmployee(emp.id)) return;
        const next = await loadEmp(emp.id);
        setByEmp((prev) => ({ ...prev, [emp.id]: next }));
      }),
    );
  }, [loadEmp, instanceIdForEmployee, configuredEmployees]);

  // Load on mount
  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <Link
          to="/"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="返回评测中心"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex flex-1 items-center gap-2 min-w-0">
          <Boxes className="h-5 w-5 shrink-0 text-muted-foreground" />
          <h1 className="text-base font-semibold tracking-tight truncate">技能</h1>
          <span className="text-[12px] text-muted-foreground hidden sm:inline">
            — 所有已配置员工的技能（Platform / Gateway）
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-[12.5px]"
          onClick={() => void loadAll()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
      </header>

      {/* ── Body ── */}
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-5">
          {configuredEmployees.length === 0 && (
            <div className="py-12 text-center text-[13px] text-muted-foreground">
              还没配置 agent，先去「员工」里关联
            </div>
          )}
          {configuredEmployees.map((emp) => {
            const empState = byEmp[emp.id];
            return (
              <EmployeeSection
                key={emp.id}
                employee={emp}
                empState={empState}
                onRetry={() => {
                  if (!hasBundledSkills(emp.id) && !instanceIdForEmployee(emp.id))
                    return;
                  setByEmp((prev) => ({
                    ...prev,
                    [emp.id]: { state: "loading", skills: [] },
                  }));
                  void loadEmp(emp.id).then((next) =>
                    setByEmp((prev) => ({ ...prev, [emp.id]: next })),
                  );
                }}
              />
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* EmployeeSection                                                              */
/* -------------------------------------------------------------------------- */

interface EmployeeLike {
  id: string;
  name: string;
  title: string;
  avatar?: string;
  avatarUrl?: string;
  associatedProfileId?: string;
}

function EmployeeSection({
  employee,
  empState,
  onRetry,
}: {
  employee: EmployeeLike;
  empState: EmpState | undefined;
  onRetry: () => void;
}) {
  const isLoading = empState?.state === "loading";
  const isUnconfigured = !empState || empState.state === "unconfigured";
  const isError = empState?.state === "error";
  const isOk = empState?.state === "ok";
  const skills = empState?.skills ?? [];
  // 默认折叠;点击区头展开。
  const [collapsed, setCollapsed] = useState(true);

  return (
    <section className="rounded-lg border border-border bg-card">
      {/* Section header row — click to collapse/expand */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/30",
          !collapsed && "border-b border-border",
        )}
      >
        <span className="shrink-0 text-muted-foreground">
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
        <EmployeeAvatar employee={employee} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-foreground">
              {employee.name}
            </span>
            <span className="text-[12px] text-muted-foreground truncate">
              {employee.title}
            </span>
          </div>
        </div>
        {/* Right side: count / status (visible even when collapsed) */}
        <div className="shrink-0 text-[12px] text-muted-foreground">
          {isLoading && (
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="h-3 w-3 animate-spin" />
              加载中
            </span>
          )}
          {isUnconfigured && (
            <span className="text-muted-foreground/60">未配置 agent</span>
          )}
          {isError && (
            <span className="text-destructive text-[11.5px]">拉取失败</span>
          )}
          {isOk && (
            <span className="font-medium text-foreground/80">
              {skills.length} 个技能
            </span>
          )}
        </div>
      </button>

      {/* Section body — only when expanded */}
      {!collapsed && (
        <div className="p-4">
        {/* Unconfigured */}
        {isUnconfigured && (
          <p className="text-[12.5px] text-muted-foreground/60">
            未配置 agent（无 skill）
          </p>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            正在拉取技能…
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="flex flex-col gap-2">
            <p
              className="text-[12.5px] text-destructive"
              title={
                empState && "detail" in empState ? empState.detail : undefined
              }
            >
              ⚠ 拉取失败
              {empState && "detail" in empState && empState.detail
                ? `：${empState.detail.slice(0, 80)}`
                : ""}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-fit gap-1.5 text-[12px]"
              onClick={onRetry}
            >
              <RefreshCw className="h-3 w-3" />
              重试
            </Button>
          </div>
        )}

        {/* Empty (ok but 0 skills) */}
        {isOk && skills.length === 0 && (
          <p className="text-[12.5px] text-muted-foreground">暂无技能</p>
        )}

        {/* Skill cards grid */}
        {isOk && skills.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {skills.map((skill) => (
              <SkillCard key={skill.id} skill={skill} />
            ))}
          </div>
        )}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* SkillCard                                                                   */
/* -------------------------------------------------------------------------- */

function SkillCard({ skill }: { skill: PlatformSkill }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-background p-3 hover:bg-secondary/30 transition-colors">
      {/* Name row */}
      <div className="flex min-w-0 items-center gap-1.5 flex-wrap">
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground"
          title={skill.name}
        >
          {skill.name}
        </span>
        {skill.version && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            v{skill.version}
          </span>
        )}
        {skill.isCommon && (
          <Badge
            variant="muted"
            className="shrink-0 px-1.5 py-0 text-[10px] h-4"
          >
            通用
          </Badge>
        )}
      </div>
      {/* Description（可展开全文）*/}
      {skill.description && (
        <>
          <p
            className={cn(
              "text-[11.5px] text-muted-foreground leading-relaxed whitespace-pre-wrap",
              !expanded && "line-clamp-2",
            )}
          >
            {skill.description}
          </p>
          {skill.description.length > 60 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="self-start text-[11px] text-accent hover:underline"
            >
              {expanded ? "收起" : "展开全文"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
