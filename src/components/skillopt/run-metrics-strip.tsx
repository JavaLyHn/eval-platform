import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type InnerStageKey, type StageKey } from "@/lib/skillopt-stages";
import { type RunMetrics } from "@/lib/skillopt-run-events";
import { StagePipeline } from "./stage-pipeline";

const SILENT_WARN_MS = 90_000;

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** 内联 SVG 折线;<2 点不画。 */
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 64;
  const h = 16;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const PAD = 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = PAD + (h - 2 * PAD) * (1 - (v - min) / span);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} role="img" aria-label="选择集得分趋势" className="text-accent">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function RunMetricsStrip({
  stage,
  innerStage,
  metrics,
  startedAt,
  lastOutputAt,
  stageStartedAt,
}: {
  stage?: StageKey;
  innerStage?: InnerStageKey;
  metrics: RunMetrics;
  startedAt: number | null;
  lastOutputAt: number | null;
  stageStartedAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const silentMs = lastOutputAt != null ? now - lastOutputAt : 0;
  const pct = metrics.totalSteps > 0 ? Math.round((metrics.step / metrics.totalSteps) * 100) : 0;

  // 6 阶段管线之下的宏观阶段说明(baseline / 留出 / 完成 不在内循环里)。
  const macroText =
    stage === "done"
      ? "✅ 优化完成"
      : stage === "heldout"
        ? "留出集评测中…"
        : stage === "enrich"
          ? "注入经验中(慢更新 / 元技能)…"
          : stage === "baseline"
            ? "基线评估中…"
            : stage === "train"
              ? `逐步优化 · 第 ${metrics.step}/${metrics.totalSteps} 步`
              : "等待训练开始…";

  return (
    <Card className="space-y-2.5 p-3">
      <StagePipeline active={innerStage} macroStage={stage} />

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{macroText}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {metrics.lastRolloutHard != null && <span>本步试跑通过 {Math.round(metrics.lastRolloutHard * 100)}%</span>}
        {metrics.selectionSeries.length >= 2 && (
          <span className="inline-flex items-center gap-1.5">
            选择集 <Sparkline data={metrics.selectionSeries} />
            {metrics.bestScore != null && <span className="text-foreground">{metrics.bestScore.toFixed(2)}</span>}
          </span>
        )}
        <span>收 {metrics.accepts} · 弃 {metrics.rejects} · 跳 {metrics.skips}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {startedAt != null && (
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> 已运行 {fmt(now - startedAt)}</span>
        )}
        {stageStartedAt != null && <span>当前阶段 {fmt(now - stageStartedAt)}</span>}
        {lastOutputAt != null && (
          <span className={cn(silentMs > SILENT_WARN_MS && "text-warning")}>
            最近输出 {Math.floor(silentMs / 1000)}s 前{silentMs > SILENT_WARN_MS && " · LLM 响应缓慢 / 中转可能异常"}
          </span>
        )}
      </div>
    </Card>
  );
}
