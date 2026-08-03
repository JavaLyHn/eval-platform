import { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  /** A CSS color expression — e.g. `hsl(var(--success))`. */
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  /** Big text shown in the middle (e.g. "73%" or total count). */
  centerValue?: string;
  /** Small text under the center value. */
  centerLabel?: string;
  /** Chart diameter in pixels. */
  size?: number;
  /** Ring thickness in pixels. */
  thickness?: number;
  className?: string;
}

/**
 * Lightweight donut/ring chart. Hand-rolled SVG so we don't pull in a chart
 * lib for what's basically a few arcs and a label.
 */
export function DonutChart({
  segments,
  centerValue,
  centerLabel,
  size = 132,
  thickness = 16,
  className,
}: DonutChartProps) {
  const total = useMemo(
    () => segments.reduce((s, x) => s + Math.max(0, x.value), 0),
    [segments],
  );

  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;

  // Build per-segment arc descriptors.
  const arcs = useMemo(() => {
    if (total <= 0) return [];
    let offset = 0;
    return segments.map((s) => {
      const len = (Math.max(0, s.value) / total) * C;
      const arc = { ...s, len, offset };
      offset += len;
      return arc;
    });
  }, [segments, total, C]);

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          className="-rotate-90"
        >
          {/* Track */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={thickness}
          />
          {/* Segments */}
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={thickness}
              strokeDasharray={`${a.len} ${C - a.len}`}
              strokeDashoffset={-a.offset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        {(centerValue || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {centerValue && (
              <div className="font-mono text-xl font-semibold tabular-nums text-foreground">
                {centerValue}
              </div>
            )}
            {centerLabel && (
              <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                {centerLabel}
              </div>
            )}
          </div>
        )}
      </div>
      <ul className="grid w-full gap-x-3 gap-y-1 text-[11px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))" }}>
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="truncate text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-mono tabular-nums text-foreground">
              {s.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
