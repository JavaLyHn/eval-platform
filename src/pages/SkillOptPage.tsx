import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ClipboardList, Sparkles, Square, Terminal } from "lucide-react";
import { HomeButton } from "@/components/home-button";
import { HeaderIconBadge } from "@/components/header-icon-badge";
import { MasterDetailShell } from "@/components/layout/master-detail-shell";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
// 「原理」按钮要展示的两张说明图(放在 docs/images,import 由 Vite 打包)。
import principleImg1 from "../../docs/images/skillopt-principle-1.png";
import principleImg2 from "../../docs/images/skillopt-principle-2.png";

import { buildCaseSplits, caseSplitsToView, type CaseBuildResult } from "@/lib/question-to-skillopt-case";
import { filterSkillQuestions, skillCaseToQuestionDraft } from "@/lib/skill-question";
import type { SkillOptCase } from "@/lib/question-to-skillopt-case";

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { GATEWAY_EMPLOYEES } from "@/lib/extended-employees";
import { runSkillOpt, type SkillOptFrame, type SkillOptDoneFrame } from "@/lib/skillopt-client";
import { ResultDashboard } from "@/components/skillopt/result-dashboard";
import { RunConfigCard } from "@/components/skillopt/run-config-card";
import type { SeedSkillSelection } from "@/components/skillopt/skill-browser";
import { reduceStage, INITIAL_RUN_STATUS, type RunStatus } from "@/lib/skillopt-stages";
import { RunMetricsStrip } from "@/components/skillopt/run-metrics-strip";
import { CaseGrid } from "@/components/skillopt/case-grid";
import { ActivityFeed } from "@/components/skillopt/activity-feed";
import { parseEvent, reduceMetrics, INITIAL_METRICS, type RunEvent, type RunMetrics } from "@/lib/skillopt-run-events";
import { CaseSetsCard } from "@/components/skillopt/case-sets-card";
import { RunConfigSummary } from "@/components/skillopt/run-config-summary";
import { SaveSkillReportDialog } from "@/components/skillopt/save-skill-report-dialog";

type Status = "idle" | "running" | "done" | "error";

