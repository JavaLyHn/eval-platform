import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Plus, Sparkles, Trash2, RotateCcw, EyeOff, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQAStore } from "@/hooks/use-qa-store";
import { findStandardEmployee } from "@/lib/standard-employees";
import {
  resolveEmployeeMetrics,
  hiddenBuiltins,
  type ResolvedMetric,
} from "@/lib/employee-metrics";
import type { MetricOverride } from "@/types";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import { MetricDraftDialog } from "./metric-draft-dialog";

export function MetricEditorDialog({
  employeeId,
  open,
  onOpenChange,
}: {
  employeeId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const {
    employeeMetrics,
    setMetricOverride,
    restoreBuiltinMetric,
    hideBuiltinMetric,
    addCustomMetric,
    updateCustomMetric,
    deleteCustomMetric,
    resetEmployeeMetrics,
  } = useQAStore();

  const employee = findStandardEmployee(employeeId);
  const overlay = employeeMetrics[employeeId];
  const builtins = useMemo(() => employee?.specificMetricTemplates ?? [], [employee]);

  const resolved = useMemo(
    () => resolveEmployeeMetrics(builtins, overlay),
    [builtins, overlay],
  );
  const hidden = useMemo(() => hiddenBuiltins(builtins, overlay), [builtins, overlay]);

  const builtinRows = resolved.filter((m) => m.origin === "builtin");
  const customRows = resolved.filter((m) => m.origin === "custom");
  // 有空 label 的自定义草稿时禁止再加,避免堆空白条。
  const hasBlankCustom = customRows.some((m) => !m.label.trim());

  const [aiOpen, setAiOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // 关闭弹窗(完成 / Esc / 点外面)时,丢弃 label 为空的自定义指标——加了没填的不保存。
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      for (const m of customRows) {
        if (!m.label.trim()) deleteCustomMetric(employeeId, m.key);
      }
    }
    onOpenChange(next);
  };

  if (!employee) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[82vh] w-[min(760px,95vw)] flex-col">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            角色专属指标 · {employee.name}
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">
            内置指标来自评测标准基线,可逐字段改写 / 隐藏 / 恢复;也可手动加或 AI 草拟自定义指标。
            改完去「下限清单」点「补齐种子」让改动流入保下限(单向显式,不回溯改写已入库要素;按指标名去重,
            只改 Pass/Fail 而不改指标名不会生成新种子)。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground">
            内置 {builtinRows.length} · 自定义 {customRows.length}
            {hidden.length > 0 && ` · 已隐藏 ${hidden.length}`}
            {hasBlankCustom && <span className="ml-1 text-warning">· 先填完新指标</span>}
          </div>
          <div className="flex gap-1">
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
              disabled={hasBlankCustom}
              onClick={() =>
                addCustomMetric(employeeId, { label: "", description: "" })
              }
              title={hasBlankCustom ? "先填完上一条新指标再加" : "手动加一条自定义指标"}
            >
              <Plus className="h-3 w-3" /> 加指标
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-[11px] text-destructive hover:text-destructive"
              disabled={!overlay}
              onClick={() => setConfirmReset(true)}
              title="清掉本员工所有改写 / 隐藏 / 自定义,恢复评测标准默认"
            >
              <RotateCcw className="h-3 w-3" /> 恢复全部默认
            </Button>
          </div>
        </div>

        <ScrollArea className="-mx-1 min-h-0 flex-1">
          <div className="space-y-3 px-1 pb-2">
            {/* 自定义:新加的置顶,所以整组放最前 */}
            <Group label="自定义指标(用户 / AI)">
              {customRows.length === 0 && (
                <Empty text="还没有自定义指标。点「加指标」或「AI 草拟」。" />
              )}
              {customRows.map((m) => (
                <CustomRow
                  key={m.key}
                  metric={m}
                  onPatch={(patch) => updateCustomMetric(employeeId, m.key, patch)}
                  onDelete={() => deleteCustomMetric(employeeId, m.key)}
                />
              ))}
            </Group>

            {/* 内置 */}
            <Group label="内置指标(评测标准基线)">
              {builtinRows.length === 0 && (
                <Empty text="内置指标都被隐藏了。下面可恢复。" />
              )}
              {builtinRows.map((m) => (
                <BuiltinRow
                  key={m.key}
                  metric={m}
                  onPatch={(patch) => setMetricOverride(employeeId, m.key, patch)}
                  onRestore={() => restoreBuiltinMetric(employeeId, m.key)}
                  onHide={() => hideBuiltinMetric(employeeId, m.key)}
                />
              ))}
            </Group>

            {/* 已隐藏内置 */}
            {hidden.length > 0 && (
              <Group label="已隐藏的内置指标">
                <li className="flex flex-wrap gap-1.5">
                  {hidden.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => restoreBuiltinMetric(employeeId, b.key)}
                      className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-1 text-[10.5px] text-muted-foreground hover:text-foreground"
                      title="恢复这条内置指标"
                    >
                      <Undo2 className="h-3 w-3" /> {b.label}
                    </button>
                  ))}
                </li>
              </Group>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button size="sm" onClick={() => handleOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>

      <MetricDraftDialog
        employeeId={employeeId}
        open={aiOpen}
        onOpenChange={setAiOpen}
      />
      <ConfirmDeleteDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`恢复 ${employee.name} 的全部指标默认?`}
        description="将清掉对该员工的所有改写、隐藏与自定义指标,回到评测标准基线。已入库的保下限要素不受影响。"
        onConfirm={() => resetEmployeeMetrics(employeeId)}
      />
    </Dialog>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">{label}</div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <li className="rounded-md border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
      {text}
    </li>
  );
}

