import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { bucketByDay, summarizeTrend, type DayBucket, type TrendItem } from "@/lib/trend-buckets";

/**
 * 评测趋势图 —— 仿 shadcn「Total Visitors」交互式面积图(recharts),皮肤套用数据看板
 * 「仪表台」主题:降饱和 通过/失败 两条独立面积(各自从 0 基线、不堆叠)+ 渐变填充 +
 * type="linear" 直线段 + 仅横向发丝线网格 + mono 日期轴 + hover tooltip + 7/14/30 天切换。
 *
 * 口径 = **按题**,与看板 KPI / 状态环一致:每天统计通过/失败的**题数**(按题级 verdict,
 * 困难题多轮 + 同题多 trial 归一),头部大数 = 整体通过率(通过题 / 已判定题)。
 * 分桶 / 汇总逻辑抽到 `@/lib/trend-buckets`(纯函数、可单测)。
 */

const WINDOW_OPTIONS = [
  { value: 7, label: "7 天" },
  { value: 14, label: "14 天" },
  { value: 30, label: "30 天" },
];

export function TrendChart({ items }: { items: TrendItem[] }) {
  const [days, setDays] = useState(14);
  const buckets = useMemo(() => bucketByDay(items, days), [items, days]);
  const { passRate, hasData } = useMemo(() => summarizeTrend(buckets), [buckets]);

  return (
    <section className="dkm-card dkm-rise">
      <div className="dkm-head">
        <span className="t">
          <span className="title">趋势</span>
          <span className="slug">trend</span>
        </span>
        {/* 时间段切换(7/14/30 天)—— 仿 Total Visitors 的分段切换 */}
        <div
          className="inline-flex items-center gap-0.5 rounded-md p-0.5"
          style={{ border: "1px solid var(--l1)", background: "var(--dk-surface-2)" }}
        >
          {WINDOW_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setDays(o.value)}
              className="mono rounded px-2 py-0.5 text-[10.5px] font-medium transition-colors"
              style={
                days === o.value
                  ? { background: "var(--dk-surface)", color: "var(--ink1)", boxShadow: "var(--shadow)" }
                  : { color: "var(--ink3)", background: "transparent" }
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="dkm-divider" />

      {/* 描述行:大数(像模板的 Total)= 整体通过率(按题,与 KPI 一致)。 */}
      <div className="flex items-baseline gap-2 px-4 pt-3">
        <span className="mono text-[28px] font-semibold leading-none" style={{ color: "var(--ink1)" }}>
          {passRate.toFixed(0)}
          <span className="text-[18px]" style={{ color: "var(--ink3)" }}>%</span>
        </span>
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>
          整体通过率 · 近 {days} 天
        </span>
      </div>

      {!hasData ? (
        <div className="px-4 py-12 text-center text-[12px]" style={{ color: "var(--ink3)" }}>
          这段时间还没有评测数据
        </div>
      ) : (
        <div className="px-2 pb-2 pt-3">
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={buckets} margin={{ top: 6, right: 12, left: 6, bottom: 0 }}>
              <defs>
                <linearGradient id="dkmFillPass" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--pass)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--pass)" stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="dkmFillFail" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--fail)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--fail)" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--l1)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={28}
                tick={{ fill: "var(--ink3)", fontSize: 10, fontFamily: "var(--mono)" }}
              />
              <YAxis hide domain={[0, "dataMax"]} />
              <Tooltip
                cursor={{ stroke: "var(--l2)", strokeWidth: 1 }}
                content={<TrendTooltip />}
              />
              {/* 通过 / 失败 各自从 0 基线画(不堆叠)—— 数量多的面积自然更高。计数 = 题数。 */}
              <Area
                dataKey="passed"
                name="通过"
                type="linear"
                stroke="var(--pass)"
                strokeWidth={1.6}
                fill="url(#dkmFillPass)"
              />
              <Area
                dataKey="failed"
                name="失败"
                type="linear"
                stroke="var(--fail)"
                strokeWidth={1.6}
                fill="url(#dkmFillFail)"
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* 图例 */}
          <div className="mt-1 flex items-center justify-end gap-3 px-2 text-[10.5px]" style={{ color: "var(--ink2)" }}>
            <Legend color="var(--pass)" label="通过" />
            <Legend color="var(--fail)" label="失败" />
          </div>
        </div>
      )}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
}

/** hover tooltip:日期 + 当日通过/失败的题数。 */
function TrendTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as DayBucket | undefined;
  if (!row) return null;
  return (
    <div
      className="rounded-lg px-2.5 py-1.5 text-[11px]"
      style={{
        background: "var(--dk-surface)",
        border: "1px solid var(--l2)",
        boxShadow: "0 8px 24px -10px rgba(16,24,40,.25)",
        color: "var(--ink1)",
      }}
    >
      <div className="mono mb-1 font-medium" style={{ color: "var(--ink1)" }}>
        {row.label}
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5" style={{ color: "var(--ink2)" }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--pass)" }} />
          通过 <span className="mono" style={{ color: "var(--ink1)" }}>{row.passed}</span> 题
        </span>
        <span className="inline-flex items-center gap-1.5" style={{ color: "var(--ink2)" }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--fail)" }} />
          失败 <span className="mono" style={{ color: "var(--ink1)" }}>{row.failed}</span> 题
        </span>
      </div>
    </div>
  );
}
