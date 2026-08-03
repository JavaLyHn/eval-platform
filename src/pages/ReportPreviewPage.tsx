/**
 * Read-only HTML preview of an EvaluationReport.
 *
 *   Header: title · agent · created · counts · actions (export md, delete, back)
 *   Body:   numbered list of (question prompt, answer, evaluation)
 *
 * The report is a frozen snapshot — even if its referenced question or
 * evaluation is later edited / deleted, this page renders the values that
 * were captured at generation time.
 */

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  MessageSquareText,
  Paperclip,
  Trash2,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/ui/markdown";
import { AttachmentList } from "@/components/question-panel/attachment-list";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import { FailureAttributionBadge } from "@/components/question-panel/failure-attribution-badge";
import { useQAStore } from "@/hooks/use-qa-store";
import {
  reportFileName,
  reportHtmlFileName,
  reportToHtml,
  reportToMarkdown,
} from "@/lib/report-export";
import { downloadBlob } from "@/lib/io";
import { cn, formatRelativeTime } from "@/lib/utils";
import { evaluateReleaseGate } from "@/lib/release-gate";
import { ReportMetricsBlock } from "@/components/question-panel/report-metrics-block";
import { ReportCompareControl } from "@/components/question-panel/report-compare-control";
import { HomeButton } from "@/components/home-button";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { resolveEmployeeForProfile } from "@/lib/employee-resolve";
import { cleanJudgeNotes } from "@/lib/judge";
import type { ReportItem } from "@/types";

