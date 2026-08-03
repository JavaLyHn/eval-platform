import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MultiSelectFilter } from "@/components/question-panel/multi-select-filter";
import { downloadBlob, questionsToJSON } from "@/lib/io";
import {
  selectQuestionsForExport, defaultExportFilename, normalizeExportFilename,
  type ExportCriteria,
} from "@/lib/bank-export";
import type { Question } from "@/types";

const INTENT_OPTS = [
  { value: "typical", label: "typical 典型" },
  { value: "boundary", label: "boundary 边界" },
  { value: "anomaly", label: "anomaly 异常" },
];
const SEV_OPTS = [
  { value: "P0", label: "P0 核心" },
  { value: "P1", label: "P1 差异化" },
  { value: "P2", label: "P2 细节" },
];
const CT_OPTS = [
  { value: "acceptAny", label: "正常(任务)" },
  { value: "interception", label: "红线" },
  { value: "standard", label: "意图" },
];

export interface ExportBankDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "agent" | "skill";
  questions: Question[];
  employeeOptions: { id: string; name: string }[];
  initialCriteria: ExportCriteria;
}

export function ExportBankDialog({
  open, onOpenChange, kind, questions, employeeOptions, initialCriteria,
}: ExportBankDialogProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [criteria, setCriteria] = useState<ExportCriteria>(initialCriteria);
  const [filename, setFilename] = useState(defaultExportFilename(kind, today));

  // 每次打开(或库类型切换)时,重置为「打开那一刻」页面的带入筛选 + 默认文件名。
  // 只在 open→true / kind 变化时重置;initialCriteria 每次渲染是新对象,故意不入依赖
  // (只在开启瞬间取一次,避免开启期间父级重渲染反复覆盖用户在弹窗内的改动)。
  useEffect(() => {
    if (!open) return;
    setCriteria(initialCriteria);
    setFilename(defaultExportFilename(kind, today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  const set = (patch: Partial<ExportCriteria>) => setCriteria((c) => ({ ...c, ...patch }));

  // skill:当前所选员工出现过的技能(与页面 skillOptions 同逻辑);employee=all 时不列。
  const skillOptions = useMemo(() => {
    if (kind !== "skill" || criteria.employee === "all") return [];
    const s = new Set<string>();
    for (const q of questions) {
      if (q.transient || q.kind !== "skill") continue;
      if (q.targetEmployeeId !== criteria.employee) continue;
      if (q.targetSkill) s.add(q.targetSkill);
    }
    return Array.from(s).sort();
  }, [questions, kind, criteria.employee]);

  const selected = useMemo(
    () => selectQuestionsForExport(questions, kind, criteria),
    [questions, kind, criteria],
  );

  const doExport = () => {
    if (selected.length === 0) return;
    downloadBlob(
      normalizeExportFilename(filename, kind, today),
      questionsToJSON(selected),
      "application/json",
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>导出{kind === "skill" ? " skill " : ""}题库</DialogTitle>
          <DialogDescription>
            按分类挑选后导出为无损 JSON(可再导入完整还原)。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-muted-foreground">员工</span>
            <Select
              value={criteria.employee}
              onValueChange={(v) => set({ employee: v, skills: [] })}
            >
              <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部员工</SelectItem>
                {employeeOptions.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {kind === "agent" ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-muted-foreground">严重度</span>
                <MultiSelectFilter
                  allLabel="全部严重度" className="flex-1"
                  options={SEV_OPTS}
                  selected={criteria.severities ?? []}
                  onChange={(n) => set({ severities: n })}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-muted-foreground">意图</span>
                <MultiSelectFilter
                  allLabel="全部意图" className="flex-1"
                  options={INTENT_OPTS}
                  selected={criteria.intents ?? []}
                  onChange={(n) => set({ intents: n })}
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-muted-foreground">题型</span>
                <MultiSelectFilter
                  allLabel="全部题型" className="flex-1"
                  options={CT_OPTS}
                  selected={criteria.caseTypes ?? []}
                  onChange={(n) => set({ caseTypes: n })}
                />
              </div>
              {criteria.employee !== "all" && skillOptions.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-muted-foreground">技能</span>
                  <MultiSelectFilter
                    allLabel="全部 skill" className="flex-1"
                    options={skillOptions.map((s) => ({ value: s, label: s }))}
                    selected={criteria.skills ?? []}
                    onChange={(n) => set({ skills: n })}
                  />
                </div>
              )}
            </>
          )}

          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-muted-foreground">文件名</span>
            <Input
              className="h-8 flex-1 text-[12px]"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder={defaultExportFilename(kind, today)}
            />
          </div>

          <div className="text-[11px] text-muted-foreground">
            将导出 <span className="font-medium text-foreground">{selected.length}</span> 条题目
          </div>

          <div className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
            附件(文件 / 图片)随本 JSON 一并<span className="text-foreground">无损导出</span>;
            <span className="text-foreground">CSV 格式不含附件</span>,勿用 CSV 备份带附件的题。
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            size="sm"
            className="gap-1"
            disabled={selected.length === 0 || filename.trim() === ""}
            onClick={doExport}
          >
            <Download className="h-3.5 w-3.5" /> 导出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
