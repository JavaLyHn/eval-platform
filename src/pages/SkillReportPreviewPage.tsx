import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";

import { HomeButton } from "@/components/home-button";
import { CalibrationAuditPanel } from "@/components/skillopt/calibration-audit-panel";
import { ReleaseVerdictCard } from "@/components/skillopt/release-verdict-card";
import { ResultDashboard } from "@/components/skillopt/result-dashboard";
import { SkillReportMetaCard } from "@/components/skillopt/skill-report-meta-card";
import { useQAStore } from "@/hooks/use-qa-store";
import { reportVisibleTo } from "@/lib/report-visibility";
import { releaseVerdict, skillReportStats, type ReleaseTier } from "@/lib/skill-report";
import { cn } from "@/lib/utils";

const TIER_META: Record<ReleaseTier, { label: string; cls: string }> = {
  recommend: { label: "✅ 建议发版", cls: "bg-success/15 text-success" },
  caution: { label: "⚠️ 谨慎", cls: "bg-warning/15 text-warning" },
  reject: { label: "⛔ 不建议", cls: "bg-destructive/15 text-destructive" },
  "pending-review": { label: "待人审", cls: "bg-muted text-muted-foreground" },
};

export function SkillReportPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const { skillReports, user, setSkillReportAudit, setSkillReportThresholds } = useQAStore();
  const report = skillReports.find((r) => r.id === id);
  const visible = report ? reportVisibleTo(report, user) : false;
  const ok = !!report && visible;
  const verdict = report && visible ? releaseVerdict(report) : null;
  const stats = report && visible ? skillReportStats(report) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 gap-y-2 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0 flex-1">
          {/* 面包屑 */}
          <div className="mb-1 flex flex-wrap items-center gap-3">
            <HomeButton />
            <span className="text-border">/</span>
            <Link
              to="/reports"
              className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> 评测报告
            </Link>
            <span className="text-border">/</span>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground">
              <FileText className="h-3.5 w-3.5 text-foreground/70" /> Skill 评测报告
            </span>
          </div>

          {/* 标题 + 关键元信息(参照 agent 报告,填满顶部) */}
          {ok && report && (
            <>
              <h1 className="truncate text-[18px] font-semibold text-foreground">
                {report.title}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                {verdict && (
                  <span
                    className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold",
                      TIER_META[verdict.tier].cls,
                    )}
                    title={verdict.reasons.join(" · ")}
                  >
                    {TIER_META[verdict.tier].label}
                  </span>
                )}
                {report.meta.employeeLabel && (
                  <>
                    <span className="text-border">·</span>
                    <span>
                      Agent{" "}
                      <span className="font-medium text-foreground">
                        {report.meta.employeeLabel}
                      </span>
                    </span>
                  </>
                )}
                <span className="text-border">·</span>
                <span>
                  被测对象{" "}
                  <span className="font-medium text-foreground">
                    {report.meta.targetLabel}
                  </span>
                </span>
                <span className="text-border">·</span>
                <span>
                  模型{" "}
                  <span className="font-medium text-foreground">
                    {report.meta.targetModel}
                  </span>
                </span>
                {stats && stats.total > 0 && (
                  <>
                    <span className="text-border">·</span>
                    <span>
                      留出通过{" "}
                      <span className="font-medium text-foreground">
                        {stats.passN}/{stats.total}
                      </span>
                    </span>
                  </>
                )}
                <span className="text-border">·</span>
                <span>{report.meta.epochs} epoch</span>
                <span className="text-border">·</span>
                <span>{new Date(report.createdAt).toLocaleString()}</span>
              </div>
            </>
          )}
        </div>
      </header>
      {!ok || !report ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
          报告不存在或已删除。
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-3xl space-y-4">
            <SkillReportMetaCard report={report} />
            <ReleaseVerdictCard
              report={report}
              onThresholdsChange={(t) => setSkillReportThresholds(report.id, t)}
            />
            <CalibrationAuditPanel
              report={report}
              onMark={(m) => setSkillReportAudit(report.id, m)}
            />
            <ResultDashboard frame={report.frame} logs={report.logs} />
          </div>
        </div>
      )}
    </div>
  );
}