function BuiltinRow({
  metric,
  onPatch,
  onRestore,
  onHide,
}: {
  metric: ResolvedMetric;
  onPatch: (patch: MetricOverride) => void;
  onRestore: () => void;
  onHide: () => void;
}) {
  return (
    <li className="rounded-md border border-border bg-card p-2.5 text-[12.5px]">
      <div className="flex items-center gap-2">
        <input
          value={metric.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-medium text-foreground focus:outline-none"
        />
        {metric.edited && (
          <Badge variant="muted" className="text-[10px]">
            已改
          </Badge>
        )}
        {metric.edited && (
          <button
            type="button"
            onClick={onRestore}
            className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground hover:text-foreground"
            title="恢复这条到默认"
          >
            <RotateCcw className="h-3 w-3" /> 恢复
          </button>
        )}
        <button
          type="button"
          onClick={onHide}
          className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground hover:text-destructive"
          title="隐藏这条内置指标(可恢复)"
        >
          <EyeOff className="h-3 w-3" /> 隐藏
        </button>
      </div>
      <textarea
        value={metric.description}
        onChange={(e) => onPatch({ description: e.target.value })}
        rows={2}
        placeholder="这个指标在测什么"
        className="mt-1.5 w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
      />
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <input
          value={metric.passFormHint ?? ""}
          onChange={(e) => onPatch({ passFormHint: e.target.value })}
          placeholder="Pass 形态参考"
          className="rounded border border-border bg-background px-2 py-1 text-[11px]"
        />
        <input
          value={metric.failFormHint ?? ""}
          onChange={(e) => onPatch({ failFormHint: e.target.value })}
          placeholder="Fail 形态参考"
          className="rounded border border-border bg-background px-2 py-1 text-[11px]"
        />
      </div>
    </li>
  );
}

function CustomRow({
  metric,
  onPatch,
  onDelete,
}: {
  metric: ResolvedMetric;
  onPatch: (patch: MetricOverride) => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="rounded-md border border-foreground/30 bg-card p-2.5 text-[12.5px]">
      <div className="flex items-center gap-2">
        <input
          value={metric.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder="指标名"
          className="min-w-0 flex-1 bg-transparent font-medium text-foreground focus:outline-none"
        />
        <Badge variant="muted" className="text-[10px]">
          自定义
        </Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => setConfirm(true)}
          aria-label="删除指标"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <textarea
        value={metric.description}
        onChange={(e) => onPatch({ description: e.target.value })}
        rows={2}
        placeholder="这个指标在测什么"
        className="mt-1.5 w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
      />
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <input
          value={metric.passFormHint ?? ""}
          onChange={(e) => onPatch({ passFormHint: e.target.value })}
          placeholder="Pass 形态参考"
          className="rounded border border-border bg-background px-2 py-1 text-[11px]"
        />
        <input
          value={metric.failFormHint ?? ""}
          onChange={(e) => onPatch({ failFormHint: e.target.value })}
          placeholder="Fail 形态参考"
          className="rounded border border-border bg-background px-2 py-1 text-[11px]"
        />
      </div>
      <ConfirmDeleteDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`删除自定义指标「${metric.label || "未命名"}」?`}
        description="删除后无法恢复(指标 overlay 是本地数据)。已入库的保下限要素不受影响。"
        onConfirm={onDelete}
      />
    </li>
  );
}
