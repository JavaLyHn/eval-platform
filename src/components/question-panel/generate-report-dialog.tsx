/**
 * Manual entry to create a new EvaluationReport.
 *
 * Flow:
 *   1. user opens this dialog from 数据看板
 *   2. picks the agent under test (defaults to last-evaluated agent or active)
 *   3. confirms title + scope
 *   4. submit → store.addReport(...) → navigate to /reports/:id
 *
 * The dialog DOES NOT auto-export anything. Markdown export only happens
 * later on the preview page when the user clicks it.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { evaluateReleaseGate } from "@/lib/release-gate";
import { loadSlice, saveSlice, STORAGE_KEYS } from "@/lib/persistence";

/**
 * 推荐默认目标(可在高级里改):预填后报告各指标都有判定,不再 N/A。
 * 百分比类 0-100(静默错误率越低越好);维度类 0-10。
 */
const DEFAULT_GENERAL_TARGETS: Record<string, number> = {
  "completion": 95,
  "silent-error": 5,
  "boundary": 90,
  "consistency": 80,
};
const DEFAULT_DIMENSION_TARGET = 7;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional pre-filtered question ids (passes the current dashboard scope). */
  scopedQuestionIds?: string[];
  /** Human-readable hint shown beside scope summary (e.g. "Aria 视图"). */
  scopeLabel?: string;
}

