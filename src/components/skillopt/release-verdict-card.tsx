import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, ShieldCheck, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

import { Input } from "@/components/ui/input";
import {
  releaseVerdict,
  DEFAULT_GATE_THRESHOLDS,
  type SkillEvalReport,
  type ReleaseGateThresholds,
  type ReleaseTier,
} from "@/lib/skill-report";

const TIER_META: Record<ReleaseTier, { label: string; cls: string }> = {
  recommend: { label: "建议发版", cls: "bg-success/15 text-success" },
  caution: { label: "谨慎", cls: "bg-warning/15 text-warning" },
  reject: { label: "不建议", cls: "bg-destructive/15 text-destructive" },
  "pending-review": { label: "待人审", cls: "bg-muted text-muted-foreground" },
};

const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

interface Props {
  report: SkillEvalReport;
  onThresholdsChange: (t: ReleaseGateThresholds) => void;
}

export function ReleaseVerdictCard({ report, onThresholdsChange }: Props) {
  const v = releaseVerdict(report);
  const tier = TIER_META[v.tier];
  const cal = v.calibration;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className={cn("rounded px-2.5 py-1 text-[13px] font-semibold", tier.cls)}>{tier.label}</span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
          <ShieldCheck className="h-4 w-4 text-foreground/70" /> 发版结论
        </span>
      </div>

      <ul className="space-y-0.5 text-[12px] text-muted-foreground">
        {v.reasons.map((r) => (
          <li key={r}>· {r}</li>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Signal title="留出集(hard/soft)" danger={v.heldout.regressed}>
          <span className="inline-flex items-center gap-1">
            {fmt(v.heldout.baselineSoft)} → <b>{fmt(v.heldout.bestSoft)}</b>
            {(() => {
              const b = v.heldout.baselineSoft;
              const t = v.heldout.bestSoft;
              if (b == null || t == null || t === b) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
              return t > b
                ? <TrendingUp className="h-3.5 w-3.5 text-success" />
                : <TrendingDown className="h-3.5 w-3.5 text-destructive" />;
            })()}
          </span>
        </Signal>
        <Signal title="校准 / 抽审" ok={cal.gatePass}>
          一致 {cal.agreePct ?? "—"}% · 已审 {cal.reviewed}/{cal.heldoutTotal}
        </Signal>
      </div>

      <ThresholdInputs thresholds={cal.thresholds} onCommit={onThresholdsChange} />
    </div>
  );
}

function Signal({
  title,
  children,
  danger,
  ok,
}: {
  title: string;
  children: ReactNode;
  danger?: boolean;
  ok?: boolean;
}) {
  const tone = danger ? "border-destructive/40" : ok ? "border-success/40" : "border-border";
  return (
    <div className={cn("rounded border bg-background/40 px-2.5 py-1.5", tone)}>
      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="text-[12.5px] text-foreground">{children}</div>
    </div>
  );
}

function ThresholdInputs({
  thresholds,
  onCommit,
}: {
  thresholds: ReleaseGateThresholds;
  onCommit: (t: ReleaseGateThresholds) => void;
}) {
  const [agree, setAgree] = useState(String(thresholds.agreePct));
  const [cov, setCov] = useState(String(thresholds.coveragePct));

  useEffect(() => {
    setAgree(String(thresholds.agreePct));
  }, [thresholds.agreePct]);
  useEffect(() => {
    setCov(String(thresholds.coveragePct));
  }, [thresholds.coveragePct]);

  const commit = () => onCommit({ agreePct: Number(agree), coveragePct: Number(cov) });
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2.5 text-[11.5px] text-muted-foreground">
      <span>
        发版门槛(默认 {DEFAULT_GATE_THRESHOLDS.agreePct}/{DEFAULT_GATE_THRESHOLDS.coveragePct}):
      </span>
      <label className="inline-flex items-center gap-1">
        一致率
        <Input
          type="number"
          min={0}
          max={100}
          value={agree}
          onChange={(e) => setAgree(e.target.value)}
          onBlur={commit}
          className="h-7 w-16 text-[11.5px]"
        />
        %
      </label>
      <label className="inline-flex items-center gap-1">
        覆盖
        <Input
          type="number"
          min={0}
          max={100}
          value={cov}
          onChange={(e) => setCov(e.target.value)}
          onBlur={commit}
          className="h-7 w-16 text-[11.5px]"
        />
        %
      </label>
    </div>
  );
}
