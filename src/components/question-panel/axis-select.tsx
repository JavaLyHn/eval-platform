import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { cn } from "@/lib/utils";

export interface AxisOption {
  value: string;
  label: string;
  /** Optional leading node (e.g. an employee avatar) shown before the label. */
  icon?: ReactNode;
}

/**
 * 单个轴的「单选」下拉控件:触发器形似 Select(选中项显示在框内),
 * 点选即替换并收起;再点已选项 = 取消;支持「+ 新增取值」(新增时触发器
 * 临时换成输入行,确定后即选中该新值)。
 * 对外仍用 string[](长度 ≤1),与 buildCells / GenSelection 兼容。
 * onAddNew 省略时不显示自定义入口(如员工轴)。
 */
export function AxisSelect({
  label,
  options,
  selected,
  onChange,
  onAddNew,
  onRemove,
  placeholder,
  loading,
  loadingLabel,
  disabled,
}: {
  label: string;
  options: AxisOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  onAddNew?: (value: string) => void;
  /** 提供则每个选项后带删除按钮(点击需确认);删除已选项会一并清空选择。 */
  onRemove?: (value: string) => void;
  placeholder?: string;
  /** 正在异步生成取值时:触发器显示「生成中」并禁用,不展示默认选项。 */
  loading?: boolean;
  loadingLabel?: string;
  /** 前置条件未满足(如场景需先选员工/职业)→ 触发器禁用、点不开,只显示 placeholder。 */
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const current = selected[0] ?? null;
  const optionOf = (v: string) => options.find((o) => o.value === v);
  const labelOf = (v: string) => optionOf(v)?.label ?? v;
  const pick = (v: string) => onChange(current === v ? [] : [v]);

  const commitNew = () => {
    const t = draft.trim();
    if (!t) return;
    onAddNew?.(t);
    onChange([t]);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="text-[11.5px] font-medium text-muted-foreground">{label}</div>
      )}

      {adding ? (
        <div className="flex gap-1">
          <Input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 输入法组字中(选中文候选词)按 Enter/Esc 交给 IME,别当成提交/取消。
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") {
                e.preventDefault();
                commitNew();
              } else if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            placeholder="新增取值"
            className="h-9 flex-1 text-[12px]"
          />
          <Button type="button" size="sm" variant="secondary" className="h-9 px-2 text-[11px]" onClick={commitNew}>
            确定
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 px-2 text-[11px]"
            onClick={() => {
              setAdding(false);
              setDraft("");
            }}
          >
            取消
          </Button>
        </div>
      ) : (
        <DropdownMenu open={menuOpen && !loading && !disabled} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={loading || disabled}
              className={cn(
                "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-left text-[12px]",
                "transition-colors hover:border-foreground/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                (loading || disabled) && "cursor-not-allowed opacity-70",
              )}
            >
              <span
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1.5 truncate",
                  loading || disabled || current === null ? "text-muted-foreground/70" : "text-foreground",
                )}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    <span className="truncate">{loadingLabel ?? "生成中…"}</span>
                  </>
                ) : current === null ? (
                  (placeholder ?? "未指定")
                ) : (
                  <>
                    {optionOf(current)?.icon}
                    <span className="truncate">{labelOf(current)}</span>
                  </>
                )}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 overflow-auto">
            {current !== null && (
              <>
                <DropdownMenuItem
                  onSelect={() => onChange([])}
                  className="text-muted-foreground"
                >
                  <Check className="mr-1.5 h-3 w-3 opacity-0" />
                  清空选择
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {options.map((o) => (
              <DropdownMenuItem
                key={o.value}
                onSelect={() => pick(o.value)}
                className="group flex items-center justify-between gap-2 pr-1"
              >
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Check
                    className={cn(
                      "h-3 w-3 shrink-0",
                      current === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {o.icon}
                  <span className="truncate">{o.label}</span>
                </span>
                {onRemove && (
                  <button
                    type="button"
                    aria-label={`删除 ${o.label}`}
                    title={`删除 ${o.label}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setMenuOpen(false);
                      setPendingDelete(o.value);
                    }}
                    className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </DropdownMenuItem>
            ))}
            {onAddNew && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAdding(true)} className="text-accent">
                  + 新增取值…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* 删除确认:点击选项后的删除按钮 → 先确认再删 */}
      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`删除「${pendingDelete ?? ""}」?`}
        description={`将从${label ? `「${label}」` : "该维度"}选项里移除${
          current === pendingDelete ? "(它正被选中,会一并清空选择)" : ""
        };不影响已生成的题目,也可重新「新增取值」找回。`}
        onConfirm={() => {
          if (pendingDelete === null) return;
          if (current === pendingDelete) onChange([]); // 删的是当前选中 → 清空选择
          onRemove?.(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
