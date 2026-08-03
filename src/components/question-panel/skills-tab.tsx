import {
  AlertTriangle,
  Bot,
  Loader2,
  PenLine,
  RefreshCw,
  Search,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";
import type { AgentSkill, AgentSkillsResult } from "@/types";
import { GenerateQuestionsDialog } from "./generate-questions-dialog";

/**
 * Skills inventory tab. Shows the capability list reported by the active
 * agent (via `AgentClient.listSkills` → bridge `GET /v1/skills`).
 *
 *   - empty + no support  → coached empty state
 *   - loading             → spinner
 *   - error               → red banner + retry
 *   - success             → search box + category filter chips + card grid
 */
export function SkillsTab() {
  const {
    activeProfile,
    activeSupportsSkills,
    listActiveSkills,
    connectionStatus,
  } = useQAStore();

  const [data, setData] = useState<AgentSkillsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  /** Skill currently being targeted by the AI generation dialog (null = closed). */
  const [generatingFor, setGeneratingFor] = useState<AgentSkill | null>(null);

  const load = useCallback(
    async (force: boolean) => {
      if (!activeProfile || !activeSupportsSkills) {
        setData(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await listActiveSkills(force);
        setData(res);
      } catch (e) {
        const err = e as Error;
        setError(
          err.name === "AbortError"
            ? "请求超时（10s）—— bridge 没响应 /v1/skills"
            : err.message,
        );
      } finally {
        setLoading(false);
      }
    },
    [activeProfile, activeSupportsSkills, listActiveSkills],
  );

  // Auto-load on profile switch / first mount.
  useEffect(() => {
    void load(false);
  }, [load]);

  const categories = useMemo(() => {
    if (!data) return [] as string[];
    return Array.from(
      new Set(data.skills.map((s) => s.category).filter(Boolean) as string[]),
    ).sort();
  }, [data]);

  const filtered = useMemo<AgentSkill[]>(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.skills.filter((s) => {
      if (category !== "all" && s.category !== category) return false;
      if (!q) return true;
      const haystack = [s.name, s.id, s.description, s.category, ...(s.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [data, query, category]);

  // ----- Empty states ----- ----- ----- ----- ----- ----- ----- ----- -----
  if (!activeProfile) {
    return (
      <EmptyHero
        icon={<Bot className="h-5 w-5" />}
        title="未选择 Agent"
        hint="先在右上角选择一个 Agent，再查看它声明的能力"
      />
    );
  }

  if (!activeSupportsSkills) {
    return (
      <EmptyHero
        icon={<Wand2 className="h-5 w-5" />}
        title="该 Agent 不支持能力列表"
        hint="当前 provider 没有实现 listSkills() —— 仅接入了真实 agent 的 provider(如 Platform)才会返回数据"
      />
    );
  }

  // ----- Main render ----- ----- ----- ----- ----- ----- ----- ----- -----
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-foreground/70" />
            {activeProfile.name} · 能力清单
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            {data?.agent && <span>agent={data.agent}</span>}
            {data?.version && <span className="ml-2">v{data.version}</span>}
            {data && (
              <span className="ml-2">
                {filtered.length}/{data.skills.length} 项
              </span>
            )}
            {connectionStatus === "disconnected" && (
              <span className="ml-2 text-warning">· 未连接</span>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={loading}
          onClick={() => void load(true)}
        >
          <RefreshCw
            className={cn("h-3 w-3", loading && "animate-spin")}
          />
          刷新
        </Button>
      </header>

      {/* Search + category chips */}
      {data && data.skills.length > 0 && (
        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="按名称、tag、描述搜索…"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <CategoryChip
                label="全部"
                active={category === "all"}
                onClick={() => setCategory("all")}
              />
              {categories.map((c) => (
                <CategoryChip
                  key={c}
                  label={c}
                  active={category === c}
                  onClick={() => setCategory(c)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <ScrollArea className="-mx-1 flex-1">
        <div className="px-1 pb-2">
          {loading && !data && (
            <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在从 bridge 拉取能力清单…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[12px] text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">无法加载能力清单</div>
                <div className="mt-0.5 break-words text-[11.5px] opacity-80">
                  {error}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1 border-destructive/30 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void load(true)}
              >
                重试
              </Button>
            </div>
          )}

          {data && !loading && !error && data.skills.length === 0 && (
            <EmptyHero
              icon={<Wand2 className="h-5 w-5" />}
              title="Agent 没有声明任何能力"
              hint="bridge 的 /v1/skills 返回了空列表 —— 可能 agent 配置里没注册任何 tool"
            />
          )}

          {data && data.skills.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filtered.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onGenerate={() => setGeneratingFor(skill)}
                />
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full py-10 text-center text-[12px] text-muted-foreground">
                  没有匹配「{query}」的能力
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      <GenerateQuestionsDialog
        open={!!generatingFor}
        onOpenChange={(o) => !o && setGeneratingFor(null)}
        skill={generatingFor}
      />
    </div>
  );
}

/* -------------------------------- Subviews -------------------------------- */

function EmptyHero({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function SkillCard({
  skill,
  onGenerate,
}: {
  skill: AgentSkill;
  onGenerate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const metaEntries = skill.meta ? Object.entries(skill.meta) : [];
  return (
    <div className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/20">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground">
          <Wand2 className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-foreground">
                {skill.name}
              </div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {skill.id}
              </div>
            </div>
            {skill.category && (
              <Badge variant="muted" className="shrink-0 text-[10px]">
                {skill.category}
              </Badge>
            )}
          </div>
          {skill.description && (
            <p
              className={cn(
                "mt-1.5 text-[11.5px] leading-relaxed text-foreground/85",
                !expanded && "line-clamp-3",
              )}
            >
              {skill.description}
            </p>
          )}
          {skill.tags && skill.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {skill.tags.map((t) => (
                <span
                  key={t}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onGenerate}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[10.5px] font-medium text-foreground/85 transition-colors hover:border-foreground/40 hover:bg-secondary hover:text-foreground"
            >
              <PenLine className="h-3 w-3" />
              AI 出题
            </button>
            {((skill.description && skill.description.length > 120) ||
              metaEntries.length > 0 ||
              !!skill.body) && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-[10.5px] text-muted-foreground hover:text-foreground"
              >
                {expanded ? "收起" : skill.body ? "展开正文" : "展开"}
              </button>
            )}
          </div>
          {expanded && skill.body && (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[10.5px] leading-relaxed text-foreground/80">
              {skill.body}
            </pre>
          )}
          {expanded && metaEntries.length > 0 && (
            <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 font-mono text-[10.5px]">
              {metaEntries.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate text-foreground/85">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
