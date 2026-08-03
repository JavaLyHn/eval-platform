import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FLOOR_CATEGORY_LABELS, layerOf } from "@/lib/floor-elements";
import { cn } from "@/lib/utils";
import type { FloorCategory, FloorElement } from "@/types";

const SOURCE_LABEL: Record<FloorElement["source"], string> = {
  seed: "种子",
  llm: "AI 草拟",
  manual: "手动",
  inferred: "反推",
};

/**
 * 下限要素「查看详情」——行内只能看大概，长内容看不全；这里用大文本域完整显示/编辑全部字段。
 * 受控于 store：所有改动经 onPatch(updateFloorElement) 写回，关掉再开内容一致。
 */
export function FloorElementDetailDialog({
  element,
  open,
  onOpenChange,
  onPatch,
}: {
  element: FloorElement;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPatch: (patch: Partial<FloorElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(640px,95vw)] flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-[14px]">
            下限要素详情
            {element.isRedLine && (
              <Badge variant="destructive" className="text-[10px]">
                红线
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="-mx-1 min-h-0 flex-1">
          <div className="space-y-3 px-1 pb-2">
            <Field label="要素标题">
              <textarea
                value={element.title}
                onChange={(e) => onPatch({ title: e.target.value })}
                rows={2}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12.5px]"
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">分类</span>
              <Select
                value={element.category}
                onValueChange={(v) =>
                  onPatch({
                    category: v as FloorCategory,
                    layer: layerOf(v as FloorCategory),
                  })
                }
              >
                <SelectTrigger className="h-7 w-[180px] text-[11.5px]">
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
              <Badge variant="muted" className="text-[10px]">
                {element.layer}
              </Badge>
              <button
                type="button"
                onClick={() => onPatch({ isRedLine: !element.isRedLine })}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px]",
                  element.isRedLine
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
                title="红线 = 一票否决"
              >
                {element.isRedLine ? "🛡 红线" : "非红线"}
              </button>
              <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={!!element.requiresCitation}
                  onChange={(e) =>
                    onPatch({ requiresCitation: e.target.checked || undefined })
                  }
                />
                需出处可溯
              </label>
            </div>

            <Field label="子项 (subType，可选)">
              <input
                value={element.subType ?? ""}
                onChange={(e) =>
                  onPatch({ subType: e.target.value || undefined })
                }
                placeholder="如：数据边界 / 风控规则 / 操作中断"
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px]"
              />
            </Field>

            <Field label="Pass 形态（做到什么算「在位」）">
              <textarea
                value={element.passForm}
                onChange={(e) => onPatch({ passForm: e.target.value })}
                rows={4}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] leading-relaxed"
              />
            </Field>

            <Field label="Fail 形态（出现什么算「缺口」）">
              <textarea
                value={element.failForm}
                onChange={(e) => onPatch({ failForm: e.target.value })}
                rows={4}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] leading-relaxed"
              />
            </Field>

            <Field label="历史反例 / 已知踩坑（每行一条，用于出探针题）">
              <textarea
                value={(element.counterExamples ?? []).join("\n")}
                onChange={(e) => {
                  const arr = e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  onPatch({ counterExamples: arr.length ? arr : undefined });
                }}
                rows={3}
                placeholder="一行一条"
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px]"
              />
            </Field>

            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-[10.5px] text-muted-foreground">
              <span>来源：{SOURCE_LABEL[element.source] ?? element.source}</span>
              {element.createdAt && (
                <span>创建：{element.createdAt.slice(0, 10)}</span>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
