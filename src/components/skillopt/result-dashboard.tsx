import { Fragment, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  GitBranch,
  Lightbulb,
  Minus,
  TrendingDown,
  TrendingUp,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { extractLearnedGuidance, diffSkill } from "@/lib/skillopt-diff";
import type { SkillOptCase, SkillOptDoneFrame, SkillOptStep } from "@/lib/skillopt-client";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const soft = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

export function ResultDashboard({ frame, logs }: { frame: SkillOptDoneFrame; logs: string[] }) {
  const learned = extractLearnedGuidance(frame.bestSkill);
  return (
    <div className="space-y-4">
      <ConclusionBar frame={frame} learned={learned} />
      <EffectCompare frame={frame} />
      <ProcessTimeline frame={frame} hasLearned={!!learned} />
      <SkillLearned frame={frame} learned={learned} />
      <CaseTable cases={frame.cases} />
      <DetailLogs logs={logs} />
    </div>
  );
}

function ConclusionBar({ frame, learned }: { frame: SkillOptDoneFrame; learned: string }) {
  const s = frame.summary;
  const learnedNote = learned ? "并注入了新的经验规则" : "本次未注入新规则";
  let text: string;
  let delta: number | null = null;
  if (frame.cases && s.testSoft != null && s.baselineTestSoft != null) {
    delta = s.testSoft - s.baselineTestSoft;
    const deltaStr = delta > 0 ? `+${delta.toFixed(2)}` : delta < 0 ? `${delta.toFixed(2)}` : "持平";
    const passed = frame.cases.filter((c) => c.bestHard === 1).length;
    text = `优化后留出集质量分 ${soft(s.baselineTestSoft)}→${soft(s.testSoft)}(${deltaStr}),通过 ${passed}/${frame.cases.length} 题;${learnedNote}。`;
  } else {
    text = `选择集通过率 ${pct(s.baselineSelectionHard)}→${pct(s.bestSelectionHard)};${learnedNote}(未跑留出集)。`;
  }
  const TrendIcon =
    delta != null && delta > 0
      ? TrendingUp
      : delta != null && delta < 0
        ? TrendingDown
        : null;
  const trendCls =
    delta != null && delta > 0
      ? "text-success"
      : delta != null && delta < 0
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <Card className="border-accent/30 bg-accent/5 p-3 text-[12px] leading-relaxed">
      <span className="inline-flex items-center gap-1.5">
        {TrendIcon ? (
          <TrendIcon className={cn("h-4 w-4 shrink-0", trendCls)} />
        ) : delta === 0 ? (
          <Minus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : null}
        {text}
      </span>
    </Card>
  );
}

function EffectCompare({ frame }: { frame: SkillOptDoneFrame }) {
  const s = frame.summary;
  const hasTest = frame.cases != null && s.testHard != null;
  const baseHard = hasTest ? s.baselineTestHard : s.baselineSelectionHard;
  const bestHard = hasTest ? s.testHard : s.bestSelectionHard;
  const dSoft = hasTest && s.testSoft != null && s.baselineTestSoft != null ? s.testSoft - s.baselineTestSoft : null;
  return (
    <Card className="space-y-2 p-4">
      <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        ① 效果对比
      </div>
      <div className="text-[11px] text-muted-foreground">
        {hasTest ? `留出 test 集 · ${s.testSize ?? frame.cases?.length} 题` : "门控 / 选择集(未跑留出集)"}
      </div>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] text-[12px] md:min-w-0">
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="py-1 font-normal">　</th>
            <th className="py-1 font-normal">通过率(hard)</th>
            {hasTest && <th className="py-1 font-normal">质量分(soft)</th>}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            <td className="py-1.5 text-muted-foreground">种子(优化前)</td>
            <td className="py-1.5">{pct(baseHard)}</td>
            {hasTest && <td className="py-1.5">{soft(s.baselineTestSoft)}</td>}
          </tr>
          <tr className="border-t border-border">
            <td className="py-1.5 text-muted-foreground">优化后(best)</td>
            <td className="py-1.5 font-medium">{pct(bestHard)}</td>
            {hasTest && (
              <td className="py-1.5 font-medium">
                {soft(s.testSoft)}
                {dSoft != null && dSoft !== 0 && (
                  <span className={cn("ml-1.5 text-[11px]", dSoft > 0 ? "text-success" : "text-destructive")}>
                    {dSoft > 0 ? `▲+${dSoft.toFixed(2)}` : `▼${dSoft.toFixed(2)}`}
                  </span>
                )}
              </td>
            )}
          </tr>
        </tbody>
      </table>
      </div>
    </Card>
  );
}

