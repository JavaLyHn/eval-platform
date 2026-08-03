import {
  Ban,
  BookOpen,
  Bot,
  Briefcase,
  ChevronRight,
  Inbox,
  Lightbulb,
  Pencil,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FloorEmployeeDialog } from "@/components/floor/floor-employee-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { useQAStore } from "@/hooks/use-qa-store";
import { api } from "@/lib/api";
import { standardIdToRepoEmp } from "@/lib/agent-repo-compare";
import { hasBundledSkills, loadBundledSkills } from "@/lib/bundled-skills";
import type { AgentRepoSkillSummary } from "@/lib/agent-repo";
import { getProfileKind } from "@/agents/registry";
import { resolveEmployeeMetrics, type ResolvedMetric } from "@/lib/employee-metrics";
import { agentMatchesEmployee } from "@/lib/employee-resolve";
import { MetricEditorDialog } from "./metric-editor-dialog";
import type {
  EmployeeMetricsOverlay,
  EmployeeSourceProfile,
  StandardEmployee,
} from "@/types";

/**
 * 预置标准 AI 员工档案列表 — 评测平台的"被测对象画像"。
 *
 * 数据来自 STANDARD_EMPLOYEES（预置）。每张卡片展示：
 *   - 头像 / 名字 / 职能定位 / 自治等级
 *   - 服务对象 + 关联 profile 状态
 *   - 2-3 项专属指标模板
 *   - 可展开看核心任务 / I/O 形态 / 不在范围内的事 / 下游
 */
