import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, GitCompare, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn, formatRelativeTime } from "@/lib/utils";
import { STANDARD_EMPLOYEES } from "@/lib/standard-employees";
import {
  repoEmpToStandardId,
  reconcileSkills,
  reconcileSummary,
  type ReconcileRow,
} from "@/lib/agent-repo-compare";
import type { PlatformSkill } from "@/types";

interface Group {
  dir: string;
  name: string;
  mapped: boolean;
  platformAvailable: boolean;
  rows: ReconcileRow[];
}

export function SkillsComparePage() {
  const { employeeProfileMap, profiles, bumpAgentRepoVersion, agentRepoSyncedAt } =
    useQAStore();
  const [groups, setGroups] = useState<Group[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** Mirror SkillsPage's instanceIdForEmployee EXACTLY. */
  const instanceIdForEmployee = useCallback(
    (employeeId: string): string | undefined => {
      const emp = STANDARD_EMPLOYEES.find((e) => e.id === employeeId);
      if (!emp) return undefined;
      const bound = employeeProfileMap[emp.id] ?? emp.associatedProfileId;
      const prof = bound ? profiles.find((p) => p.id === bound) : undefined;
      const iid = (prof?.config as Record<string, unknown> | undefined)
        ?.instanceId;
      return typeof iid === "string" && iid ? iid : undefined;
    },
    [employeeProfileMap, profiles],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const empRes = await api.agentRepo.employees();
      if (!empRes.ok) {
        setDetail(empRes.detail ?? "repo 未就位");
        setGroups([]);
        return;
      }
      setDetail(null);
      const out: Group[] = [];
      const mappedEmployees = empRes.employees.filter((e) => repoEmpToStandardId(e.dir) !== null);
      for (const e of mappedEmployees) {
        let repoSkills: { name: string; description: string; version: string | null }[] =
          [];
        try {
          const er = await api.agentRepo.employee(e.dir);
          if (er.ok) repoSkills = er.skills;
        } catch {
          /* skip */
        }
        const stdId = repoEmpToStandardId(e.dir);
        let platformSkills: PlatformSkill[] = [];
        let platformAvailable = false;
        if (stdId) {
          const iid = instanceIdForEmployee(stdId);
          if (iid) {
            try {
              const sr = await api.platform.skills({ instanceId: iid });
              if (sr.ok) {
                platformSkills = sr.skills;
                platformAvailable = true;
              }
            } catch {
              /* unavailable */
            }
          }
        }
        out.push({
          dir: e.dir,
          name: e.name,
          mapped: stdId !== null,
          platformAvailable,
          rows: reconcileSkills(repoSkills, platformAvailable ? platformSkills : []),
        });
      }
      setGroups(out);
    } catch (e) {
      setDetail(e instanceof Error ? e.message : "加载失败");
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [instanceIdForEmployee]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      await api.agentRepo.refresh();
      // 同步成功 → 记录刷新时刻 + 广播版本,让消费仓库数据的组件实时刷新。
      bumpAgentRepoVersion();
    } catch {
      /* ignore */
    }
    await load();
  }, [load, bumpAgentRepoVersion]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 gap-y-2 border-b border-border bg-card px-4 py-3">
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="inline-flex min-w-0 items-center gap-1.5 truncate text-[15px] font-semibold">
          <GitCompare className="h-4 w-4 text-foreground/70" />
          技能对比(Repo ↔ Platform 线上)
        </h1>
        {agentRepoSyncedAt && (
          <span
            className="ml-auto text-[11px] text-muted-foreground"
            title={`最近一次刷新:${new Date(agentRepoSyncedAt).toLocaleString()}`}
          >
            最近刷新 {formatRelativeTime(new Date(agentRepoSyncedAt))}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className={cn("h-7", !agentRepoSyncedAt && "ml-auto")}
          onClick={() => void refresh()}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          刷新
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <p className="mb-3 text-[11.5px] text-muted-foreground">
          正文无法跨源对比(Platform API 不给技能正文),此处比 名称 /
          版本。🟠 仅线上 = repo 待补;🔵 仅 repo = 线上未上/已下。
        </p>

        {detail && (
          <div className="rounded border border-border bg-card p-4 text-[12px] text-muted-foreground whitespace-pre-wrap">
            {detail}
          </div>
        )}
        {loading && (
          <div className="text-[12px] text-muted-foreground">加载中…</div>
        )}

        {groups.map((g) => {
          const sum = reconcileSummary(g.rows);
          return (
            <div key={g.dir} className="mb-4 rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[12.5px]">
                <span className="font-medium">{g.name}</span>
                {!g.mapped && (
                  <Badge variant="muted">无平台 Platform 对应</Badge>
                )}
                {g.mapped && !g.platformAvailable && (
                  <Badge variant="warning">线上数据不可用</Badge>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  共 {sum.total} · 一致 {sum.same} · 版本差 {sum.versionDiff} ·
                  仅 repo {sum.repoOnly} · 仅线上 {sum.platformOnly}
                </span>
              </div>
              {g.rows.length > 0 ? (
                <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] text-[11.5px] md:min-w-0">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="px-3 py-1 text-left font-normal">技能</th>
                      <th className="py-1 text-left font-normal">repo</th>
                      <th className="py-1 text-left font-normal">Platform</th>
                      <th className="py-1 text-left font-normal">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.name} className="border-t border-border/60">
                        {/* 截断只在手机;桌面回到换行完整显示(长技能名不能读不到) */}
                        <td
                          className="max-w-[160px] truncate px-3 py-1.5 md:max-w-none md:whitespace-normal"
                          title={r.name}
                        >
                          {r.name}
                        </td>
                        <td className="py-1.5 text-muted-foreground">
                          {r.repoVersion ? `v${r.repoVersion}` : "—"}
                        </td>
                        <td className="py-1.5 text-muted-foreground">
                          {r.platformVersion ? `v${r.platformVersion}` : "—"}
                        </td>
                        <td className="py-1.5">
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              ) : (
                <p className="px-3 py-2 text-[11.5px] text-muted-foreground">无技能记录</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ReconcileRow["status"] }) {
  const map = {
    "both-same": { label: "一致", variant: "success" as const },
    "both-version-diff": { label: "版本差", variant: "warning" as const },
    "repo-only": { label: "仅 repo", variant: "info" as const },
    "platform-only": { label: "仅线上(待补)", variant: "destructive" as const },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
