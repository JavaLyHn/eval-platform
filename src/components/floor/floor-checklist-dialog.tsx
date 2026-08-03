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
  buildFloorChecklistPrompt,
  parseFloorCandidates,
  type ParsedFloorCandidate,
} from "@/lib/floor-generator";
import {
  FLOOR_CATEGORY_LABELS,
  layerOf,
  normalizeFloorTitle,
  type FloorCandidate,
} from "@/lib/floor-elements";
import { findStandardEmployee } from "@/lib/standard-employees";
import { cn } from "@/lib/utils";
import type { FloorCategory } from "@/types";

type Draft = ParsedFloorCandidate & { picked: boolean };

export function FloorChecklistDialog({
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
    floorElements,
    importFloorCandidates,
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
  const existingTitles = useMemo(
    () =>
      floorElements.filter((f) => f.employeeId === employeeId).map((f) => f.title),
    [floorElements, employeeId],
  );
  // 现有要素标题(归一化)——预览里标「已存在」并默认不勾,入库还会硬去重兜底。
  const existingKeys = useMemo(
    () => new Set(existingTitles.map((t) => normalizeFloorTitle(t))),
    [existingTitles],
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
      const prompt = buildFloorChecklistPrompt({
        employee: {
          id: employee.id,
          name: employee.name,
          title: employee.title,
          coreTasks: employee.coreTasks,
          outOfScope: employee.outOfScope,
          servesAudience: employee.servesAudience,
        },
        existingTitles,
        count: 8,
      });
      // 默认勾选:floor 档 且 不与现有重复(已存在的默认不勾)。
      const pickDefault = (c: ParsedFloorCandidate) =>
        c.tier === "floor" && !existingKeys.has(normalizeFloorTitle(c.title));
      setDrafts([]); // 清掉上一次结果，准备流式追加
      // 流式:边收边解析,已完整的候选立刻展示(parseFloorCandidates 的逐条恢复层能吃半截 JSON)。
      // 按下标合并,保留用户已勾/取消的状态;新出现的按 pickDefault。
      let acc = "";
      const raw = await runOneShot(profileId, prompt, {
        timeoutMs: 180_000,
        onChunk: (delta) => {
          acc += delta;
          const partial = parseFloorCandidates(acc);
          if (partial.length > 0) {
            setDrafts((prev) =>
              partial.map((c, i) => ({
                ...c,
                picked: prev[i]?.picked ?? pickDefault(c),
              })),
            );
          }
        },
      });
      // 收尾:完整文本再解析一遍,补上流式可能漏掉的最后一条。
      const parsed = parseFloorCandidates(raw);
      if (parsed.length === 0) {
        setError("没解析出候选，换个 LLM 或重试。");
      }
      setDrafts((prev) =>
        parsed.map((c, i) => ({
          ...c,
          picked: prev[i]?.picked ?? pickDefault(c),
        })),
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
    const cands: FloorCandidate[] = drafts
      .filter((d) => d.picked)
      .map((d) => ({
        employeeId,
        layer: layerOf(d.category),
        category: d.category,
        subType: d.subType,
        title: d.title,
        passForm: d.passForm,
        failForm: d.failForm,
        isRedLine: d.isRedLine,
        requiresCitation: d.requiresCitation,
        counterExamples: d.counterExamples,
        source: "llm",
      }));
    if (cands.length === 0) return;
    const created = importFloorCandidates(cands).length; // 入库硬去重后真正新建数
    const skipped = cands.length - created;
    if (created === 0) {
      showNotice({
        kind: "info",
        message: `这 ${skipped} 条都与现有要素重复，未导入；改个标题再试。`,
      });
      return; // 全重复:保留弹窗让用户改标题
    }
    showNotice({
      kind: "success",
      message: `已导入 ${created} 条${skipped > 0 ? `，跳过 ${skipped} 条重复` : ""}`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[min(760px,95vw)] flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-[14px]">
            <Sparkles className="h-3.5 w-3.5" /> AI 草拟下限清单 · {employee?.name}
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">
            LLM 只草拟「底线」，全部先进预览，由你挑/改后才入库（人工校是必经步）。
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
            {drafts.length > 0 ? "重新生成" : "生成草稿"}
          </Button>
          {error && <span className="text-[11px] text-destructive">{error}</span>}
        </div>

        <ScrollArea className="-mx-1 min-h-0 flex-1">
          <ul className="space-y-1.5 px-1 pb-2">
            {drafts.length === 0 && !busy && (
              <li className="px-2 py-10 text-center text-[11.5px] text-muted-foreground">
                选个 LLM，点「生成草稿」。
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
                    placeholder="要素标题"
                    className="min-w-0 flex-1 bg-transparent font-medium focus:outline-none"
                  />
                  {existingKeys.has(normalizeFloorTitle(d.title)) && (
                    <span
                      className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[9.5px] text-warning"
                      title="已有同名要素，导入时会跳过"
                    >
                      已存在
                    </span>
                  )}
                  <Select
                    value={d.category}
                    onValueChange={(v) =>
                      patch(i, { category: v as FloorCategory })
                    }
                  >
                    <SelectTrigger className="h-6 w-[150px] text-[10.5px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(FLOOR_CATEGORY_LABELS).map((k) => (
                        <SelectItem key={k} value={k}>
                          {FLOOR_CATEGORY_LABELS[k as FloorCategory]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => patch(i, { isRedLine: !d.isRedLine })}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px]",
                      d.isRedLine
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    红线
                  </button>
                  {d.tier === "ceiling" && (
                    <span className="text-[9.5px] text-warning">上限?</span>
                  )}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <input
                    value={d.passForm}
                    onChange={(e) => patch(i, { passForm: e.target.value })}
                    placeholder="Pass 形态（在位）"
                    className="rounded border border-border bg-background px-2 py-1 text-[10.5px]"
                  />
                  <input
                    value={d.failForm}
                    onChange={(e) => patch(i, { failForm: e.target.value })}
                    placeholder="Fail 形态（缺口）"
                    className="rounded border border-border bg-background px-2 py-1 text-[10.5px]"
                  />
                </div>
                {d.rationale && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    依据：{d.rationale}
                  </div>
                )}
              </li>
            ))}
            {busy && (
              <li className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> 生成中…（已出{" "}
                  {drafts.length} 条）
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