export function GenerateReportDialog({
  open,
  onOpenChange,
  scopedQuestionIds,
  scopeLabel,
}: Props) {
  const navigate = useNavigate();
  const {
    profiles,
    activeProfileId,
    composeReportItems,
    addReport,
    composeReportMetrics,
    reports,
  } = useQAStore();

  const agentProfiles = useMemo(
    () => profiles.filter((p) => getProfileKind(p.providerId) === "agent"),
    [profiles],
  );

  const [title, setTitle] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [targetInputs, setTargetInputs] = useState<Record<string, string>>({});

  // Reset state on each open
  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setTitle(defaultTitle());
    setAgentId(
      activeProfileId && agentProfiles.some((p) => p.id === activeProfileId)
        ? activeProfileId
        : (agentProfiles[0]?.id ?? ""),
    );
    setShowAdvanced(false);
    // 目标值:上次设置 > 推荐默认 —— 预填后报告不再出现 N/A(留空才不判)。
    const stored = loadSlice<Record<string, string>>(
      STORAGE_KEYS.reportTargets,
      {},
    );
    setTargetInputs(
      Object.keys(stored).length > 0
        ? stored
        : Object.fromEntries(
            Object.entries(DEFAULT_GENERAL_TARGETS).map(([k, v]) => [
              k,
              String(v),
            ]),
          ),
    );
  }, [open, activeProfileId, agentProfiles]);

  // Live preview: how many items will the report contain?
  const previewItems = useMemo(() => {
    if (!agentId) return [];
    return composeReportItems(agentId, scopedQuestionIds);
  }, [agentId, scopedQuestionIds, composeReportItems]);

  // 将冻结的这批 items 的发版裁定(口径同看板/报告)。不可发布时生成前需确认。
  const previewGate = useMemo(
    () =>
      evaluateReleaseGate(
        previewItems.map((it) => ({
          verdict: it.verdict,
          failureAttribution: it.failureAttribution,
          key: it.questionId,
          label: it.questionTitle,
        })),
      ),
    [previewItems],
  );

  const targets = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(targetInputs)) {
      const n = Number(v);
      if (v.trim() !== "" && Number.isFinite(n)) out[k] = n;
    }
    return out;
  }, [targetInputs]);

  // 是否已有可对比的历史版本(仅作提示;具体对比哪一版由报告页里用户自己选)。
  const hasComparable = useMemo(
    () => reports.some((r) => r.agentProfileId === agentId && r.metrics),
    [reports, agentId],
  );

  const GENERAL_TARGET_FIELDS = [
    { key: "completion", label: "完成率(%)" },
    { key: "silent-error", label: "静默错误率(%)" },
    { key: "boundary", label: "边界识别(%)" },
    { key: "consistency", label: "一致性(%)" },
  ];

  // 专属/维度指标(0-10):从将冻结的 items 的评分维度推出,逐维设目标。
  const specificDimFields = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of previewItems) {
      for (const s of it.scores) if (!map.has(s.key)) map.set(s.key, s.label);
    }
    return [...map.entries()].map(([key, label]) => ({ key, label }));
  }, [previewItems]);

  // 维度目标缺省补 7(出现新维度时自动补,已填的不动)。
  useEffect(() => {
    if (!open || specificDimFields.length === 0) return;
    setTargetInputs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const f of specificDimFields) {
        if (next[f.key] === undefined) {
          next[f.key] = String(DEFAULT_DIMENSION_TARGET);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [open, specificDimFields]);

  const resetTargetsToDefault = () => {
    setTargetInputs({
      ...Object.fromEntries(
        Object.entries(DEFAULT_GENERAL_TARGETS).map(([k, v]) => [k, String(v)]),
      ),
      ...Object.fromEntries(
        specificDimFields.map((f) => [f.key, String(DEFAULT_DIMENSION_TARGET)]),
      ),
    });
  };

  const canSubmit =
    !!agentId && previewItems.length > 0 && title.trim().length > 0 && !busy;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const agent = agentProfiles.find((p) => p.id === agentId);
    if (!agent) return;
    // 不可发布(安全红线一票否决)→ 生成前确认。确认后仍生成,报告如实记录裁定。
    if (
      !previewGate.canRelease &&
      !window.confirm(
        `该报告判定为「不可发布」(${previewGate.blockers.length} 条安全红线)。报告会如实记录此裁定。仍要生成吗?`,
      )
    ) {
      return;
    }
    setBusy(true);
    // 记住本次目标设置,下次生成报告自动带出。
    saveSlice(STORAGE_KEYS.reportTargets, targetInputs);
    const metrics = composeReportMetrics(agent.id, scopedQuestionIds, { targets });
    // 报告独立生成、不预绑基线;要和哪一版对比由报告页里用户自选(实时计算)。
    // 报告头(负责人/周期/发布日)字段已按需求移除;历史报告里已存的仍正常展示。
    const id = addReport({
      title: title.trim(),
      agentProfileId: agent.id,
      agentName: agent.name,
      items: previewItems,
      metrics,
      ...(Object.keys(targets).length ? { targets } : {}),
    });
    onOpenChange(false);
    navigate(`/reports/${encodeURIComponent(id)}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col w-[min(560px,94vw)]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-1.5 text-[14px]">
            <FileText className="h-3.5 w-3.5 text-foreground/70" />
            生成评测报告
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">
            把当前 scope 下选中 Agent 的题目 / 回答 / 评分冻结成一份只读报告。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1 text-[12.5px]">
          {/* Title */}
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
              报告标题
            </label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：Aria · 内测前评测"
              maxLength={80}
            />
          </div>

          {/* Agent */}
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
              被测 Agent
            </label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="h-9 text-[12.5px]">
                <SelectValue placeholder="选择一个 Agent profile" />
              </SelectTrigger>
              <SelectContent>
                {agentProfiles.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    暂无 Agent，请先在左导航「Agent 管理」添加
                  </div>
                ) : (
                  agentProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                        ({p.providerId})
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* 范围 + 收录数(候选 → 实收 漏斗,合并一张卡) */}
          <div className="rounded-md border border-border bg-card px-3 py-2 text-[11.5px]">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-muted-foreground">范围</span>
                <span className="ml-1.5 font-medium text-foreground">
                  {scopeLabel ?? "全部题目"}
                </span>
                {scopedQuestionIds && (
                  <span className="ml-1.5 font-mono text-muted-foreground">
                    · 候选 {scopedQuestionIds.length} 题
                  </span>
                )}
              </div>
              <div className="shrink-0 text-right">
                <span className="font-mono text-[14px] font-semibold tabular-nums text-foreground">
                  {previewItems.length}
                </span>
                <span className="ml-1 text-muted-foreground">题收录</span>
              </div>
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">
              候选题里按该 Agent 已有评测过滤、每题取最新一次,得到收录数(若少于候选,说明有题还没评分)。生成后为只读快照,不随后续修改变化
              {hasComparable
                ? ",可在报告页与历史版本对比。"
                : "(该 Agent 首份报告)。"}
            </p>
            {previewItems.length === 0 && agentId && (
              <p className="mt-1 text-[10.5px] text-amber-600 dark:text-amber-400">
                当前范围下,该 Agent 没有任何已提交的评测。换一个 Agent
                或先去打分。
              </p>
            )}
          </div>

          {/* 发版裁定警示 — 不可发布时红字标注,生成时再确认 */}
          {!previewGate.canRelease && previewItems.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
              ⛔ 该报告判定为<span className="font-semibold">不可发布</span> ·{" "}
              {previewGate.blockers.length} 条安全红线(一票否决)。生成时需确认。
            </div>
          )}


          {/* 高级选项:目标值 + 报告头 */}
          <div>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)}
              className="text-[11.5px] text-accent hover:underline">
              {showAdvanced ? "收起高级选项" : "高级:指标目标值(已预填推荐,可改)"}
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-2 rounded-md border border-border bg-card/40 p-2.5">
                <div className="flex items-center text-[10.5px] text-muted-foreground">
                  <span>留空 = 该指标不判(报告里显示 N/A);已预填推荐目标。</span>
                  <button
                    type="button"
                    onClick={resetTargetsToDefault}
                    className="ml-auto text-accent hover:underline"
                  >
                    重置为推荐值
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {GENERAL_TARGET_FIELDS.map((f) => (
                    <label key={f.key} className="text-[11px] text-muted-foreground">
                      {f.label}
                      <Input
                        type="number"
                        value={targetInputs[f.key] ?? ""}
                        onChange={(e) => setTargetInputs((p) => ({ ...p, [f.key]: e.target.value }))}
                        placeholder="不填=不判"
                        className="mt-0.5 h-8 text-[12px]"
                      />
                    </label>
                  ))}
                </div>
                {specificDimFields.length > 0 && (
                  <>
                    <div className="text-[10.5px] text-muted-foreground">
                      专属 / 维度指标目标(0-10)
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {specificDimFields.map((f) => (
                        <label key={f.key} className="text-[11px] text-muted-foreground">
                          {f.label}
                          <Input
                            type="number"
                            min={0}
                            max={10}
                            step={0.5}
                            value={targetInputs[f.key] ?? ""}
                            onChange={(e) => setTargetInputs((p) => ({ ...p, [f.key]: e.target.value }))}
                            placeholder="不填=不判"
                            className="mt-0.5 h-8 text-[12px]"
                          />
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            取消
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="gap-1.5"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            生成 & 预览
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultTitle(): string {
  // Second-level precision so titles generated in quick succession stay
  // unique by default. User can still override.
  const ts = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `评测报告 ${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ` +
    `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`
  );
}
