import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { partitionForBatchJudgeAcrossConvs, questionCounts } from "@/lib/batch-judge-plan";
import { judgeIsolationLevel } from "@/lib/judge-isolation";

export function BulkJudgeDialog({
  open,
  onOpenChange,
  questionIds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  questionIds: string[];
}) {
  const { profiles, conversations, evaluations, judgeQueue, runBatchJudge } =
    useQAStore();

  const llmProfiles = useMemo(
    () => profiles.filter((p) => getProfileKind(p.providerId) === "llm"),
    [profiles],
  );
  const [selected, setSelected] = useState<string[]>(() =>
    llmProfiles[0] ? [llmProfiles[0].id] : [],
  );
  const [mode, setMode] = useState<"skip" | "redo">("skip");

  // 跨会话:每题去它最近作答的会话里找目标(每题独立会话后不能只看当前会话)。
  const part = useMemo(
    () => partitionForBatchJudgeAcrossConvs(questionIds, conversations, evaluations),
    [questionIds, conversations, evaluations],
  );

  // 打开时定默认模式:全部已评(重新评分场景)→ 默认「全部重评」,否则「跳过已评」。
  useEffect(() => {
    if (!open) return;
    setMode(part.eligible.length === 0 && part.alreadyEvaluated.length > 0 ? "redo" : "skip");
    // 仅在打开时按当时分区定一次,之后由用户手动切换。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 同供应商隔离警告:任一目标题的被测(实际作答 agent)与所选裁判同供应商。
  const sameProvCount = useMemo(() => {
    const all = [...part.eligible, ...part.alreadyEvaluated];
    let n = 0;
    for (const t of all) {
      const subjId = t.turn.assistant.agentProfileId ?? null;
      const subjProv = subjId
        ? (profiles.find((p) => p.id === subjId)?.providerId ?? null)
        : null;
      const hit = selected.some((id) => {
        const p = profiles.find((x) => x.id === id);
        return p && judgeIsolationLevel(p, subjId, subjProv) === "same-provider";
      });
      if (hit) n += 1;
    }
    return n;
  }, [part, selected, profiles]);

  // 展示按「题」计(多 trial 同题只算一次,与「选中题数」同口径)。
  const qc = useMemo(() => questionCounts(part), [part]);
  // 本次会评到的题数(按题展示);redo=全部已答题,skip=有未评 trial 的题。
  const targetCount = mode === "redo" ? qc.answered : qc.eligible;
  // 是否真有 trial 要跑(底层逐 trial 评分,canRun 用 trial 级判定)。
  const trialTargets =
    mode === "redo"
      ? part.eligible.length + part.alreadyEvaluated.length
      : part.eligible.length;
  const canRun = selected.length > 0 && trialTargets > 0 && !judgeQueue.running;

  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );

  const start = () => {
    if (!canRun) return;
    void runBatchJudge({ questionIds, judgeProfileIds: selected, mode });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">批量 LLM 评分</DialogTitle>
          <DialogDescription className="text-[11.5px]">
            对当前会话里已答过的选中题逐题用 LLM 评分并自动落库(本轮不人工)。
          </DialogDescription>
        </DialogHeader>

        {/* 统计 */}
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[12px]">
          选中 <strong>{questionIds.length}</strong> · 可评{" "}
          <strong className="text-success">{qc.eligible}</strong> · 已评{" "}
          <strong>{qc.alreadyEvaluated}</strong> · 未答跳过{" "}
          <strong className="text-muted-foreground">{qc.unanswered}</strong>
        </div>

        {/* 裁判池 */}
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">评分 LLM 池</div>
          {llmProfiles.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              暂无可用 LLM 模型 — 先到左侧导航「LLM 模型」添加。
            </p>
          ) : (
            <ul className="max-h-44 overflow-auto rounded-md border border-border">
              {llmProfiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-accent/30"
                  >
                    {/* 纯展示:由外层 button 的 onClick 单一 toggle;不再各自 onCheckedChange,
                        否则点 checkbox 会触发两次(checkbox + 冒泡到 button)相互抵消、取消不掉。 */}
                    <Checkbox
                      checked={selected.includes(p.id)}
                      tabIndex={-1}
                      className="pointer-events-none"
                    />
                    <span className="truncate">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 已评处理 */}
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">已评过的题</div>
          <div className="flex gap-1.5">
            <ModeBtn active={mode === "skip"} onClick={() => setMode("skip")}>
              跳过已评
            </ModeBtn>
            <ModeBtn active={mode === "redo"} onClick={() => setMode("redo")}>
              全部重评
            </ModeBtn>
          </div>
        </div>

        {/* 隔离警告 */}
        {sameProvCount > 0 && (
          <p className="text-[11px] text-warning">
            ⚠️ 有 {sameProvCount} 道题的裁判与被测同供应商,独立性存疑(judge 应独立)。
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" className="gap-1" disabled={!canRun} onClick={start}>
            {judgeQueue.running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bot className="h-3.5 w-3.5" />
            )}
            开始评分 {targetCount > 0 ? `(${targetCount})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 rounded-md border px-2 py-1.5 text-[12px] transition-colors " +
        (active
          ? "border-foreground bg-foreground text-background"
          : "border-border hover:bg-secondary")
      }
    >
      {children}
    </button>
  );
}