function actionBadge(action: string): { label: string; variant: "success" | "warning" | "muted" } {
  if (action.includes("accept")) return { label: "接受", variant: "success" };
  if (action === "reject") return { label: "拒绝", variant: "warning" };
  return { label: "无改动", variant: "muted" };
}

function ProcessTimeline({ frame, hasLearned }: { frame: SkillOptDoneFrame; hasLearned: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const steps = frame.history ?? [];
  return (
    <Card className="space-y-3 p-4">
      <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
        <GitBranch className="h-4 w-4 text-muted-foreground" />
        ② 优化过程
      </div>
      {steps.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">无步骤记录。</div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Node label="基线" sub={`hard ${pct(frame.summary.baselineSelectionHard)}`} />
          {steps.map((st) => {
            const ab = actionBadge(st.action);
            return (
              <div key={st.step} className="flex items-center gap-1.5">
                <Arrow />
                <button
                  type="button"
                  onClick={() => setOpen(open === st.step ? null : st.step)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-secondary"
                >
                  第{st.step}步
                  <Badge variant={ab.variant}>{ab.label}</Badge>
                  <span className="text-muted-foreground">soft {st.rolloutSoft.toFixed(2)}</span>
                </button>
              </div>
            );
          })}
          {hasLearned && (
            <>
              <Arrow />
              <Node label="注入经验 ✦" sub="" accent />
            </>
          )}
          <Arrow />
          <Node label="完成" sub={`最优=第${frame.summary.bestStep}步`} />
        </div>
      )}
      {open != null && (() => {
        const st = steps.find((x) => x.step === open) as SkillOptStep;
        return (
          <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            第{st.step}步(epoch {st.epoch}):试跑 hard={st.rolloutHard.toFixed(2)} soft={st.rolloutSoft.toFixed(2)}({st.rolloutN} 题)· 动作 {actionBadge(st.action).label} · skill 长度 {st.skillLen} · 用时 {Math.round(st.wallTimeS)}s
          </div>
        );
      })()}
    </Card>
  );
}

function Node({ label, sub, accent }: { label: string; sub: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-md px-2 py-1", accent ? "bg-accent/15 text-accent" : "bg-secondary text-foreground")}>
      <div>{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Arrow() {
  return <span className="text-border">→</span>;
}

function SkillLearned({ frame, learned }: { frame: SkillOptDoneFrame; learned: string }) {
  const [showDiff, setShowDiff] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(frame.bestSkill);
  const download = () => {
    const blob = new Blob([frame.bestSkill], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "best_skill.md";
    a.click();
    URL.revokeObjectURL(url);
  };
  const diff = frame.seedSkill ? diffSkill(frame.seedSkill, frame.bestSkill) : [];
  // 左栏=原版(种子):same + del 行;右栏=优化后(最优):same + add 行。
  const leftLines = diff.filter((l) => l.type !== "add");
  const rightLines = diff.filter((l) => l.type !== "del");
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
          <Lightbulb className="h-4 w-4 text-muted-foreground" />
          ③ 学到了什么
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-secondary">
            <Copy className="h-3 w-3" /> 复制
          </button>
          <button type="button" onClick={download} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-secondary">
            <Download className="h-3 w-3" /> 下载
          </button>
        </div>
      </div>
      {learned ? (
        <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2">
          <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-success">
            <Lightbulb className="h-3.5 w-3.5" />
            优化注入的经验
          </div>
          <Markdown>{learned}</Markdown>
        </div>
      ) : (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          本次未注入新规则(种子已是最优)。
        </div>
      )}
      {frame.seedSkill && (
        <div>
          <button
            type="button"
            onClick={() => setShowDiff(true)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <GitBranch className="h-3 w-3" />
            完整对比(种子 → 最优)
          </button>

          <Dialog open={showDiff} onOpenChange={setShowDiff}>
            <DialogContent className="max-w-5xl">
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 text-[14px]">
                  完整对比(种子 → 最优)
                  <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-normal text-success">
                    绿色 = 优化新增
                  </span>
                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-normal text-destructive line-through">
                    红色 = 已删除
                  </span>
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="min-w-0">
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                    原版(种子)
                  </div>
                  <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed">
                    {leftLines.map((l, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          l.type === "del" && "bg-destructive/10 text-destructive line-through",
                        )}
                      >
                        {l.text || " "}
                      </div>
                    ))}
                  </pre>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                    优化后(最优)
                  </div>
                  <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed">
                    {rightLines.map((l, idx) => (
                      <div
                        key={idx}
                        className={cn(l.type === "add" && "bg-success/15 text-success")}
                      >
                        {l.text || " "}
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </Card>
  );
}

function caseOutcome(c: SkillOptCase): { Icon: LucideIcon; label: string; cls: string } {
  if (c.bestHard === 1 && c.baselineHard === 1) return { Icon: CheckCircle2, label: "保持", cls: "text-success" };
  if (c.bestHard === 1 && c.baselineHard === 0) return { Icon: TrendingUp, label: "修好", cls: "text-success" };
  if (c.bestHard === 0 && c.baselineHard === 1) return { Icon: TrendingDown, label: "变差", cls: "text-destructive" };
  return { Icon: XCircle, label: "仍未过", cls: "text-destructive" };
}

function CaseTable({ cases }: { cases: SkillOptCase[] | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  if (!cases) {
    return (
      <Card className="space-y-1 p-4">
        <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          ④ 逐题表现
        </div>
        <div className="text-[11px] text-muted-foreground">本次未评测留出集。</div>
      </Card>
    );
  }
  const passed = cases.filter((c) => c.bestHard === 1).length;
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground hover:text-foreground/80"
          aria-expanded={!collapsed}
          title={collapsed ? "展开" : "收起"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          ④ 逐题表现
        </button>
        <div className="text-[11px] text-muted-foreground">
          {passed} 过 / {cases.length - passed} 挂
        </div>
      </div>
      {!collapsed && (
      <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12px] md:min-w-0">
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="py-1 font-normal">题目</th>
            <th className="py-1 font-normal">类型</th>
            <th className="py-1 font-normal">结果</th>
            <th className="py-1 font-normal">K 次</th>
            <th className="py-1 font-normal">失败原因</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const o = caseOutcome(c);
            const isOpen = open === c.id;
            return (
              <Fragment key={c.id}>
                <tr
                  className="cursor-pointer border-t border-border hover:bg-secondary/40"
                  onClick={() => setOpen(isOpen ? null : c.id)}
                >
                  <td className="max-w-[260px] truncate py-1.5">{c.prompt}</td>
                  <td className="py-1.5 text-muted-foreground">
                    {c.caseType}
                    {c.taskType ? ` · ${c.taskType}` : ""}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    <span className={cn("inline-flex items-center gap-1", o.cls)}>
                      <o.Icon className="h-3.5 w-3.5" />
                      {o.label}
                    </span>
                  </td>
                  <td className="py-1.5 whitespace-nowrap text-muted-foreground">
                    {c.k != null && c.passCount != null ? `${c.passCount}/${c.k}` : "—"}
                  </td>
                  {/* 截断只在手机(窄屏防撑破表格);桌面回到换行完整显示,否则失败原因读不到 */}
                  <td
                    className="max-w-[220px] truncate py-1.5 text-muted-foreground md:max-w-none md:whitespace-normal"
                    title={c.bestFailReason || undefined}
                  >
                    {c.bestFailReason || "—"}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t border-border bg-muted/30">
                    <td colSpan={5} className="px-2 py-2 text-[11px]">
                      <div className="mb-1 text-muted-foreground">优化后回答:</div>
                      <div className="whitespace-pre-wrap text-foreground/85">{c.bestAnswer || "(无记录)"}</div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
      )}
    </Card>
  );
}

function DetailLogs({ logs }: { logs: string[] }) {
  const [open, setOpen] = useState(false);
  if (logs.length === 0) return null;
  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 border-b border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        详细日志 · {logs.length} 行
      </button>
      {open && (
        <pre className="max-h-72 overflow-auto px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
          {logs.join("\n")}
        </pre>
      )}
    </Card>
  );
}
