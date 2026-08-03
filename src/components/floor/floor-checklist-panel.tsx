import { useMemo, useState } from "react";
import { Plus, Sparkles, Trash2, ShieldAlert, Crosshair, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQAStore } from "@/hooks/use-qa-store";
import {
  deriveSeedCandidates,
  FLOOR_CATEGORY_LABELS,
} from "@/lib/floor-elements";
import { resolveEmployeeMetrics } from "@/lib/employee-metrics";
import { findStandardEmployee } from "@/lib/standard-employees";
import { cn } from "@/lib/utils";
import type { FloorElement } from "@/types";
import { FloorChecklistDialog } from "./floor-checklist-dialog";
import { FloorProbeDialog } from "./floor-probe-dialog";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import { FloorElementDetailDialog } from "./floor-element-detail-dialog";

// 新增要素的默认标题；未改名 = 还没填的草稿条。
const TITLE_PLAIN = "新下限要素";
const TITLE_REDLINE = "新强制要素（红线）";
const DRAFT_TITLES = new Set([TITLE_PLAIN, TITLE_REDLINE]);

export function FloorChecklistPanel({ employeeId }: { employeeId: string }) {
  const {
    floorElements,
    questions,
    importFloorCandidates,
    addFloorElement,
    updateFloorElement,
    deleteFloorElement,
    toggleQuestionFloorElement,
    employeeMetrics,
    showNotice,
  } = useQAStore();

  const employee = findStandardEmployee(employeeId);
  const mine = useMemo(
    () => floorElements.filter((f) => f.employeeId === employeeId),
    [floorElements, employeeId],
  );
  const myQuestions = useMemo(
    () => questions.filter((q) => q.targetEmployeeId === employeeId),
    [questions, employeeId],
  );

  const [aiOpen, setAiOpen] = useState(false);

  const redCount = mine.filter((f) => f.isRedLine).length;
  // 有未填的草稿条（标题还是默认/为空）时，禁止再加，避免堆一堆空白条。
  const hasDraft = mine.some(
    (f) => !f.title.trim() || DRAFT_TITLES.has(f.title.trim()),
  );

  // 从画像生成/补齐种子。入库已去重 → 已存在的会跳过,只补缺的(可用来找回误删的种子项)。
  const seed = () => {
    if (!employee) return;
    const metrics = resolveEmployeeMetrics(
      employee.specificMetricTemplates,
      employeeMetrics[employeeId],
    );
    const created = importFloorCandidates(
      deriveSeedCandidates(employee, metrics),
    ).length;
    showNotice({
      kind: created > 0 ? "success" : "info",
      message: created > 0 ? `补回 ${created} 条种子要素` : "种子要素已齐，无新增",
    });
  };

  // 加要素时即可选强制（红线）/非强制。红线默认归 audit-security（红线最常落处）。
  const addElement = (isRedLine: boolean) =>
    addFloorElement({
      employeeId,
      layer: "L2",
      category: isRedLine ? "audit-security" : "business-rules",
      title: isRedLine ? TITLE_REDLINE : TITLE_PLAIN,
      passForm: "",
      failForm: "",
      isRedLine,
      source: "manual",
    });

  if (!employee) {
    return (
      <div className="px-2 py-6 text-center text-[11.5px] text-muted-foreground">
        未找到员工 {employeeId}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          {employee?.name} · {mine.length} 条要素
          {redCount > 0 && ` · ${redCount} 红线`}
          {hasDraft && <span className="ml-1 text-warning">· 先填完新要素</span>}
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={mine.length === 0 ? "default" : "outline"}
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={seed}
            title="从员工画像补齐种子下限要素;已存在的自动跳过,不会重复(可用来找回误删的种子项)"
          >
            <Sparkles className="h-3 w-3" />
            {mine.length === 0 ? "从画像生成种子" : "补齐种子"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => setAiOpen(true)}
          >
            <Sparkles className="h-3 w-3" /> AI 草拟
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => addElement(false)}
            disabled={hasDraft}
            title={
              hasDraft
                ? "先填完上一条新要素再加"
                : "非强制项：可部分给分、不一票否决"
            }
          >
            <Plus className="h-3 w-3" /> 加要素
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px] text-destructive hover:text-destructive"
            onClick={() => addElement(true)}
            disabled={hasDraft}
            title={
              hasDraft
                ? "先填完上一条新要素再加"
                : "强制项（红线）：踩了即一票否决"
            }
          >
            <ShieldAlert className="h-3 w-3" /> 加红线
          </Button>
        </div>
      </div>

      <ScrollArea className="-mx-1 flex-1">
        <ul className="space-y-1.5 px-1 pb-2">
          {mine.length === 0 && (
            <li className="px-2 py-6 text-center text-[11.5px] text-muted-foreground">
              还没有下限要素。点「从画像生成种子」起一份，再人工校。
            </li>
          )}
          {mine.map((f) => (
            <ElementRow
              key={f.id}
              element={f}
              employeeId={employeeId}
              probeQuestions={myQuestions}
              onPatch={(patch) => updateFloorElement(f.id, patch)}
              onDelete={() => deleteFloorElement(f.id)}
              onToggleProbe={(qId, checked) =>
                toggleQuestionFloorElement(qId, f.id, checked)
              }
            />
          ))}
        </ul>
      </ScrollArea>
      <FloorChecklistDialog
        employeeId={employeeId}
        open={aiOpen}
        onOpenChange={setAiOpen}
      />
    </div>
  );
}

