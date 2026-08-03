import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  fetchSkillOptCases,
  type SkillOptCaseSets,
  type SkillOptCaseSpec,
} from "@/lib/skillopt-client";

/** 三个集各自的配色:训练=蓝 / 选择=琥珀 / 留出=绿。让三行一眼可辨。 */
const SPLIT_STYLE: Record<string, { wrap: string; head: string; dot: string; text: string }> = {
  train: { wrap: "border-sky-500/40 border-l-[3px] border-l-sky-500", head: "bg-sky-500/10", dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-300" },
  val: { wrap: "border-amber-500/40 border-l-[3px] border-l-amber-500", head: "bg-amber-500/10", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  test: { wrap: "border-emerald-500/40 border-l-[3px] border-l-emerald-500", head: "bg-emerald-500/10", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  _default: { wrap: "border-border", head: "bg-secondary/30", dot: "bg-muted-foreground", text: "text-foreground" },
};

export function CaseSetsCard({ highlightId, override, emptyHint }: { highlightId?: string; override?: SkillOptCaseSets | null; emptyHint?: string }) {
  const [data, setData] = useState<SkillOptCaseSets | null>(null);
  const [err, setErr] = useState<string>("");
  const [openSplits, setOpenSplits] = useState<Record<string, boolean>>({});
  const [openCases, setOpenCases] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (override !== undefined) return;   // 员工模式由外部提供题集,跳过 fetch
    const ctrl = new AbortController();
    fetchSkillOptCases(ctrl.signal)
      .then(setData)
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setErr((e as Error).message);
      });
    return () => ctrl.abort();
  }, [override]);

  const view = override !== undefined ? override : data;

  useEffect(() => {
    if (!highlightId || !view) return;
    const g = view.groups.find((grp) => grp.cases.some((c) => c.id === highlightId));
    if (g) setOpenSplits((p) => (p[g.split] ? p : { ...p, [g.split]: true }));
  }, [highlightId, view]);

  const total = view?.groups.reduce((n, g) => n + g.count, 0) ?? 0;
  const empty = view != null && total === 0;

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold">题集</div>
        <div className="text-[11px] text-muted-foreground">
          {view ? `${view.caseSet || "—"} · 共 ${total} 题` : ""}
        </div>
      </div>

      {err && <div className="text-[11px] text-muted-foreground">题集加载失败:{err}</div>}
      {!view && !err && <div className="text-[11px] text-muted-foreground">加载题集…</div>}
      {empty && (
        <div className="text-[11px] text-muted-foreground">
          {emptyHint
            ?? (override !== undefined
              ? "选择员工后显示其题集(或该员工暂无可确定性判分的题)。"
              : "题集暂不可用(未找到 cases_m1)。")}
        </div>
      )}

      {view && !empty && (
        <div className="max-h-[70vh] space-y-1 overflow-auto">
          {view.groups.map((g) => {
            const open = openSplits[g.split] ?? true; // 默认完整展开分类;点击可折叠
            const s = SPLIT_STYLE[g.split] ?? SPLIT_STYLE._default;
            return (
              <div key={g.split} className={cn("overflow-hidden rounded-md border", s.wrap)}>
                <button
                  type="button"
                  onClick={() => setOpenSplits((p) => ({ ...p, [g.split]: !(p[g.split] ?? true) }))}
                  className={cn("flex w-full items-center gap-2 px-2 py-2 text-left text-[12px] transition-[filter] hover:brightness-95 dark:hover:brightness-110", s.head)}
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} />
                  <span className={cn("font-semibold", s.text)}>{g.label}</span>
                  <span className="rounded-full bg-background/70 px-1.5 py-px text-[10.5px] font-medium tabular-nums text-muted-foreground">{g.count} 题</span>
                  <span className="ml-auto truncate pl-2 text-[10.5px] text-muted-foreground">{g.role}</span>
                </button>
                {open && (
                  <div className="border-t border-border">
                    {g.cases.map((c) => (
                      <CaseRow
                        key={c.id}
                        c={c}
                        open={!!openCases[c.id]}
                        highlighted={c.id === highlightId}
                        onToggle={() => setOpenCases((p) => ({ ...p, [c.id]: !p[c.id] }))}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function CaseRow({
  c,
  open,
  onToggle,
  highlighted,
}: {
  c: SkillOptCaseSpec;
  open: boolean;
  onToggle: () => void;
  highlighted?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const intercept = c.caseType === "interception";
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);
  return (
    <div
      ref={ref}
      className={cn(
        "border-t border-border first:border-t-0",
        highlighted && "rounded bg-accent/10 ring-1 ring-accent",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-secondary/30"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("min-w-0 flex-1 text-[12px]", open ? "whitespace-pre-wrap break-words" : "truncate")}>{c.prompt}</span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          {highlighted && (
            <span className="flex items-center gap-1 text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              评测中
            </span>
          )}
          <span
            className={cn(
              "rounded border px-1",
              intercept ? "border-destructive/40 text-destructive" : c.caseType === "standard" ? "border-accent/40 text-accent" : "border-border",
            )}
          >
            {c.caseType === "interception" ? "红线" : c.caseType === "standard" ? "意图" : "正常"}
          </span>
          <span className="rounded border border-border px-1">{c.taskType}</span>
          {c.language && <span className="rounded border border-border px-1">{c.language}</span>}
        </span>
      </button>
      {open && (
        <div className="space-y-1 px-2 pb-2 pl-7 text-[11px] text-muted-foreground">
          {/* 题面已在上方头部(展开时不截断)完整显示,这里不再重复;只列期望 + 判分项 */}
          <div>{expectedText(c)}</div>
          <div>判分项:{c.checks.join("、") || "—"}</div>
        </div>
      )}
    </div>
  );
}

function expectedText(c: SkillOptCaseSpec): string {
  const e = c.expected;
  if (e.intercepted === true) return "期望:应拦截(拒绝泄露内部信息)";
  // acceptAny 任务题:展示 must-include 可机检约束(核对 round-trip 是否带过来了)。
  const mustInclude = Array.isArray(e.mustInclude) ? (e.mustInclude as string[]) : [];
  const mustExclude = Array.isArray(e.mustExclude) ? (e.mustExclude as string[]) : [];
  if (mustInclude.length || mustExclude.length) {
    const parts: string[] = [];
    if (mustInclude.length) parts.push(`必含:${mustInclude.join("、")}`);
    if (mustExclude.length) parts.push(`禁现:${mustExclude.join("、")}`);
    return `约束(${parts.join(" / ")}) · 语言:${(e.language as string) ?? "—"}`;
  }
  const intent = (e.intentType as string) ?? "—";
  const clar = e.requiresClarification ? "是" : "否";
  const lang = (e.language as string) ?? "—";
  const slotsObj = e.slots;
  const slots =
    slotsObj && typeof slotsObj === "object" && Object.keys(slotsObj as object).length > 0
      ? JSON.stringify(slotsObj)
      : "—";
  return `期望意图:${intent} · 需澄清:${clar} · 语言:${lang} · 槽位:${slots}`;
}
