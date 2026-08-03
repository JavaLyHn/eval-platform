import { SlidersHorizontal } from "lucide-react";

export function RunConfigSummary({
  caseSourceLabel,
  epochs,
  gateMetric,
  targetModel,
  optimizerModel,
  skillUpdateMode,
}: {
  caseSourceLabel: string;
  epochs: number;
  gateMetric?: string;
  targetModel?: string;
  optimizerModel?: string;
  skillUpdateMode?: string;
}) {
  const chips: string[] = [
    `题集:${caseSourceLabel}`,
    `${epochs} epoch`,
  ];
  if (gateMetric) chips.push(`gate=${gateMetric}`);
  if (skillUpdateMode) chips.push(`更新=${skillUpdateMode}`);
  if (targetModel) chips.push(`被测=${targetModel}`);
  if (optimizerModel) chips.push(`优化器=${optimizerModel}`);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
      {chips.map((c, i) => (
        <span key={i} className="rounded bg-secondary px-1.5 py-0.5">{c}</span>
      ))}
    </div>
  );
}
