import { useMemo, useState } from "react";
import { Rocket } from "lucide-react";
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

export function StartEvaluationRunDialog({
  open,
  onOpenChange,
  questionIds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  questionIds: string[];
}) {
  const { profiles, startEvaluationRun, questions, agentForEmployee, standardEmployees } =
    useQAStore();
  const agentProfiles = useMemo(
    () => profiles.filter((p) => getProfileKind(p.providerId) === "agent"),
    [profiles],
  );
  const llmProfiles = useMemo(
    () => profiles.filter((p) => getProfileKind(p.providerId) === "llm"),
    [profiles],
  );
  const [subjectId, setSubjectId] = useState<string>(() => agentProfiles[0]?.id ?? "");
  const [versionLabel, setVersionLabel] = useState("");
  const [trials, setTrials] = useState(1);
  const [judgeIds, setJudgeIds] = useState<string[]>(() =>
    llmProfiles[0] ? [llmProfiles[0].id] : [],
  );
  // mode 固定 skip(YAGNI:UI 不暴露切换,保留常量供后续扩展)
  const mode = "skip" as const;

  const toggleJudge = (id: string) =>
    setJudgeIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );

  const canRun = subjectId !== "" && questionIds.length > 0 && judgeIds.length > 0;

  const subjectName = agentProfiles.find((p) => p.id === subjectId)?.name ?? "所选被测";
  // 一致性校验:选中题里指定了员工、且该员工绑定的 agent ≠ 所选被测的题 → 提示不对题。
  const mismatch = useMemo(() => {
    const names = new Map<string, string>();
    let count = 0;
    for (const qid of questionIds) {
      const emp = questions.find((x) => x.id === qid)?.targetEmployeeId;
      if (!emp || emp === "_all_") continue;
      const bound = agentForEmployee(emp);
      if (bound && bound !== subjectId) {
        count += 1;
        names.set(emp, standardEmployees.find((e) => e.id === emp)?.name ?? emp);
      }
    }
    return { count, employees: [...names.values()] };
  }, [questionIds, subjectId, questions, agentForEmployee, standardEmployees]);

  const start = () => {
    if (!canRun) return;
    startEvaluationRun({
      subjectProfileId: subjectId,
      versionLabel: versionLabel.trim() || new Date().toISOString().slice(0, 10),
      config: {
        questionIds,
        trialsPerQuestion: Math.max(1, trials),
        judgeProfileIds: judgeIds,
        judgeMode: mode,
      },
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">自动化评测</DialogTitle>
          <DialogDescription className="text-[11.5px]">
            对选中题一键 跑→评→出报告,留档为一次评测运行。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[12px]">
          选中 <strong>{questionIds.length}</strong> 题 · 每题{" "}
          <strong>{Math.max(1, trials)}</strong> 次
        </div>

        {/* 被测 */}
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            被测对象(员工 / agent)
          </span>
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12.5px]"
          >
            {agentProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {mismatch.count > 0 && (
            <p className="text-[11px] text-warning">
              ⚠️ 选中题里有 {mismatch.count} 道指定了员工「{mismatch.employees.join("、")}」,
              与所选被测「{subjectName}」不一致——评测会**强制用所选被测**作答,结果可能不对题。
            </p>
          )}
        </label>

        {/* 版本标签 */}
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">版本标签</span>
          <input
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            placeholder="如 opus-4.8 / 2026-06-23"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12.5px]"
          />
        </label>

        {/* trials */}
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            每题 trial 次数(pass^k,1=单次)
          </span>
          <input
            type="number"
            min={1}
            max={5}
            value={trials}
            onChange={(e) => setTrials(Number(e.target.value) || 1)}
            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-[12.5px]"
          />
        </label>

        {/* 裁判池 */}
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">评分 LLM 池</div>
          <ul className="max-h-32 overflow-auto rounded-md border border-border">
            {llmProfiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => toggleJudge(p.id)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-accent/30"
                >
                  {/* 纯展示:由外层 button 的 onClick 单一 toggle;不再 onCheckedChange,
                      否则点 checkbox 会触发两次(checkbox + 冒泡到 button)相互抵消、取消不掉。 */}
                  <Checkbox
                    checked={judgeIds.includes(p.id)}
                    tabIndex={-1}
                    className="pointer-events-none"
                  />
                  <span className="truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" className="gap-1" disabled={!canRun} onClick={start}>
            <Rocket className="h-3.5 w-3.5" /> 发起
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
