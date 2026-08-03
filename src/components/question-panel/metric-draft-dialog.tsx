import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import {
  buildMetricDraftPrompt,
  parseMetricDrafts,
  type ParsedMetric,
} from "@/lib/employee-metrics-generator";
import {
  resolveEmployeeMetrics,
  normalizeMetricLabel,
} from "@/lib/employee-metrics";
import { findStandardEmployee } from "@/lib/standard-employees";
import { cn } from "@/lib/utils";

type Draft = ParsedMetric & { picked: boolean };

export function MetricDraftDialog({
  employeeId,
  open,
  onOpenChange,
}: {
  employeeId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const {
    profiles,
    employeeMetrics,
    importCustomMetrics,
    runOneShot,
    lastGeneratorProfileId,
    setLastGeneratorProfileId,
    showNotice,
  } = useQAStore();

  const employee = findStandardEmployee(employeeId);
  const llmProfiles = useMemo(
    () => profiles.filter((p) => getProfileKind(p.providerId) === "llm"),
    [profiles],
  );
  const existingLabels = useMemo(
    () =>
      resolveEmployeeMetrics(
        employee?.specificMetricTemplates ?? [],
        employeeMetrics[employeeId],
      ).map((m) => m.label),
    [employee, employeeMetrics, employeeId],
  );
  const existingKeys = useMemo(
    () => new Set(existingLabels.map((l) => normalizeMetricLabel(l))),
    [existingLabels],
  );

  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    if (!open) return;
    setDrafts([]);
    setError(null);
    setBusy(false);
    setProfileId(
      lastGeneratorProfileId && llmProfiles.some((p) => p.id === lastGeneratorProfileId)
        ? lastGeneratorProfileId
        : (llmProfiles[0]?.id ?? ""),
    );
  }, [open, lastGeneratorProfileId, llmProfiles]);

  const generate = async () => {
    if (!profileId || !employee) return;
    setBusy(true);
    setError(null);
    try {
      setLastGeneratorProfileId(profileId);
      const prompt = buildMetricDraftPrompt({
        employee: {
          name: employee.name,
          title: employee.title,
          servesAudience: employee.servesAudience,
          coreTasks: employee.coreTasks,
          outOfScope: employee.outOfScope,
        },
        existingLabels,
        count: 4,
      });
      const pickDefault = (c: ParsedMetric) =>
        !existingKeys.has(normalizeMetricLabel(c.label));
      setDrafts([]);
      let acc = "";
      const raw = await runOneShot(profileId, prompt, {
        timeoutMs: 180_000,
        onChunk: (delta) => {
          acc += delta;
          const partial = parseMetricDrafts(acc);
          if (partial.length > 0) {
            setDrafts((prev) =>
              partial.map((c, i) => ({ ...c, picked: prev[i]?.picked ?? pickDefault(c) })),
            );
          }
        },
      });
      const parsed = parseMetricDrafts(raw);
      if (parsed.length === 0) {
        setError("没解析出指标,换个 LLM 或重试。");
        return;
      }
      setDrafts((prev) =>
        parsed.map((c, i) => ({ ...c, picked: prev[i]?.picked ?? pickDefault(c) })),
      );
    } catch (e) {
      setError((e as Error).message || "生成失败");
    } finally {
      setBusy(false);
    }
  };

  const patch = (i: number, p: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...p } : d)));

  const pickedCount = drafts.filter((d) => d.picked).length;

  const importPicked = () => {
    const inits = drafts
      .filter((d) => d.picked)
      .map((d) => ({
        label: d.label,
        description: d.description,
        passFormHint: d.passFormHint,
        failFormHint: d.failFormHint,
      }));
    if (inits.length === 0) return;
    const created = importCustomMetrics(employeeId, inits).length;
    const skipped = inits.length - created;
    if (created === 0) {
      showNotice({
        kind: "info",
        message: `这 ${skipped} 条都与现有指标重复,未导入;改个名再试。`,
      });
      return;
    }
    showNotice({
      kind: "success",
      message: `已导入 ${created} 条${skipped > 0 ? `,跳过 ${skipped} 条重复` : ""}`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[min(720px,95vw)] flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-[14px]">
            <Sparkles className="h-3.5 w-3.5" /> AI 草拟角色专属指标 · {employee?.name}
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">
            LLM 只草拟效果/质量指标(非红线安全),全部先进预览,由你挑/改后才入库(人工校是必经步)。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Select value={profileId} onValueChange={setProfileId}>
            <SelectTrigger className="h-8 w-[260px] text-[12.5px]">
              <SelectValue placeholder="选择一个 LLM" />
            </SelectTrigger>
            <SelectContent>
              {llmProfiles.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  没有 LLM profile,去「LLM 模型」添加
                </div>
              ) : (
                llmProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8 gap-1 text-[12px]"
            disabled={!profileId || busy}
            onClick={generate}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {drafts.length > 0 ? "重新生成" : "生成草稿"}
          </Button>
          {error && <span className="text-[11px] text-destructive">{error}</span>}
        </div>

        <ScrollArea className="-mx-1 min-h-0 flex-1">
          <ul className="space-y-1.5 px-1 pb-2">
            {drafts.length === 0 && !busy && (
              <li className="px-2 py-10 text-center text-[11.5px] text-muted-foreground">
                选个 LLM,点「生成草稿」。
              </li>
            )}
            {drafts.map((d, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-md border bg-card p-2.5 text-[12px]",
                  d.picked ? "border-foreground/40" : "border-border opacity-60",
                )}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={d.picked}
                    onChange={(e) => patch(i, { picked: e.target.checked })}
                  />
                  <input
                    value={d.label}
                    onChange={(e) => patch(i, { label: e.target.value })}
                    placeholder="指标名"
                    className="min-w-0 flex-1 bg-transparent font-medium focus:outline-none"
                  />
                  {existingKeys.has(normalizeMetricLabel(d.label)) && (
                    <span
                      className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[9.5px] text-warning"
                      title="已有同名指标,导入时会跳过"
                    >
                      已存在
                    </span>
                  )}
                </div>
                <textarea
                  value={d.description}
                  onChange={(e) => patch(i, { description: e.target.value })}
                  rows={2}
                  placeholder="测什么"
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-[10.5px]"
                />
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <input
                    value={d.passFormHint ?? ""}
                    onChange={(e) => patch(i, { passFormHint: e.target.value })}
                    placeholder="Pass 形态参考"
                    className="rounded border border-border bg-background px-2 py-1 text-[10.5px]"
                  />
                  <input
                    value={d.failFormHint ?? ""}
                    onChange={(e) => patch(i, { failFormHint: e.target.value })}
                    placeholder="Fail 形态参考"
                    className="rounded border border-border bg-background px-2 py-1 text-[10.5px]"
                  />
                </div>
              </li>
            ))}
            {busy && (
              <li className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> 生成中…(已出 {drafts.length} 条)
                </span>
              </li>
            )}
          </ul>
        </ScrollArea>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            勾选 {pickedCount} / {drafts.length} 条
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" disabled={pickedCount === 0} onClick={importPicked}>
              导入 {pickedCount} 条
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