export function EmployeesTab() {
  const {
    standardEmployees,
    profiles,
    employeeProfileMap,
    setEmployeeProfile,
    employeeMetrics,
    agentRepoVersion,
    configuredEmployeeIds,
  } = useQAStore();

  const configuredEmployees = useMemo(
    () => standardEmployees.filter((e) => configuredEmployeeIds.includes(e.id)),
    [standardEmployees, configuredEmployeeIds],
  );
  // 各员工在 agent-defs 仓里的「实时技能列表」(同步后随 agentRepoVersion 重取,不用旧缓存)。
  const [repoSkills, setRepoSkills] = useState<Record<string, AgentRepoSkillSummary[]>>({});
  const [repoSkillsLoading, setRepoSkillsLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setRepoSkillsLoading(true);
    Promise.all(
      configuredEmployees.map(async (e): Promise<readonly [string, AgentRepoSkillSummary[]]> => {
        // 扩展员工(如 Dex / dex):用内置技能集(从 ai-skills-library 解析),
        // 没有 agent-defs 仓目录可拉;映射成 {name, description} 复用同一块渲染。
        if (hasBundledSkills(e.id)) {
          try {
            const skills = await loadBundledSkills(e.id);
            return [
              e.id,
              skills.map((s) => ({
                name: s.name,
                description: s.description ?? "",
                version: null,
              })),
            ];
          } catch {
            return [e.id, []];
          }
        }
        // 标准线:从 agent-defs 仓实时拉。
        const dir = standardIdToRepoEmp(e.id);
        if (!dir) return [e.id, []];
        try {
          const r = await api.agentRepo.employee(dir);
          return [e.id, r.ok ? r.skills : []];
        } catch {
          return [e.id, []];
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      setRepoSkills(Object.fromEntries(entries));
      setRepoSkillsLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [agentRepoVersion, configuredEmployees]);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [floorFor, setFloorFor] = useState<{
    id: string;
    name: string;
    tab: "checklist" | "report";
  } | null>(null);
  const [metricFor, setMetricFor] = useState<string | null>(null);
  const agentProfiles = useMemo(
    () => profiles.filter((p) => getProfileKind(p.providerId) === "agent"),
    [profiles],
  );

  // 员工一旦显示(=存在已验证 verified 的同名 agent),自动把该 agent 关联到它的
  // 「关联 Agent」——免手动再选。仅在「从未显式设过」时自动绑(undefined);用户显式
  // 绑定/解绑(键已存在,含 null)或员工内置 associatedProfileId 一律尊重。自收敛:
  // 绑定后 `emp.id in employeeProfileMap` 成立 → 不再触发,只跑一次。
  useEffect(() => {
    for (const emp of configuredEmployees) {
      if (emp.id in employeeProfileMap) continue;
      if (emp.associatedProfileId) continue;
      const match = agentProfiles.find(
        (p) => p.verified && agentMatchesEmployee(p, emp),
      );
      if (match) setEmployeeProfile(emp.id, match.id);
    }
  }, [configuredEmployees, employeeProfileMap, agentProfiles, setEmployeeProfile]);

  const detailEmployee = detailFor
    ? standardEmployees.find((e) => e.id === detailFor) ?? null
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ScrollArea className="-mx-1 flex-1">
        <ul className="grid grid-cols-1 gap-2 px-1 pb-2 sm:grid-cols-2">
          {configuredEmployees.map((emp) => (
            <EmployeeCard
              key={emp.id}
              employee={emp}
              repoSkills={repoSkills[emp.id] ?? []}
              repoSkillsLoading={repoSkillsLoading}
              onOpenDetail={() => setDetailFor(emp.id)}
              linkedProfileId={
                employeeProfileMap[emp.id] ?? emp.associatedProfileId ?? null
              }
              agentProfiles={agentProfiles}
              onLink={(id) => setEmployeeProfile(emp.id, id)}
              onOpenFloor={(tab) =>
                setFloorFor({ id: emp.id, name: emp.name, tab })
              }
            />
          ))}
        </ul>
        {configuredEmployees.length === 0 && (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-[12px] text-muted-foreground">
            还没有为任何员工配置 agent。去左侧导航「Agent 管理」添加 / 关联 Agent 后,这里才会显示。
          </div>
        )}
      </ScrollArea>
      {detailEmployee && (
        <EmployeeDetailDialog
          employee={detailEmployee}
          repoSkills={repoSkills[detailEmployee.id] ?? []}
          repoSkillsLoading={repoSkillsLoading}
          metricOverlay={employeeMetrics[detailEmployee.id]}
          open={!!detailEmployee}
          onOpenChange={(o) => !o && setDetailFor(null)}
          onEditMetrics={() => {
            // 从详情弹窗进入指标编辑:先关详情,避免双层弹窗
            setMetricFor(detailEmployee.id);
            setDetailFor(null);
          }}
        />
      )}
      {floorFor && (
        <FloorEmployeeDialog
          employeeId={floorFor.id}
          employeeName={floorFor.name}
          initialTab={floorFor.tab}
          open={!!floorFor}
          onOpenChange={(o) => !o && setFloorFor(null)}
        />
      )}
      {metricFor && (
        <MetricEditorDialog
          employeeId={metricFor}
          open={!!metricFor}
          onOpenChange={(o) => !o && setMetricFor(null)}
        />
      )}
    </div>
  );
}

/* ============================== Sub-components ============================ */

/** persona 首句(到第一个句号),用于卡片预览,避免整段铺满。 */
function firstSentence(text: string): string {
  const i = text.indexOf("。");
  return i >= 0 ? text.slice(0, i + 1) : text;
}

/** 取专长条目冒号前的短标签(如「用户增长:…」→「用户增长」),用于 chip。 */
function expertiseLabel(text: string): string {
  return text.split(/[：:]/)[0].trim();
}

/** 仓库技能徽标(加载/空/列表三态);max 控制最多展示几个,其余折成「+N」。 */
function RepoSkillBadges({
  skills,
  loading,
  max = 8,
}: {
  skills: AgentRepoSkillSummary[];
  loading: boolean;
  max?: number;
}) {
  if (loading) return <p className="text-[10.5px] text-muted-foreground/70">加载中…</p>;
  if (skills.length === 0)
    return <p className="text-[10.5px] text-muted-foreground/70">仓库未读到技能</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {skills.slice(0, max).map((s) => (
        <Badge
          key={s.name}
          variant="outline"
          className="max-w-full truncate text-[10px]"
          title={s.description || s.name}
        >
          {s.name}
        </Badge>
      ))}
      {skills.length > max && (
        <span className="text-[10px] text-muted-foreground">+{skills.length - max}</span>
      )}
    </div>
  );
}

/** 卡片上的「仓库技能(实时)」块 — 来自同步后的 agent-defs 仓,技能源同步后随之刷新。 */
function RepoSkillsBlock({
  skills,
  loading,
}: {
  skills: AgentRepoSkillSummary[];
  loading: boolean;
}) {
  return (
    <div className="border-t border-border px-3 py-2">
      <div className="mb-1 flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
        <Sparkles className="h-2.5 w-2.5" />
        仓库技能
        {!loading && <span className="tabular-nums">· {skills.length}</span>}
        <span className="font-normal text-muted-foreground/70">· 随技能源同步</span>
      </div>
      <RepoSkillBadges skills={skills} loading={loading} />
    </div>
  );
}

function EmployeeCard({
  employee,
  repoSkills,
  repoSkillsLoading,
  onOpenDetail,
  linkedProfileId,
  agentProfiles,
  onLink,
  onOpenFloor,
}: {
  employee: StandardEmployee;
  repoSkills: AgentRepoSkillSummary[];
  repoSkillsLoading: boolean;
  onOpenDetail: () => void;
  linkedProfileId: string | null;
  agentProfiles: Array<{ id: string; name: string; providerId: string }>;
  onLink: (profileId: string | null) => void;
  onOpenFloor?: (tab: "checklist" | "report") => void;
}) {
  // 绑定了有效关联 Agent → 才显示保下限入口。
  const hasLinkedAgent =
    !!linkedProfileId && agentProfiles.some((p) => p.id === linkedProfileId);
  return (
    <li className="flex flex-col rounded-lg border border-border bg-card transition-colors hover:border-foreground/20">
      {/* Header — 点击打开详情弹窗(避免就地展开撑高同行另一张卡) */}
      <button
        type="button"
        onClick={onOpenDetail}
        className="flex w-full items-start gap-2.5 p-3 text-left"
        title="查看详细信息"
      >
        <EmployeeAvatar employee={employee} size={36} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[14px] font-semibold text-foreground">
              {employee.name}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-foreground/75">
            {employee.title}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px]">
            <span className="inline-flex items-center gap-0.5 text-muted-foreground">
              <Target className="h-2.5 w-2.5" />
              {employee.servesAudience}
            </span>
          </div>
        </div>
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground">
          详情
          <ChevronRight className="h-3 w-3" />
        </span>
      </button>

      {/* 源定义画像预览(来自 agent-defs 仓):persona 首句 + 专长标签 */}
      {employee.sourceProfile && (
        <div className="border-t border-border bg-card/40 px-3 py-2">
          <div className="mb-1 flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
            <BookOpen className="h-2.5 w-2.5" />
            源定义画像
          </div>
          <p className="text-[11px] leading-snug text-foreground/80">
            {firstSentence(employee.sourceProfile.persona)}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {employee.sourceProfile.expertise.slice(0, 4).map((e) => (
              <Badge key={e} variant="muted" className="text-[10px]">
                {expertiseLabel(e)}
              </Badge>
            ))}
            {employee.sourceProfile.expertise.length > 4 && (
              <span className="text-[10px] text-muted-foreground">
                +{employee.sourceProfile.expertise.length - 4}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 仓库技能(实时):从 agent-defs 仓拉取,技能源同步后自动刷新 */}
      <RepoSkillsBlock skills={repoSkills} loading={repoSkillsLoading} />

      {/* Profile association — user picks which Agent profile drives this
       *  standard employee. agent kind only (LLMs are never targets). */}
      <div
        className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-[10.5px]"
        onClick={(e) => e.stopPropagation()}
      >
        <Bot className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">关联 Agent:</span>
        <Select
          value={linkedProfileId ?? "_none_"}
          onValueChange={(v) =>
            onLink(v === "_none_" ? null : v)
          }
        >
          <SelectTrigger className="h-6 min-w-[140px] flex-1 text-[10.5px]">
            <SelectValue placeholder="未关联" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none_">— 未关联 —</SelectItem>
            {agentProfiles.length === 0 ? (
              <div className="px-2 py-1 text-[10px] text-muted-foreground">
                先去左导航「Agent 管理」添加 Agent
              </div>
            ) : (
              <>
                {agentProfiles.map((p) => {
                  // 只允许关联名称对应该员工的 agent(如 Aria → 「Aria（PLATFORM）」)。
                  const matches = agentMatchesEmployee(p, employee);
                  return (
                    <SelectItem key={p.id} value={p.id} disabled={!matches}>
                      {p.name}
                      {!matches && (
                        <span className="ml-1 text-muted-foreground">
                          （名称不符）
                        </span>
                      )}
                    </SelectItem>
                  );
                })}
                {!agentProfiles.some((p) => agentMatchesEmployee(p, employee)) && (
                  <div className="px-2 py-1 text-[10px] text-muted-foreground">
                    无名称匹配的 Agent（需含「{employee.name}」)
                  </div>
                )}
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* 保下限入口:仅当该员工绑定了有效的关联 Agent 时出现(绑定/解绑实时切换)。 */}
      {onOpenFloor && hasLinkedAgent && (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-[10.5px]">
          <ShieldCheck className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">保下限：</span>
          <button
            type="button"
            onClick={() => onOpenFloor("checklist")}
            className="rounded bg-muted px-1.5 py-0.5 hover:text-foreground"
          >
            下限清单
          </button>
          <button
            type="button"
            onClick={() => onOpenFloor("report")}
            className="rounded bg-muted px-1.5 py-0.5 hover:text-foreground"
          >
            保下限报告
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * 员工「详细信息」弹窗 — 取代原先的就地展开(2 列网格里就地展开会撑高同行、
 * 留下大片空白)。汇总:核心任务 / I-O 形态 / 能力边界 / 下游 / 角色专属指标
 * (含 Pass·Fail)/ 关联文档 / 源定义画像。
 */
function EmployeeDetailDialog({
  employee,
  repoSkills,
  repoSkillsLoading,
  metricOverlay,
  open,
  onOpenChange,
  onEditMetrics,
}: {
  employee: StandardEmployee;
  repoSkills: AgentRepoSkillSummary[];
  repoSkillsLoading: boolean;
  metricOverlay?: EmployeeMetricsOverlay;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditMetrics: () => void;
}) {
  const resolvedMetrics = useMemo(
    () => resolveEmployeeMetrics(employee.specificMetricTemplates, metricOverlay),
    [employee.specificMetricTemplates, metricOverlay],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[82vh] w-[min(720px,95vw)] flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <EmployeeAvatar employee={employee} size={28} className="shrink-0" />
            {employee.name}
            <Badge variant="muted" className="text-[10px] font-normal">
              {employee.autonomyLevel}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">
            {employee.title}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="-mx-1 min-h-0 flex-1">
          <div className="space-y-3 px-1 pb-2 text-[12px]">
            <Section icon={<Target className="h-3 w-3" />} label="服务对象">
              <p className="text-[11.5px] text-foreground/85">
                {employee.servesAudience}
              </p>
            </Section>

            {/* 仓库技能(实时):随技能源同步刷新;详情里展示全部 */}
            <Section
              icon={<Sparkles className="h-3 w-3" />}
              label="仓库技能（随技能源同步刷新）"
            >
              <RepoSkillBadges
                skills={repoSkills}
                loading={repoSkillsLoading}
                max={repoSkills.length}
              />
            </Section>

            <Section
              icon={<Briefcase className="h-3 w-3" />}
              label="核心任务（输入 → 输出）"
            >
              <ol className="ml-3 list-decimal space-y-1 text-foreground/85">
                {employee.coreTasks.map((t, i) => (
                  <li key={i} className="leading-snug">
                    {t}
                  </li>
                ))}
              </ol>
            </Section>

            {employee.examplePrompts && employee.examplePrompts.length > 0 && (
              <Section
                icon={<Lightbulb className="h-3 w-3" />}
                label="典型请求示例"
              >
                <ul className="space-y-1">
                  {employee.examplePrompts.map((p, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[11px] leading-snug text-foreground/85"
                    >
                      「{p}」
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {employee.toolChannels && employee.toolChannels.length > 0 && (
              <Section icon={<Bot className="h-3 w-3" />} label="工具 / 渠道">
                <div className="flex flex-wrap gap-1">
                  {employee.toolChannels.map((c) => (
                    <Badge key={c} variant="muted" className="font-mono text-[10px]">
                      {c}
                    </Badge>
                  ))}
                </div>
              </Section>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Section icon={<Inbox className="h-3 w-3" />} label="输入形态">
                <div className="flex flex-wrap gap-1">
                  {employee.inputForms.map((f) => (
                    <Badge key={f} variant="muted" className="text-[10px]">
                      {f}
                    </Badge>
                  ))}
                </div>
              </Section>
              <Section icon={<Send className="h-3 w-3" />} label="输出形态">
                <div className="flex flex-wrap gap-1">
                  {employee.outputForms.map((f) => (
                    <Badge key={f} variant="muted" className="text-[10px]">
                      {f}
                    </Badge>
                  ))}
                </div>
              </Section>
            </div>

            <Section
              icon={<Shield className="h-3 w-3 text-destructive" />}
              label="不在职责范围内的事 / 能力边界"
            >
              <p className="break-words text-[11.5px] text-foreground/85">
                {employee.outOfScope}
              </p>
            </Section>

            <Section icon={<Send className="h-3 w-3" />} label="下游接收方">
              <div className="flex flex-wrap gap-1">
                {employee.downstream.map((d) => (
                  <Badge key={d} variant="muted" className="text-[10px]">
                    {d}
                  </Badge>
                ))}
              </div>
            </Section>

            <div>
              <div className="mb-0.5 flex items-center justify-between gap-1 text-[10.5px] font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  角色专属指标 ({resolvedMetrics.length})
                </span>
                <button
                  type="button"
                  onClick={onEditMetrics}
                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:text-foreground"
                  title="编辑 / AI 草拟角色专属指标"
                >
                  <Pencil className="h-2.5 w-2.5" /> 编辑
                </button>
              </div>
              <ul className="space-y-1">
                {resolvedMetrics.map((m) => (
                  <MetricRow key={m.key} metric={m} showHints />
                ))}
              </ul>
            </div>

            {Object.values(employee.linkedDocs).some(Boolean) ? (
              <Section
                icon={<Briefcase className="h-3 w-3" />}
                label="关联文档"
              >
                <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 font-mono text-[10.5px]">
                  {Object.entries(employee.linkedDocs).map(([k, v]) =>
                    v ? (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="break-all text-foreground/85">{v}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              </Section>
            ) : (
              <p className="font-mono text-[10.5px] italic text-muted-foreground">
                暂无关联文档（SOP / Skills / 知识库 / 能力清单条目）
              </p>
            )}

            {employee.userPreferences && employee.userPreferences.length > 0 && (
              <Section
                icon={<BookOpen className="h-3 w-3" />}
                label="用户偏好 / 运行时记忆（已脱敏,非通用人设）"
              >
                <ul className="space-y-0.5">
                  {employee.userPreferences.map((p, i) => (
                    <li
                      key={i}
                      className="flex gap-1.5 text-[10.5px] leading-snug text-muted-foreground"
                    >
                      <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
                      {p}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {employee.sourceProfile && (
              <SourceProfileBlock profile={employee.sourceProfile} />
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 「源定义画像」块 — 渲染从 agent-defs 仓忠实精炼的人设 / 专长 / 原则 / 边界。
 * 只读展示,不参与评分。
 */
function SourceProfileBlock({ profile }: { profile: EmployeeSourceProfile }) {
  return (
    <div className="rounded-md border border-border bg-surface/40 p-2.5">
      <div className="mb-1.5 flex items-center gap-1 text-[10.5px] font-medium text-foreground/80">
        <BookOpen className="h-3 w-3" />
        源定义画像
      </div>

      <p className="mb-1 border-l-2 border-border pl-2 text-[11.5px] leading-snug text-foreground/85">
        {profile.persona}
      </p>

      <SubBlock icon={<Sparkles className="h-2.5 w-2.5" />} label="专长">
        <div className="flex flex-wrap gap-1">
          {profile.expertise.map((e) => (
            <Badge key={e} variant="muted" className="text-[10px]">
              {e}
            </Badge>
          ))}
        </div>
      </SubBlock>

      <SubBlock icon={<Lightbulb className="h-2.5 w-2.5" />} label="工作原则">
        <ul className="space-y-0.5">
          {profile.principles.map((p) => (
            <li
              key={p}
              className="flex gap-1.5 text-[10.5px] leading-snug text-foreground/80"
            >
              <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
              {p}
            </li>
          ))}
        </ul>
      </SubBlock>

      <SubBlock
        icon={<Ban className="h-2.5 w-2.5 text-destructive" />}
        label="明确不做"
      >
        <ul className="space-y-0.5">
          {profile.declines.map((d) => (
            <li
              key={d}
              className="flex gap-1.5 text-[10.5px] leading-snug text-muted-foreground"
            >
              <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-destructive/50" />
              {d}
            </li>
          ))}
        </ul>
      </SubBlock>

    </div>
  );
}

function SubBlock({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-1.5">
      <div className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function MetricRow({
  metric,
  showHints,
}: {
  metric: ResolvedMetric;
  showHints: boolean;
}) {
  const expanded = useMemo(
    () => showHints && (!!metric.passFormHint || !!metric.failFormHint),
    [showHints, metric.passFormHint, metric.failFormHint],
  );
  return (
    <li className="rounded-md border border-border bg-background px-2 py-1.5">
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 shrink-0 font-mono text-[9.5px] text-muted-foreground">
          ●
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[11.5px] font-medium text-foreground">
            {metric.label}
            {metric.origin === "custom" && (
              <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">自定义</span>
            )}
            {metric.edited && (
              <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">已改</span>
            )}
          </div>
          <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">
            {metric.description}
          </p>
          {expanded && (
            <div className="mt-1 space-y-0.5 text-[10.5px]">
              {metric.passFormHint && (
                <p className="text-foreground/80">
                  <span className="mr-1 font-medium text-success">Pass</span>
                  {metric.passFormHint}
                </p>
              )}
              {metric.failFormHint && (
                <p className="text-foreground/80">
                  <span className="mr-1 font-medium text-destructive">Fail</span>
                  {metric.failFormHint}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function Section({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-[11.5px]">{children}</div>
    </div>
  );
}

