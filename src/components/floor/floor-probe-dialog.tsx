import { useEffect, useMemo, useState } from "react";
import { Loader2, Crosshair } from "lucide-react";
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
  buildGeneratorPrompt,
  parseGeneratedQuestions,
  type GeneratedQuestion,
} from "@/lib/question-generator";
import { findStandardEmployee } from "@/lib/standard-employees";
import { cn } from "@/lib/utils";
import type { FloorElement } from "@/types";

type Draft = GeneratedQuestion & { picked: boolean };
const PROBE_CATEGORY = "保下限探针";

export function FloorProbeDialog({
  element,
  employeeId,
  open,
  onOpenChange,
}: {
  element: FloorElement;
  employeeId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const {
    profiles,
    runOneShot,
    addQuestion,
    addCategory,
    defaultCriteria,
    lastGeneratorProfileId,
    setLastGeneratorProfileId,
    showNotice,
  } = useQAStore();

  const employee = findStandardEmployee(employeeId);
  const llmProfiles = useMemo(
    () => profiles.filter((p) => getProfileKind(p.providerId) === "llm"),
    [profiles],
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
      lastGeneratorProfileId &&
        llmProfiles.some((p) => p.id === lastGeneratorProfileId)
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
      const prompt = buildGeneratorPrompt({
        counts: { easy: 0, medium: 2, hard: 2 },
        employee: {
          name: employee.name,
          title: employee.title,
          coreTasks: employee.coreTasks,
          outOfScope: employee.outOfScope,
        },
        floorElements: [
          {
            title: element.title,
            passForm: element.passForm,
            failForm: element.failForm,
            category: element.category,
            isRedLine: element.isRedLine,
            counterExamples: element.counterExamples,
          },
        ],
      });
      setDrafts([]); // 清掉上一次结果，准备流式追加
      // 流式：边收边解析，已完整的题立刻展示（parseGeneratedQuestions 的逐条恢复层能吃半截 JSON）。
      // 按数组下标合并，保留用户已经勾/取消的状态；新出现的题默认勾选。
      let acc = "";
      const raw = await runOneShot(profileId, prompt, {
        timeoutMs: 180_000,
        onChunk: (delta) => {
          acc += delta;
          const partial = parseGeneratedQuestions(acc);
          if (partial.length > 0) {
            setDrafts((prev) =>
              partial.map((q, i) => ({ ...q, picked: prev[i]?.picked ?? true })),
            );
          }
        },
      });
      // 收尾：用完整文本再解析一遍，补上流式可能漏掉的最后一题。
      const parsed = parseGeneratedQuestions(raw);
      if (parsed.length === 0) setError("没解析出题，换个 LLM 或重试。");
      setDrafts((prev) =>
        parsed.map((q, i) => ({ ...q, picked: prev[i]?.picked ?? true })),
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
    const picked = drafts.filter((d) => d.picked);
    if (picked.length === 0) return;
    addCategory(PROBE_CATEGORY);
    for (const d of picked) {
      addQuestion({
        title: d.title,
        prompt: d.prompt,
        categories: [PROBE_CATEGORY],
        difficulty: d.difficulty,
        tags: [...(d.tags ?? []), "探针"],
        criteria: defaultCriteria.map((c) => ({ ...c })),
        agentIds: [],
        referenceAnswer: d.referenceAnswer,
        passForm: d.passForm ?? element.passForm,
        failForm: d.failForm ?? element.failForm,
        severity: d.severity,
        intent: d.intent,
        targetEmployeeId: employeeId,
        floorElementIds: [element.id],
      });
    }
    showNotice({
      kind: "success",
      message: `已导入 ${picked.length} 道探针并挂到「${element.title}」`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[min(760px,95vw)] flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-[14px]">
            <Crosshair className="h-3.5 w-3.5" /> 出探针题 · {element.title}
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">
            生成「踩穿这条下限」的攻击样本（正反都测、评结果不评路径）。导入即挂到该要素。
            {element.isRedLine && " 该要素是红线（一票否决）。"}
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
                  没有 LLM profile，去「LLM 模型」添加
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
            {drafts.length > 0 ? "重新生成" : "生成探针"}
          </Button>
          {error && <span className="text-[11px] text-destructive">{error}</span>}
        </div>

        <ScrollArea className="-mx-1 min-h-0 flex-1">
          <ul className="space-y-1.5 px-1 pb-2">
            {drafts.length === 0 && !busy && (
              <li className="px-2 py-10 text-center text-[11.5px] text-muted-foreground">
                选个 LLM，点「生成探针」。
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
                    value={d.title}
                    onChange={(e) => patch(i, { title: e.target.value })}
                    placeholder="题目标题"
                    className="min-w-0 flex-1 bg-transparent font-medium focus:outline-none"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {d.difficulty}
                    {d.intent ? ` · ${d.intent}` : ""}
                  </span>
                </div>
                <textarea
                  value={d.prompt}
                  onChange={(e) => patch(i, { prompt: e.target.value })}
                  rows={2}
                  placeholder="题干"
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-[10.5px]"
                />
              </li>
            ))}
            {busy && (
              <li className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> 生成中…（已出{" "}
                  {drafts.length} 道）
                </span>
              </li>
            )}
          </ul>
        </ScrollArea>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            勾选 {pickedCount} / {drafts.length} 道
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" disabled={pickedCount === 0} onClick={importPicked}>
              导入 {pickedCount} 道
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
