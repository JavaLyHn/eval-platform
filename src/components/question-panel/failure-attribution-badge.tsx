import { FAILURE_CATEGORY_META } from "@/lib/failure-attribution";
import type { FailureAttribution } from "@/types";

/** 失败归因小徽章(复用于评测结果 / 报告)。主因彩色,次因灰显。 */
export function FailureAttributionBadge({
  attribution,
  className,
}: {
  attribution?: FailureAttribution;
  className?: string;
}) {
  if (!attribution) return null;
  const m = FAILURE_CATEGORY_META[attribution.primary];
  const secLabels = (attribution.secondary ?? [])
    .map((c) => FAILURE_CATEGORY_META[c].label)
    .join(" / ");
  return (
    <span
      className={className}
      title={`${m.label}类 · ${m.fixHint}${secLabels ? ` · 次因 ${secLabels}` : ""}${attribution.source === "redline" ? " · 红线" : ""}`}
      style={{ color: m.color }}
    >
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: `${m.color}22` }}>
        ● {m.label}
        {secLabels && <span className="opacity-70">+{secLabels}</span>}
      </span>
    </span>
  );
}
