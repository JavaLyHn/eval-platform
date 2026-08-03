import {
  AlertTriangle,
  CheckSquare,
  ChevronLeft,
  Loader2,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import {
  GROUND_TRUTH_CHECK_META,
  buildGroundTruthProbePrompt,
  type CheckMeta,
} from "@/lib/ground-truth-generator";
import { parseGeneratedQuestions } from "@/lib/question-generator";
import { resolveQuestionType, TYPE_CRITERIA } from "@/lib/question-type";
import { STANDARD_EMPLOYEES } from "@/lib/standard-employees";
import { cn } from "@/lib/utils";
import type { GroundTruthCheckKind } from "@/types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type EmployeeId = "aria" | "sam";

interface CheckConfig {
  kind: GroundTruthCheckKind;
  count: number;
  enabled: boolean;
}

interface DraftRow {
  id: string;
  picked: boolean;
  title: string;
  prompt: string;
  employeeId: EmployeeId;
  checkKinds: GroundTruthCheckKind[];
}

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

interface GroundTruthGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* -------------------------------------------------------------------------- */
/* Main dialog                                                                 */
/* -------------------------------------------------------------------------- */

export function GroundTruthGeneratorDialog({
  open,
  onOpenChange,
}: GroundTruthGeneratorDialogProps) {
  const {
    profiles: allProfiles,
    addQuestion,
    addCategory,
    categories,
    lastGeneratorProfileId,
    setLastGeneratorProfileId,
    showNotice,
    runOneShot,
  } = useQAStore();

  // Only LLM-kind profiles for generation.
  const profiles = useMemo(
    () => allProfiles.filter((p) => getProfileKind(p.providerId) === "llm"),
    [allProfiles],
  );

  // Steps
  const [step, setStep] = useState<"config" | "preview">("config");

  // Config state
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeId>("aria");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [checkConfigs, setCheckConfigs] = useState<CheckConfig[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamBuf, setStreamBuf] = useState("");
  const [progress, setProgress] = useState<{
    label: string;
    i: number;
    n: number;
  } | null>(null);

  // Preview state
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  // Meta for the selected employee
  const employeeMeta = useMemo(
    () => GROUND_TRUTH_CHECK_META.filter((m) => m.employeeId === selectedEmployee),
    [selectedEmployee],
  );

  const employeeInfo = STANDARD_EMPLOYEES.find((e) => e.id === selectedEmployee);

  // Initialize profile selection when dialog opens
  useEffect(() => {
    if (!open) return;
    if (profiles.length === 0) {
      setProfileId(null);
      return;
    }
    const fallback =
      lastGeneratorProfileId &&
      profiles.find((p) => p.id === lastGeneratorProfileId)
        ? lastGeneratorProfileId
        : (profiles[0]?.id ?? null);
    setProfileId(fallback);
  }, [open, profiles, lastGeneratorProfileId]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setStep("config");
    setSelectedEmployee("aria");
    setDrafts([]);
    setError(null);
    setBusy(false);
    setStreamBuf("");
    setProgress(null);
  }, [open]);

  // Rebuild check configs when employee selection changes
  useEffect(() => {
    setCheckConfigs(
      employeeMeta.map((m) => ({
        kind: m.kind,
        count: 3,
        enabled: true,
      })),
    );
  }, [employeeMeta]);

  const setCheckEnabled = (kind: GroundTruthCheckKind, enabled: boolean) => {
    setCheckConfigs((prev) =>
      prev.map((c) => (c.kind === kind ? { ...c, enabled } : c)),
    );
  };

  const setCheckCount = (kind: GroundTruthCheckKind, count: number) => {
    setCheckConfigs((prev) =>
      prev.map((c) => (c.kind === kind ? { ...c, count } : c)),
    );
  };

  const enabledChecks = checkConfigs.filter((c) => c.enabled);
  const canGenerate = !!profileId && enabledChecks.length > 0 && !busy;

  /* ----- Generation ---------------------------------------------------- */

  const handleGenerate = async () => {
    if (!profileId || !canGenerate) return;
    setBusy(true);
    setError(null);
    setStreamBuf("");
    setDrafts([]);

    const collected: DraftRow[] = [];
    const failed: string[] = [];

    const checksToRun = enabledChecks
      .map((cc) => ({
        config: cc,
        meta: employeeMeta.find((m) => m.kind === cc.kind)!,
      }))
      .filter((x) => !!x.meta);

    for (let ci = 0; ci < checksToRun.length; ci++) {
      const { config, meta } = checksToRun[ci];
      const checkLabel = meta.label;
      setProgress({ label: checkLabel, i: ci + 1, n: checksToRun.length });
      const prompt = buildGroundTruthProbePrompt({
        employeeName: employeeInfo?.name ?? selectedEmployee,
        check: meta,
        count: config.count,
      });
      try {
        const raw = await runOneShot(profileId, prompt, {
          timeoutMs: 180_000,
          onChunk: (delta) => setStreamBuf((prev) => prev + delta),
        });
        const parsed = parseGeneratedQuestions(raw);
        if (parsed.length === 0) {
          failed.push(checkLabel);
          continue;
        }
        parsed.forEach((q, i) =>
          collected.push({
            id: `gt-${ci}-${i}`,
            picked: true,
            title: q.title,
            prompt: q.prompt,
            employeeId: selectedEmployee,
            checkKinds: [meta.kind],
          }),
        );
      } catch {
        failed.push(checkLabel);
      }
    }

    setProgress(null);
    setLastGeneratorProfileId(profileId);
    setBusy(false);

    if (collected.length === 0) {
      setError(
        `未能生成任何探针${failed.length ? `（失败：${failed.join("、")}）` : ""}，请重试。`,
      );
      return;
    }
    if (failed.length > 0) {
      setError(`部分检查项失败：${failed.join("、")}（其余已生成，可继续导入）`);
    }
    setDrafts(collected);
    setStep("preview");
  };

  /* ----- Import -------------------------------------------------------- */

  const handleImport = () => {
    const picked = drafts.filter((d) => d.picked);
    if (picked.length === 0) return;

    // Ensure category exists
    for (const d of picked) {
      if (!categories.includes(d.employeeId)) addCategory(d.employeeId);
    }

    for (const d of picked) {
      const checkLabels = d.checkKinds.map(
        (k) => GROUND_TRUTH_CHECK_META.find((m) => m.kind === k)?.label ?? k,
      );
      addQuestion({
        title: d.title,
        prompt: d.prompt,
        categories: [d.employeeId],
        difficulty: "medium",
        tags: ["ground-truth", ...checkLabels],
        criteria: TYPE_CRITERIA[
          resolveQuestionType({ outOfScope: false, hasGroundTruth: true }, false)
        ].map((c) => ({ ...c })),
        agentIds: [],
        hasGroundTruth: true,
        targetEmployeeId: d.employeeId,
        groundTruthChecks: d.checkKinds.map((k) => ({ kind: k })),
      });
    }

    showNotice({
      kind: "success",
      message: `已导入 ${picked.length} 道确定性 probe 到题库`,
    });
    onOpenChange(false);
  };

  /* ----- Render -------------------------------------------------------- */

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(680px,94vw)] flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-1.5 text-[14px]">
            <ShieldCheck className="h-3.5 w-3.5 text-foreground/70" />
            生成 Ground-Truth Probe
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">
            {step === "config"
              ? "为 Aria / Sam 生成确定性探针题，可自动核验"
              : "预览并勾选要导入题库的探针题"}
          </DialogDescription>
        </DialogHeader>

        {step === "config" ? (
          <ConfigStep
            profiles={profiles}
            profileId={profileId}
            onProfileChange={setProfileId}
            selectedEmployee={selectedEmployee}
            onSelectEmployee={setSelectedEmployee}
            checkConfigs={checkConfigs}
            employeeMeta={employeeMeta}
            onCheckEnabled={setCheckEnabled}
            onCheckCount={setCheckCount}
            busy={busy}
            error={error}
            canGenerate={canGenerate}
            onGenerate={handleGenerate}
            streamBuf={streamBuf}
            progress={progress}
          />
        ) : (
          <PreviewStep
            drafts={drafts}
            setDrafts={setDrafts}
            employeeId={selectedEmployee}
            error={error}
            onBack={() => setStep("config")}
            onImport={handleImport}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Config Step                                                                  */
/* -------------------------------------------------------------------------- */

function ConfigStep(props: {
  profiles: ReturnType<typeof useQAStore>["profiles"];
  profileId: string | null;
  onProfileChange: (id: string) => void;
  selectedEmployee: EmployeeId;
  onSelectEmployee: (id: EmployeeId) => void;
  checkConfigs: CheckConfig[];
  employeeMeta: CheckMeta[];
  onCheckEnabled: (kind: GroundTruthCheckKind, enabled: boolean) => void;
  onCheckCount: (kind: GroundTruthCheckKind, count: number) => void;
  busy: boolean;
  error: string | null;
  canGenerate: boolean;
  onGenerate: () => void;
  streamBuf: string;
  progress: { label: string; i: number; n: number } | null;
}) {
  const {
    profiles,
    profileId,
    onProfileChange,
    selectedEmployee,
    onSelectEmployee,
    checkConfigs,
    employeeMeta,
    onCheckEnabled,
    onCheckCount,
    busy,
    error,
    canGenerate,
    onGenerate,
    streamBuf,
    progress,
  } = props;

  const streamRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (streamRef.current)
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [streamBuf]);

  const EMPLOYEES: { id: EmployeeId; name: string; desc: string }[] = [
    { id: "aria", name: "Aria", desc: "营销执行 · 发帖 / 邮件" },
    { id: "sam", name: "Sam", desc: "客服 · 多语种 / 不泄漏" },
  ];

  return (
    <div className="flex flex-1 flex-col gap-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Employee toggle */}
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-foreground">
            目标员工
          </div>
          <div className="flex gap-2">
            {EMPLOYEES.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onSelectEmployee(e.id)}
                className={cn(
                  "flex flex-1 flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selectedEmployee === e.id
                    ? "border-accent bg-accent/15 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-accent/50 hover:bg-accent/5",
                )}
              >
                <span className="text-[13px] font-semibold">{e.name}</span>
                <span className="text-[11px]">{e.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* LLM Profile */}
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-foreground">
            生成器（LLM）
          </div>
          {profiles.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              暂无 LLM 配置，请先在 Agent 管理中添加 LLM 类型配置。
            </p>
          ) : (
            <Select
              value={profileId ?? ""}
              onValueChange={onProfileChange}
            >
              <SelectTrigger className="h-8 w-full text-[13px]">
                <SelectValue placeholder="选择 LLM 配置…" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Check toggles */}
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-foreground">
            检查项 & 数量
          </div>
          <div className="space-y-2">
            {employeeMeta.map((meta) => {
              const cfg = checkConfigs.find((c) => c.kind === meta.kind);
              if (!cfg) return null;
              return (
                <div
                  key={meta.kind}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    cfg.enabled
                      ? "border-border bg-card"
                      : "border-border/50 bg-muted/20 opacity-60",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onCheckEnabled(meta.kind, !cfg.enabled)}
                    className="shrink-0 text-foreground/70 hover:text-foreground"
                    aria-label={cfg.enabled ? "取消选择" : "选择"}
                  >
                    {cfg.enabled ? (
                      <CheckSquare className="h-4 w-4 text-accent" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground">
                      {meta.label}
                    </div>
                    <div className="text-[11px] text-muted-foreground line-clamp-2">
                      {meta.intent}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={cfg.count}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                        onCheckCount(meta.kind, v);
                      }}
                      disabled={!cfg.enabled}
                      className="h-7 w-14 text-center text-[12px]"
                    />
                    <span className="text-[11px] text-muted-foreground">道</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Stream preview */}
        {busy && (
          <div className="rounded-md border border-border bg-muted/30 p-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {progress
                ? `生成中（${progress.i}/${progress.n}）：${progress.label}`
                : "生成中…"}
            </div>
            <pre
              ref={streamRef}
              className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all text-[10.5px] text-foreground/70"
            >
              {streamBuf || "…"}
            </pre>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button
          disabled={!canGenerate}
          onClick={onGenerate}
          className="gap-1.5"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {busy ? "生成中…" : "生成"}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Preview Step                                                                 */
/* -------------------------------------------------------------------------- */

function PreviewStep(props: {
  drafts: DraftRow[];
  setDrafts: React.Dispatch<React.SetStateAction<DraftRow[]>>;
  employeeId: EmployeeId;
  error: string | null;
  onBack: () => void;
  onImport: () => void;
}) {
  const { drafts, setDrafts, employeeId, error, onBack, onImport } = props;

  const pickedCount = drafts.filter((d) => d.picked).length;
  const allPicked = drafts.every((d) => d.picked);
  const nonePicked = drafts.every((d) => !d.picked);

  // Meta list for this employee (used in check toggles per draft)
  const employeeMeta = GROUND_TRUTH_CHECK_META.filter(
    (m) => m.employeeId === employeeId,
  );

  const toggleAll = () => {
    if (allPicked) {
      setDrafts((prev) => prev.map((d) => ({ ...d, picked: false })));
    } else {
      setDrafts((prev) => prev.map((d) => ({ ...d, picked: true })));
    }
  };

  const updateDraft = (id: string, patch: Partial<DraftRow>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const toggleCheckKind = (id: string, kind: GroundTruthCheckKind) => {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const has = d.checkKinds.includes(kind);
        const next = has
          ? d.checkKinds.filter((k) => k !== kind)
          : [...d.checkKinds, kind];
        return { ...d, checkKinds: next };
      }),
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={toggleAll}
          className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          {allPicked ? (
            <CheckSquare className="h-3.5 w-3.5" />
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
          {allPicked ? "全不选" : "全选"}
        </button>
        <span className="text-[12px] text-muted-foreground">
          已选{" "}
          <span className="font-mono text-foreground">{pickedCount}</span> /{" "}
          {drafts.length}
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-1.5 border-b border-border bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Draft list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            employeeMeta={employeeMeta}
            onTogglePick={() => updateDraft(draft.id, { picked: !draft.picked })}
            onTitleChange={(t) => updateDraft(draft.id, { title: t })}
            onPromptChange={(p) => updateDraft(draft.id, { prompt: p })}
            onToggleCheck={(k) => toggleCheckKind(draft.id, k)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-3.5 w-3.5" />
          重新生成
        </Button>
        <Button
          disabled={nonePicked}
          onClick={onImport}
          className="gap-1.5"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          导入题库（{pickedCount}）
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Draft Card                                                                   */
/* -------------------------------------------------------------------------- */

function DraftCard(props: {
  draft: DraftRow;
  employeeMeta: CheckMeta[];
  onTogglePick: () => void;
  onTitleChange: (t: string) => void;
  onPromptChange: (p: string) => void;
  onToggleCheck: (kind: GroundTruthCheckKind) => void;
}) {
  const { draft, employeeMeta, onTogglePick, onTitleChange, onPromptChange, onToggleCheck } =
    props;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        draft.picked ? "border-border bg-card" : "border-border/40 bg-muted/15 opacity-60",
      )}
    >
      {/* Header row */}
      <div className="mb-2 flex items-start gap-2">
        <button
          type="button"
          onClick={onTogglePick}
          className="mt-0.5 shrink-0 text-foreground/70 hover:text-foreground"
          aria-label={draft.picked ? "取消" : "选择"}
        >
          {draft.picked ? (
            <CheckSquare className="h-4 w-4 text-accent" />
          ) : (
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <Input
          value={draft.title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="标题（≤ 20 字）"
          className="h-7 flex-1 text-[12px] font-medium"
          disabled={!draft.picked}
        />
      </div>

      {/* Prompt textarea */}
      <Textarea
        value={draft.prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder="发给 agent 的完整 prompt…"
        rows={3}
        className="mb-2 resize-none text-[12px]"
        disabled={!draft.picked}
      />

      {/* Check kind toggles */}
      <div className="flex flex-wrap gap-1.5">
        {employeeMeta.map((meta) => {
          const active = draft.checkKinds.includes(meta.kind);
          return (
            <button
              key={meta.kind}
              type="button"
              onClick={() => onToggleCheck(meta.kind)}
              disabled={!draft.picked}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                active
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-border text-muted-foreground hover:border-accent/50",
              )}
            >
              {active ? (
                <CheckSquare className="h-3 w-3" />
              ) : (
                <Square className="h-3 w-3" />
              )}
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