export function ReportPreviewPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { reports, deleteReport, profiles, standardEmployees, employeeProfileMap } = useQAStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  const [searchParams] = useSearchParams();
  const [compareId, setCompareId] = useState<string>(() => searchParams.get("compare") ?? "");
  // 从「评测运行」页进来 → 面包屑返回链指向 /runs(而非评测报告列表)。
  const fromRuns = searchParams.get("from") === "runs";

  const report = useMemo(
    () => reports.find((r) => r.id === id) ?? null,
    [reports, id],
  );

  // 可对比的历史版本:同 Agent、带指标、非自身;由用户在报告里自选对比谁(默认不对比)。
  const compareCandidates = useMemo(
    () =>
      reports
        .filter(
          (r) =>
            !!report &&
            r.id !== report.id &&
            r.agentProfileId === report.agentProfileId &&
            !!r.metrics,
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [reports, report],
  );
  const compareReport =
    compareCandidates.find((r) => r.id === compareId) ?? null;

  // 被测 agent 头像:用报告里的 agentProfileId 反查标准员工(认不出 → null → 头像组件回退 👤)。
  const employee = useMemo(
    () => resolveEmployeeForProfile(report?.agentProfileId, profiles, standardEmployees, employeeProfileMap),
    [report, profiles, standardEmployees, employeeProfileMap],
  );

  const summary = useMemo(() => {
    if (!report) return null;
    const passed = report.items.filter((i) => i.verdict === "passed").length;
    const failed = report.items.filter((i) => i.verdict === "failed").length;
    const scored = report.items.filter(
      (i) => typeof i.autoScore === "number",
    );
    const avg =
      scored.length > 0
        ? scored.reduce((s, i) => s + (i.autoScore ?? 0), 0) / scored.length
        : 0;
    return { passed, failed, avg };
  }, [report]);

  if (!report || !summary) {
    return (
      <div className="flex h-full items-center justify-center text-[12.5px] text-muted-foreground">
        <div className="text-center">
          <div className="mb-2">报告不存在或已被删除</div>
          <div className="inline-flex items-center gap-2">
            <HomeButton />
            <Link
              to="/library"
              className="inline-flex items-center gap-1 text-[12px] text-foreground underline-offset-4 hover:underline"
            >
              <ArrowLeft className="h-3 w-3" /> 返回题库
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 冻结值优先;老报告(无 canRelease 字段)按 items 现算兜底。
  const gate =
    report.canRelease != null
      ? { canRelease: report.canRelease, blockers: report.releaseBlockers ?? [] }
      : evaluateReleaseGate(
          report.items.map((i) => ({
            verdict: i.verdict,
            failureAttribution: i.failureAttribution,
            key: i.questionId,
            label: i.questionTitle,
          })),
        );

  const handleExportMd = () => {
    const md = reportToMarkdown(report, compareReport ?? undefined);
    downloadBlob(reportFileName(report), md, "text/markdown;charset=utf-8");
  };

  const handleExportHtml = () => {
    const html = reportToHtml(report, compareReport ?? undefined);
    downloadBlob(reportHtmlFileName(report), html, "text/html;charset=utf-8");
  };

  const handleCopyMd = async () => {
    try {
      await navigator.clipboard.writeText(
        reportToMarkdown(report, compareReport ?? undefined),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard 不可用时静默(用户可改用导出) */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 gap-y-2 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-3">
            <HomeButton />
            <span className="text-border">/</span>
            <Link
              to={fromRuns ? "/runs" : "/reports"}
              className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> {fromRuns ? "评测运行" : "评测报告"}
            </Link>
            <span className="text-border">/</span>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground">
              <FileText className="h-3.5 w-3.5 text-foreground/70" /> Agent 评测报告
            </span>
          </div>
          <h1 className="truncate text-[18px] font-semibold text-foreground">
            {report.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold",
                gate.canRelease
                  ? "bg-success/15 text-success"
                  : "bg-destructive/15 text-destructive",
              )}
              title={
                gate.canRelease
                  ? "无安全红线失败 · 可发布"
                  : `${gate.blockers.length} 条安全红线失败 · 不可发布(一票否决)`
              }
            >
              {gate.canRelease ? "✅ 可发布" : `⛔ 不可发布 · ${gate.blockers.length}`}
            </span>
            <span className="text-border">·</span>
            <span className="inline-flex items-center gap-1">
              被测 Agent：
              <EmployeeAvatar employee={employee} size={16} />
              <span className="font-medium text-foreground">
                {report.agentName}
              </span>
            </span>
            <span className="text-border">·</span>
            <span>{report.items.length} 道题</span>
            <span className="text-border">·</span>
            <span className="text-success">{summary.passed} 通过</span>
            {summary.failed > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="text-destructive">
                  {summary.failed} 失败
                </span>
              </>
            )}
            <span className="text-border">·</span>
            <span>
              均分{" "}
              <span className="font-mono tabular-nums text-foreground">
                {summary.avg > 0 ? summary.avg.toFixed(2) : "—"}
              </span>{" "}
              / 10
            </span>
            <span className="text-border">·</span>
            <span title={new Date(report.createdAt).toLocaleString()}>
              生成 {formatRelativeTime(report.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex flex-wrap items-center gap-1 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={handleCopyMd}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "已复制" : "复制 Markdown"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={handleExportMd}
            >
              <Download className="h-3.5 w-3.5" />
              导出 Markdown
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={handleExportHtml}
              title="导出为自包含 HTML(逐题完整、可直接在浏览器打开 / 打印)"
            >
              <Download className="h-3.5 w-3.5" />
              导出 HTML
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          </div>
          {/* 对比版本:与左侧「可发布 · 被测 Agent · …」同行的最右侧,在复制 Markdown 下方 */}
          <ReportCompareControl
            report={report}
            candidates={compareCandidates}
            compareId={compareId}
            onCompareChange={setCompareId}
          />
        </div>
      </header>

      {/* Body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="mx-auto max-w-[920px] space-y-4 px-6 py-6">
          <ReportMetricsBlock report={report} />
          {report.items.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-card/40 px-6 py-12 text-center text-[12.5px] text-muted-foreground">
              这份报告里没有任何题目记录
            </div>
          ) : (
            report.items.map((item, idx) => (
              <Item
                key={`${item.questionId}-${idx}`}
                idx={idx + 1}
                item={item}
                nameOf={(jid) => profiles.find((p) => p.id === jid)?.name ?? jid}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`删除报告「${report.title}」？`}
        description="操作不可撤销。报告里的题目、回答、评分都不受影响。"
        onConfirm={() => {
          deleteReport(report.id);
          setConfirmDelete(false);
          navigate("/library");
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * 老报告(无 judges 字段)的 notes 里会嵌 `[#1 ap_xxx] passed：…` 这类代号 —— 用
 * profiles 把 id 还原成模型名、passed/failed 翻成中文,渲染时美化(新报告已结构化,不走这里)。
 */
function prettifyLegacyNotes(notes: string, nameOf: (id: string) => string): string {
  // 先清掉历史脏数据里漏出的 JSON 尾巴(", "failureCategory": …),再美化代号。
  return cleanJudgeNotes(notes)
    .replace(/\[#\d+\s+([A-Za-z][\w-]*)\]/g, (_m, id: string) => `[${nameOf(id)}]`)
    .replace(/\]\s*passed\s*：/g, "] 通过：")
    .replace(/\]\s*failed\s*：/g, "] 失败：");
}

function Item({
  idx,
  item,
  nameOf,
}: {
  idx: number;
  item: ReportItem;
  nameOf: (id: string) => string;
}) {
  const passed = item.verdict === "passed";
  const judges = item.judges ?? [];
  const multiJudge = judges.length > 1;
  return (
    <article className="rounded-lg border border-border bg-card">
      <header className="flex items-start gap-3 border-b border-border px-4 py-2.5">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
          {idx}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-foreground">
            {item.questionTitle}
          </div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            评测时间：{new Date(item.submittedAt).toLocaleString()}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {passed ? (
            <Badge variant="success" className="gap-1 text-[10.5px]">
              <CheckCircle2 className="h-3 w-3" />
              通过
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1 text-[10.5px]">
              <XCircle className="h-3 w-3" />
              失败
            </Badge>
          )}
          {!passed && item.failureAttribution && (
            <FailureAttributionBadge attribution={item.failureAttribution} />
          )}
          {item.passK && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                item.passK.passPowerK
                  ? "bg-success/15 text-success"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
              )}
              title="多 trial pass^k:跑满 k 次且每次都通过才算达标(保下限,面向客户口径)"
            >
              pass^{item.passK.k} · 通过 {item.passK.passed}/{item.passK.trials}
            </span>
          )}
          {/* 顶层只保留通过/失败结论;具体得分细节归到下方各裁判/各轮各自展开。 */}
        </div>
      </header>

      <div className="space-y-3 px-4 py-3 text-[12.5px]">
        {/* 题目(用户提问)—— 灰底头,左侧中性强调条 */}
        <section className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-1.5 border-b border-border bg-secondary/60 px-3 py-1.5 text-[11px] font-semibold text-foreground">
            <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" />
            题目
          </div>
          <div className="border-l-2 border-muted-foreground/30 px-3 py-2.5">
            <Markdown>{item.questionPrompt}</Markdown>
            {item.attachments && item.attachments.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  附件（随题发送给 agent · {item.attachments.length}）
                </div>
                <AttachmentList attachments={item.attachments} />
              </div>
            )}
          </div>
        </section>

        {/* 多 trial 试跑:同题 K 次逐次展开(每次回答+判定),pass^k 汇总在卡头。
            多 trial 只测通过率/稳定性,故各次只判通过/失败、不打维度分。 */}
        {item.trials && item.trials.length > 0 ? (
          <section className="space-y-2">
            <SectionLabel>
              多 trial 试跑（{item.passK?.k ?? item.trials.length} 次 · 通过{" "}
              {item.passK?.passed ?? item.trials.filter((t) => t.verdict === "passed").length}/
              {item.passK?.trials ?? item.trials.length} ·{" "}
              {item.passK?.passPowerK ? "pass^k 达标" : "pass^k 未达标（任一次失败即不达标）"}）
            </SectionLabel>
            {item.trials.map((t) => (
              <div
                key={t.trialIndex}
                className="overflow-hidden rounded-lg border border-border"
              >
                <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[9px] font-semibold text-background">
                    {t.trialIndex + 1}
                  </span>
                  第 {t.trialIndex + 1} 次
                  <Badge
                    variant={t.verdict === "passed" ? "success" : "destructive"}
                    className="h-4 px-1 text-[9.5px]"
                  >
                    {t.verdict === "passed" ? "通过" : "失败"}
                  </Badge>
                </div>
                <div className="space-y-2 px-3 py-2">
                  <div className="rounded border border-accent/30 bg-accent/[0.04] px-2 py-1.5 text-[11.5px]">
                    <div className="mb-0.5 flex items-center gap-1 text-[9.5px] font-medium text-muted-foreground">
                      <Bot className="h-3 w-3 text-accent" /> 本次 Agent 回答
                    </div>
                    {t.answer.trim() ? (
                      <Markdown>{t.answer}</Markdown>
                    ) : (
                      <p className="text-muted-foreground">（无回答）</p>
                    )}
                  </div>
                  {t.notes && (
                    <p className="text-[11px] text-muted-foreground">
                      评语：{prettifyLegacyNotes(t.notes, nameOf)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </section>
        ) : /* 困难题逐轮:逐轮展开(每轮提问+回答+判定/分),整题汇总在卡头 */
        item.subResults && item.subResults.length > 0 ? (
          <section className="space-y-2">
            <SectionLabel>
              逐轮评分（{item.subResults.length} 轮 · 任一轮失败即整题失败）
            </SectionLabel>
            {item.subResults.map((s) => (
              <div
                key={s.subIndex}
                className="overflow-hidden rounded-lg border border-border"
              >
                <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[9px] font-semibold text-background">
                    {s.subIndex + 1}
                  </span>
                  第 {s.subIndex + 1} 轮
                  <Badge
                    variant={s.verdict === "passed" ? "success" : "destructive"}
                    className="h-4 px-1 text-[9.5px]"
                  >
                    {s.verdict === "passed" ? "通过" : "失败"}
                  </Badge>
                  {typeof s.autoScore === "number" && (
                    <span className="font-mono text-[10.5px] tabular-nums text-foreground">
                      {s.autoScore.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="space-y-2 px-3 py-2">
                  {s.userPrompt && (
                    <div className="rounded border border-border bg-secondary/30 px-2 py-1.5 text-[11.5px]">
                      <div className="mb-0.5 text-[9.5px] font-medium text-muted-foreground">
                        本轮用户提问
                      </div>
                      <Markdown>{s.userPrompt}</Markdown>
                    </div>
                  )}
                  <div className="rounded border border-accent/30 bg-accent/[0.04] px-2 py-1.5 text-[11.5px]">
                    <div className="mb-0.5 flex items-center gap-1 text-[9.5px] font-medium text-muted-foreground">
                      <Bot className="h-3 w-3 text-accent" /> 本轮 Agent 回答
                    </div>
                    {s.answer.trim() ? (
                      <Markdown>{s.answer}</Markdown>
                    ) : (
                      <p className="text-muted-foreground">（无回答）</p>
                    )}
                  </div>
                  {s.scores.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {s.scores.map((d) => (
                        <span
                          key={d.key}
                          className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/20 px-1.5 py-0.5 text-[10px]"
                        >
                          <span className="text-muted-foreground">{d.label}</span>
                          <span
                            className={cn(
                              "font-mono tabular-nums",
                              d.value >= 8
                                ? "text-success"
                                : d.value >= 5
                                  ? "text-foreground"
                                  : "text-destructive",
                            )}
                          >
                            {d.value.toFixed(1)}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  {s.notes && (
                    <p className="text-[11px] text-muted-foreground">
                      评语：{prettifyLegacyNotes(s.notes, nameOf)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </section>
        ) : (
          /* 回答(Agent)—— accent 头 + 淡色底,与题目明显区分 */
          <section className="overflow-hidden rounded-lg border border-accent/30">
            <div className="flex items-center gap-1.5 border-b border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-foreground">
              <Bot className="h-3.5 w-3.5 text-accent" />
              Agent 回答
            </div>
            <div className="border-l-2 border-accent/50 bg-accent/[0.04] px-3 py-2.5">
              {item.answer.trim() ? (
                <Markdown>{item.answer}</Markdown>
              ) : (
                <p className="text-muted-foreground">（无回答）</p>
              )}
            </div>
          </section>
        )}

        {/* 各裁判逐个结果(多 judge 校准时最关键:谁判通过、谁判失败一目了然) */}
        {judges.length > 0 && (
          <section>
            <SectionLabel>
              {multiJudge ? `各裁判结果(${judges.length} 位）` : "评测者"}
              {item.judgePromptVersion != null && (
                <span
                  className="ml-1.5 rounded bg-secondary px-1 py-px font-mono text-[9.5px] font-medium normal-case text-muted-foreground"
                  title="本次 LLM 评测实际使用的判分 prompt 版本(Prompt 管理 · llm-judge)"
                >
                  判分 Prompt{" "}
                  {item.judgePromptVersion === 1
                    ? "内置默认 v1"
                    : `v${item.judgePromptVersion}`}
                </span>
              )}
              {item.agreementRate != null && (
                <span
                  className={cn(
                    "ml-1.5 rounded px-1 py-px text-[9.5px] font-medium normal-case",
                    item.agreementRate >= 85
                      ? "bg-success/15 text-success"
                      : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                  )}
                  title="多裁判 Pass/Fail 一致率,≥85% 视为校准达标"
                >
                  一致率 {item.agreementRate}%
                </span>
              )}
            </SectionLabel>
            <ul className="mt-1 space-y-1.5">
              {judges.map((j, i) => (
                <li
                  key={`${j.name}-${i}`}
                  className="rounded-md border border-border/60 bg-muted/10 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {j.verdict === "passed" ? (
                      <Badge variant="success" className="gap-1 text-[10px]">
                        <CheckCircle2 className="h-3 w-3" />
                        通过
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1 text-[10px]">
                        <XCircle className="h-3 w-3" />
                        失败
                      </Badge>
                    )}
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground">
                      {j.kind === "human" ? "🧑" : "🤖"} {j.name}
                    </span>
                    {typeof j.score === "number" && (
                      <span className="ml-auto shrink-0 font-mono text-[11.5px] tabular-nums text-muted-foreground">
                        {j.score.toFixed(2)} / 10
                      </span>
                    )}
                  </div>
                  {/* 该裁判各自的维度分(写在自己名下,不再塌缩成一处均值) */}
                  {j.scores && j.scores.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {j.scores.map((d) => (
                        <span
                          key={d.key}
                          className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/20 px-1.5 py-0.5 text-[10.5px]"
                        >
                          <span className="text-muted-foreground">{d.label}</span>
                          <span
                            className={cn(
                              "font-mono tabular-nums",
                              d.value >= 8
                                ? "text-success"
                                : d.value >= 5
                                  ? "text-foreground"
                                  : "text-destructive",
                            )}
                          >
                            {d.value.toFixed(1)}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  {j.notes && (
                    <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-foreground/80">
                      {j.notes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 评分维度兜底:只在「没有逐裁判维度、也没有逐轮」时显示综合维度(避免与
            上面各裁判各自的维度分重复;老报告/单一来源仍能看到维度)。 */}
        {item.scores.length > 0 &&
          !judges.some((j) => j.scores && j.scores.length > 0) &&
          !(item.subResults && item.subResults.length > 0) && (
          <section>
            <SectionLabel>
              评分维度{multiJudge ? "(多裁判均分)" : ""}
            </SectionLabel>
            <ul className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {item.scores.map((s) => (
                <li
                  key={s.key}
                  className="flex items-center justify-between rounded border border-border/60 bg-muted/20 px-2.5 py-1.5"
                >
                  <span className="truncate text-[12px] text-foreground/85">
                    {s.label}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-mono tabular-nums text-[12px]",
                      s.value >= 8
                        ? "text-success"
                        : s.value >= 5
                          ? "text-foreground"
                          : "text-destructive",
                    )}
                  >
                    {s.value.toFixed(1)} / {s.max}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 综合评语:仅当没有结构化裁判明细时显示(否则与上面各裁判评语重复);老报告 notes 里的代号会被美化 */}
        {item.notes && judges.length === 0 && (
          <section>
            <SectionLabel>评语</SectionLabel>
            <p className="mt-1 whitespace-pre-wrap rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-[12px] text-foreground/85">
              {prettifyLegacyNotes(item.notes, nameOf)}
            </p>
          </section>
        )}
      </div>
    </article>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}
