import { Card } from "@/components/ui/card";
import { type SkillEvalReport } from "@/lib/skill-report";

export function SkillReportMetaCard({ report }: { report: SkillEvalReport }) {
  const m = report.meta;
  const rows: [string, string][] = [
    ...(m.employeeLabel ? ([["Agent / 员工", m.employeeLabel]] as [string, string][]) : []),
    ["被测对象", m.targetLabel],
    ["被测模型", m.targetModel],
    ["优化器模型", m.optimizerModel],
    ["轮次", `${m.epochs} epoch`],
    ["接受准则 / 更新模式", `${m.gateMetric ?? "默认"} · ${m.skillUpdateMode ?? "默认"}`],
    ["运行耗时", `${Math.round(m.wallTimeS)}s`],
    ["tokens", m.tokens ? `${m.tokens.totalTokens}(${m.tokens.calls} 次调用)` : "—"],
    ["生成时间", new Date(report.createdAt).toLocaleString()],
  ];
  return (
    <Card className="space-y-2 p-4">
      <div className="text-[13px] font-semibold">{report.title}</div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className="truncate text-right text-foreground" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