export function SkillOptPage() {
  const isMobile = useIsMobile();
  const { profiles, questions, standardEmployees, addQuestion } = useQAStore();
  const llmProfiles = useMemo(
    () => profiles.filter((p) => getProfileKind(p.providerId) === "llm"),
    [profiles],
  );

  const [profileId, setProfileId] = useState<string>("");
  const [seedSkill, setSeedSkill] = useState<SeedSkillSelection | null>(null);
  const employeeId = seedSkill?.standardEmployeeId ?? "";
  const skillName = seedSkill?.skillName ?? "";
  const skillCases = useMemo(
    () => filterSkillQuestions(questions, employeeId, skillName),
    [questions, employeeId, skillName],
  );
  const caseBuild: CaseBuildResult | null = useMemo(
    () => (skillCases.length ? buildCaseSplits(skillCases, 42) : null),
    [skillCases],
  );
  const [seedContent, setSeedContent] = useState<string>("");

  const [epochs, setEpochs] = useState(2);
  // pass^k 已停用(trainer 改用上游单次留出集评测)→ 仅作常量随请求发后端(被忽略),不再在参数 UI 暴露。
  const [passK] = useState(3);
  const [status, setStatus] = useState<Status>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [doneFrame, setDoneFrame] = useState<SkillOptDoneFrame | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus>(INITIAL_RUN_STATUS);
  const [events, setEvents] = useState<(RunEvent & { at: number })[]>([]);
  const [metrics, setMetrics] = useState<RunMetrics>(INITIAL_METRICS);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastOutputAt, setLastOutputAt] = useState<number | null>(null);
  const stageStartRef = useRef<number | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const [saveReportOpen, setSaveReportOpen] = useState(false);
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [targetModel, setTargetModel] = useState<string>("");
  const [optimizerModel, setOptimizerModel] = useState<string>("");
  const [gateMetric, setGateMetric] = useState<"" | "hard" | "soft" | "mixed">("");
  const [skillUpdateMode, setSkillUpdateMode] = useState<"" | "patch" | "rewrite_from_suggestions">("");
  const [useSlowUpdate, setUseSlowUpdate] = useState<boolean | null>(null);
  const [useMetaSkill, setUseMetaSkill] = useState<boolean | null>(null);
  // 进阶调参。数量类(滑块)给具体默认值并始终下发,默认值对齐 tiny_real.yaml;选项类 ""/null = 用 SkillOpt 默认。
  const [editBudget, setEditBudget] = useState(3);
  const [lrScheduler, setLrScheduler] = useState<"" | "constant" | "linear" | "cosine">("");
  const [reasoningEffort, setReasoningEffort] = useState<"" | "low" | "medium" | "high">("");
  const [batchSize, setBatchSize] = useState(8);
  const [analystWorkers, setAnalystWorkers] = useState(2);
  const [useGate, setUseGate] = useState<boolean | null>(null);

  const selectedProfile = llmProfiles.find((p) => p.id === profileId) ?? null;
  const cfg = (selectedProfile?.config ?? {}) as Record<string, unknown>;
  const canRun =
    status !== "running" &&
    !!selectedProfile && !!cfg.baseUrl && !!cfg.apiKey && !!cfg.model &&
    seedContent.trim().length > 0 &&
    !!caseBuild && caseBuild.canRun;

  const start = async () => {
    setStatus("running"); setLogs([]); setDoneFrame(null); setErrMsg("");
    setRunStatus(INITIAL_RUN_STATUS); setStartedAt(Date.now()); setLastOutputAt(Date.now());
    setEvents([]); setMetrics(INITIAL_METRICS);
    stageStartRef.current = Date.now();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const body: Parameters<typeof runSkillOpt>[0] = {
      mock: false,
      epochs,
      passK,
      llm: {
        baseUrl: String(cfg.baseUrl),
        apiKey: String(cfg.apiKey),
        model: String(cfg.model),
      },
      ...(seedContent.trim() ? { seedSkillContent: seedContent } : {}),
      ...(caseBuild?.canRun ? { caseSplits: caseBuild.splits } : {}),
      ...(targetModel.trim() ? { targetModel: targetModel.trim() } : {}),
      ...(optimizerModel.trim() ? { optimizerModel: optimizerModel.trim() } : {}),
      ...(gateMetric ? { gateMetric } : {}),
      ...(skillUpdateMode ? { skillUpdateMode } : {}),
      ...(useSlowUpdate !== null ? { useSlowUpdate } : {}),
      ...(useMetaSkill !== null ? { useMetaSkill } : {}),
      editBudget,
      batchSize,
      analystWorkers,
      ...(lrScheduler ? { lrScheduler } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(useGate !== null ? { useGate } : {}),
    };
    try {
      await runSkillOpt(body, {
        signal: ctrl.signal,
        onFrame: (f: SkillOptFrame) => {
          if (f.type === "log") {
            setLogs((p) => [...p, f.line]);
            setLastOutputAt(Date.now());
            setRunStatus((prev) => {
              const next = reduceStage(prev, f.line);
              if (next.stage !== prev.stage) stageStartRef.current = Date.now();
              return next;
            });
            setMetrics((m) => reduceMetrics(m, f.line));
            const ev = parseEvent(f.line);
            if (ev) setEvents((p) => [...p, { ...ev, at: Date.now() }]);
          } else if (f.type === "start") {
            setLogs((p) => [...p, `[start] outDir=${f.outDir} mock=${f.mock}`]);
          } else if (f.type === "done") {
            setDoneFrame(f); setRunStatus((p) => ({ ...p, stage: "done" })); setStatus("done");
          } else if (f.type === "error") {
            setErrMsg(f.message); setStatus("error");
          }
        },
      });
      setStatus((s) => (s === "running" ? "done" : s));
    } catch (e) {
      if ((e as Error).name === "AbortError") { setStatus("idle"); return; }
      setErrMsg((e as Error).message); setStatus("error");
    } finally {
      abortRef.current = null;
    }
  };

  const stop = () => { abortRef.current?.abort(); };

  const saveGeneratedCases = (cases: SkillOptCase[]) => {
    if (!employeeId || !skillName) return;
    const norm = (p: string) => p.trim().toLowerCase().replace(/\s+/g, " ");
    const seen = new Set(skillCases.map((q) => norm(q.prompt ?? "")));
    for (const c of cases) {
      const key = norm(c.prompt);
      if (seen.has(key)) continue; // 题面已存在 → 跳过,避免重复保存累积
      seen.add(key);
      addQuestion(skillCaseToQuestionDraft(c, { employeeId, skillName }));
    }
  };

  const selectedEmployee =
    [...standardEmployees, ...GATEWAY_EMPLOYEES].find((e) => e.id === employeeId) ?? null;
  const caseView = caseSplitsToView(caseBuild?.splits ?? { train: [], val: [], test: [] });
  const caseEmptyHint = !seedSkill
    ? "先在上方选技能。"
    : "该技能暂无题集 —— 在右侧生成并保存到题库。";
  const caseSourceLabel = skillName ? `${skillName} 题集` : "技能题集";
  // 有可评测题集(≥9 题、切分成功)才显示左侧题集列;否则只显示右侧 + 空态提示。
  const hasCases = !!(caseBuild && caseBuild.canRun);

  const configCard = (
    <RunConfigCard
      key="config-card"
      status={status}
      epochs={epochs}
      setEpochs={setEpochs}
      profileId={profileId}
      setProfileId={setProfileId}
      llmProfiles={llmProfiles}
      setSeedContent={setSeedContent}
      canRun={canRun}
      errMsg={errMsg}
      onStart={() => void start()}
      onStop={stop}
      skillName={skillName}
      skillBody={seedSkill?.skillBody ?? ""}
      employee={selectedEmployee}
      setSeedSkill={setSeedSkill}
      skillCaseCount={skillCases.length}
      caseBuildCanRun={!!caseBuild && caseBuild.canRun}
      caseShortfall={caseBuild?.shortfall ?? 9}
      onSaveCases={saveGeneratedCases}
      targetModel={targetModel} setTargetModel={setTargetModel}
      optimizerModel={optimizerModel} setOptimizerModel={setOptimizerModel}
      gateMetric={gateMetric} setGateMetric={setGateMetric}
      skillUpdateMode={skillUpdateMode} setSkillUpdateMode={setSkillUpdateMode}
      useSlowUpdate={useSlowUpdate} setUseSlowUpdate={setUseSlowUpdate}
      useMetaSkill={useMetaSkill} setUseMetaSkill={setUseMetaSkill}
      editBudget={editBudget} setEditBudget={setEditBudget}
      lrScheduler={lrScheduler} setLrScheduler={setLrScheduler}
      reasoningEffort={reasoningEffort} setReasoningEffort={setReasoningEffort}
      batchSize={batchSize} setBatchSize={setBatchSize}
      analystWorkers={analystWorkers} setAnalystWorkers={setAnalystWorkers}
      useGate={useGate} setUseGate={setUseGate}
    />
  );

  // configCard 必须待在同一面板,避免 hasCases 切换时被卸载重挂(用户已做的选择会丢)。
  // 抽成同一个变量,手机两个分支(hasCases 真/假)与桌面分支都引用同一元素树,不复制粘贴成多份 JSX。
  const configPanel = (
    <div className="h-full space-y-4 overflow-auto p-5">
      {!hasCases && (status === "idle" || status === "error") && (
        <div key="no-cases-hint" className="rounded-lg border border-dashed border-border bg-surface/40 p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <ClipboardList className="h-4 w-4 shrink-0 text-accent" />
            还没有可评测的题集
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            在下方选择<span className="font-medium text-foreground">员工 + 技能</span>,用「该技能题集」生成题目并保存到题库;
            攒够 <span className="font-medium text-foreground">9 题</span>后,左侧会自动展开该技能的题集,即可启动评测。
          </p>
        </div>
      )}

      {(status === "idle" || status === "error") && configCard}

      {status === "running" && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-foreground">评测进行中…</span>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setAbortConfirmOpen(true)}
            >
              <Square className="h-3.5 w-3.5" /> 终止
            </Button>
          </div>
          <RunMetricsStrip
            stage={runStatus.stage}
            innerStage={runStatus.innerStage}
            metrics={metrics}
            startedAt={startedAt}
            lastOutputAt={lastOutputAt}
            stageStartedAt={stageStartRef.current}
          />
          <CaseGrid status={runStatus} />
          <ActivityFeed events={events} />
          {/* 实时日志:运行中常开 + 自动滚到最新(取代原折叠抽屉,日志真正"实时可见") */}
          <LiveLogConsole logs={logs} running={status === "running"} />
          <RunConfigSummary
            caseSourceLabel={caseSourceLabel}
            epochs={epochs}
            gateMetric={gateMetric || undefined}
            targetModel={targetModel || undefined}
            optimizerModel={optimizerModel || undefined}
            skillUpdateMode={skillUpdateMode || undefined}
          />
        </>
      )}

      {status === "done" && doneFrame && (
        <>
          <ResultDashboard frame={doneFrame} logs={logs} />
          <RunConfigSummary
            caseSourceLabel={caseSourceLabel}
            epochs={epochs}
            gateMetric={gateMetric || undefined}
            targetModel={targetModel || undefined}
            optimizerModel={optimizerModel || undefined}
            skillUpdateMode={skillUpdateMode || undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setSaveReportOpen(true)}>保存为报告</Button>
            <Button variant="outline" size="sm" onClick={() => { setStatus("idle"); setDoneFrame(null); }}>
              重新配置 / 再跑一次
            </Button>
          </div>
          <SaveSkillReportDialog
            open={saveReportOpen}
            onOpenChange={setSaveReportOpen}
            frame={doneFrame}
            logs={logs}
            config={{
              caseSourceLabel,
              employeeLabel: selectedEmployee?.name,
              targetModel,
              optimizerModel,
              epochs,
              gateMetric,
              skillUpdateMode,
            }}
          />
        </>
      )}

      {status === "done" && !doneFrame && (
        <>
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-[12px] text-destructive">
            运行结束但未收到结果帧(可能中转 / 服务中断),请重试。
          </div>
          <LogDrawer logs={logs} />
          <Button variant="outline" size="sm" onClick={() => { setStatus("idle"); setDoneFrame(null); }}>
            重新配置 / 再跑一次
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex flex-wrap shrink-0 items-center gap-x-3 gap-y-2 border-b border-border px-5 py-3">
        <HomeButton />
        <HeaderIconBadge icon={Sparkles} />
        <h1 className="shrink-0 text-base font-semibold tracking-tight">Skill 评测</h1>
        <span className="hidden min-w-0 flex-1 truncate text-[12px] text-muted-foreground md:inline">
          <span className="mr-1 text-border">—</span>
          <span className="font-medium text-foreground">给一份技能(skill)做自动优化</span>
          :反复试跑 → 反思 → 只收更好的改动,产出更强的 skill。
        </span>
        {/* 原理:弹窗展示两张说明图(放在状态徽标左边) */}
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0 gap-1">
              <BookOpen className="h-3.5 w-3.5" /> 原理
            </Button>
          </DialogTrigger>
          <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-accent" /> Skill 优化原理
              </DialogTitle>
              <DialogDescription>
                生成题目后,SkillOpt 反复「试跑 → 反思 → 在选择集上择优」,产出更强的 skill。下面两张图说明整体原理。
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
              <img src={principleImg2} alt="Skill 优化原理图 2" className="w-full rounded-md border border-border" />
              <img src={principleImg1} alt="Skill 优化原理图 1" className="w-full rounded-md border border-border" />
            </div>
          </DialogContent>
        </Dialog>
        <div className="shrink-0">
          <StatusBadge status={status} />
        </div>
      </header>

      {/* 这层必须是 flex 容器:手机分支 MasterDetailShell 根靠 flex-1 撑满高度,
          父级是 block 的话 flex-1 失效 → Shell 塌成内容高 → 内部 overflow-auto 永不触发,
          超出部分被页根 overflow-hidden 裁掉(配置区滚不到底、「开始评测」按钮点不到)。
          桌面子项 ResizablePanelGroup 自带 h-full,作为 flex 项同样正确。 */}
      <div className="flex min-h-0 flex-1">
        {/* 单一稳定布局:左侧题集面板按 hasCases 条件渲染(order/key 保证稳定),
            configCard 永远待在同一个右侧面板,避免 hasCases 切换时被卸载重挂(选择会丢)。
            手机(isMobile)不用 Resizable:有题集 → 题集进抽屉 + 配置铺满;无题集 → 配置直接铺满。 */}
        {isMobile ? (
          // Shell **无条件**挂载(题集有无只切 hideList)—— 若像桌面那样按 hasCases 换外层元素,
          // configPanel 所在位置的元素类型会变(Shell ↔ div),React 会重挂子树、把 SkillBrowser
          // 里用户正在编辑的技能正文(seedText,未上提)清空。攒够 9 题时 hasCases 正好自动翻真,
          // 那是最容易踩到的时机。
          <MasterDetailShell
            hideList={!hasCases}
            listWidthClass="w-72"
            listClassName="overflow-auto p-5 pr-3"
            listLabel="题集"
            list={
              <CaseSetsCard
                highlightId={status === "running" ? runStatus.currentCaseId : undefined}
                override={caseView}
                emptyHint={caseEmptyHint}
              />
            }
          >
            {configPanel}
          </MasterDetailShell>
        ) : (
          <ResizablePanelGroup direction="horizontal" autoSaveId="skillopt-split" className="h-full">
            {hasCases && (
              <ResizablePanel key="cases" id="cases" order={1} defaultSize={28} minSize={18} maxSize={45}>
                <div className="h-full overflow-auto p-5 pr-3">
                  <CaseSetsCard highlightId={status === "running" ? runStatus.currentCaseId : undefined} override={caseView} emptyHint={caseEmptyHint} />
                </div>
              </ResizablePanel>
            )}
            {hasCases && <ResizableHandle key="handle" withHandle />}

            <ResizablePanel key="config" id="config" order={2} minSize={40}>
              {configPanel}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      <ConfirmDeleteDialog
        open={abortConfirmOpen}
        onOpenChange={setAbortConfirmOpen}
        title="终止当前评测？"
        description="将中断正在进行的 SkillOpt 任务,已跑的进度不会保存,需重新配置后再跑。"
        confirmLabel="终止"
        onConfirm={stop}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "running") return <Badge variant="accent">运行中…</Badge>;
  if (status === "done") return <Badge variant="success">完成</Badge>;
  if (status === "error") return <Badge variant="destructive">失败</Badge>;
  // idle 不再显示「就绪」徽标(无信息量);只在 运行中 / 完成 / 失败 时给状态反馈。
  return null;
}

/**
 * 实时日志控制台:运行中常驻可见、随新行**自动滚到底部**(贴底跟随);
 * 用户手动上滚则暂停跟随,出现「↓ 跳到最新」按钮可一键回到实时。
 * 固定高度 → 不把页面撑长,日志始终在视窗内流动。
 */
function LiveLogConsole({ logs, running }: { logs: string[]; running: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const [stick, setStick] = useState(true);
  useEffect(() => {
    if (stick && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs.length, stick]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 gap-y-1 border-b border-border bg-muted/30 px-3 py-2 text-[11px]">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">实时日志</span>
        {running && (
          <span className="inline-flex items-center gap-1 text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> 流式中
          </span>
        )}
        <span className="ml-auto tabular-nums text-muted-foreground">{logs.length} 行</span>
        {!stick && (
          <button
            type="button"
            onClick={() => setStick(true)}
            className="rounded border border-border px-1.5 py-0.5 text-[10.5px] text-accent hover:bg-secondary"
          >
            ↓ 跳到最新
          </button>
        )}
      </div>
      <pre
        ref={ref}
        onScroll={onScroll}
        className="h-64 overflow-auto whitespace-pre-wrap break-words bg-muted/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/85"
      >
        {logs.length === 0 ? (
          <span className="text-muted-foreground">等待日志输出…</span>
        ) : (
          logs.join("\n")
        )}
      </pre>
    </div>
  );
}

function LogDrawer({ logs }: { logs: string[] }) {
  if (logs.length === 0) return null;
  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-[11px] text-muted-foreground">
        <Terminal className="h-3.5 w-3.5" /> 原始日志 · {logs.length} 行
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {logs.join("\n")}
      </pre>
    </details>
  );
}