function ElementRow({
  element,
  employeeId,
  probeQuestions,
  onPatch,
  onDelete,
  onToggleProbe,
}: {
  element: FloorElement;
  employeeId: string;
  probeQuestions: Array<{ id: string; title: string; floorElementIds?: string[] }>;
  onPatch: (patch: Partial<FloorElement>) => void;
  onDelete: () => void;
  onToggleProbe: (questionId: string, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [probeOpen, setProbeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const linkedCount = probeQuestions.filter((q) =>
    (q.floorElementIds ?? []).includes(element.id),
  ).length;

  return (
    <li
      className={cn(
        "rounded-md border bg-card p-2.5 text-[12.5px]",
        element.isRedLine
          ? "border-destructive/40 bg-destructive/5"
          : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        {element.isRedLine && (
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
        )}
        <input
          value={element.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-medium text-foreground focus:outline-none"
        />
        <Badge variant="muted" className="text-[10px]">
          {element.layer} · {FLOOR_CATEGORY_LABELS[element.category]}
        </Badge>
        <button
          type="button"
          onClick={() => onPatch({ isRedLine: !element.isRedLine })}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px]",
            element.isRedLine
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
          )}
          title="红线 = 一票否决"
        >
          红线
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[10.5px] text-muted-foreground hover:text-foreground"
        >
          探针 {linkedCount}
        </button>
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground hover:text-foreground"
          title="查看 / 编辑完整内容"
        >
          <Eye className="h-3 w-3" /> 详情
        </button>
        <button
          type="button"
          onClick={() => setProbeOpen(true)}
          className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground hover:text-foreground"
          title="用 AI 为这条要素出探针题"
        >
          <Crosshair className="h-3 w-3" /> 出探针
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
          aria-label="删除要素"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <input
          value={element.passForm}
          onChange={(e) => onPatch({ passForm: e.target.value })}
          placeholder="Pass 形态（在位）"
          className="rounded border border-border bg-background px-2 py-1 text-[11px]"
        />
        <input
          value={element.failForm}
          onChange={(e) => onPatch({ failForm: e.target.value })}
          placeholder="Fail 形态（缺口）"
          className="rounded border border-border bg-background px-2 py-1 text-[11px]"
        />
      </div>

      {open && (
        <div className="mt-2 rounded border border-border bg-background/60 p-2">
          <div className="mb-1 text-[10.5px] text-muted-foreground">
            勾选验证此要素的探针题（该员工题库）：
          </div>
          {probeQuestions.length === 0 ? (
            <div className="text-[10.5px] text-muted-foreground">
              该员工还没有题。去题库出题并设 targetEmployeeId。
            </div>
          ) : (
            <ul className="space-y-0.5">
              {probeQuestions.map((q) => {
                const checked = (q.floorElementIds ?? []).includes(element.id);
                return (
                  <li key={q.id}>
                    <label className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => onToggleProbe(q.id, e.target.checked)}
                      />
                      <span className="truncate">{q.title}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {probeOpen && (
        <FloorProbeDialog
          element={element}
          employeeId={employeeId}
          open={probeOpen}
          onOpenChange={setProbeOpen}
        />
      )}
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`删除下限要素「${element.title}」？`}
        description="删除后无法恢复（下限清单是本地数据，无撤销）。挂在它上面的探针题不会被删，只会与该要素解除关联。"
        onConfirm={onDelete}
      />
      {detailOpen && (
        <FloorElementDetailDialog
          element={element}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onPatch={onPatch}
        />
      )}
    </li>
  );
}
