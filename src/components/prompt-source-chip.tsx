import { useMemo, useState } from "react";
import { ExternalLink, FileCode2 } from "lucide-react";
import { getPromptView } from "@/lib/prompt-registry";
import { PromptManagerDialog } from "@/pages/PromptsPage";
import { cn } from "@/lib/utils";

/**
 * Prompt 来源指示条:不再在功能页内整页预览 prompt,只标出
 * 「用的是哪个 prompt + 当前生效版本」。「查看 / 编辑」在**页内浮层**打开 Prompt 管理
 * (不跳路由 → 当前界面与其选择 / 弹窗状态全保留;关掉浮层即回原样)。
 */
export function PromptSourceChip({
  promptKey,
  className,
}: {
  promptKey: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // 关闭浮层后 +1,重读 getPromptView → 若在浮层里改了生效版本,这里的版本号随即更新。
  const [rev, setRev] = useState(0);
  const view = useMemo(() => getPromptView(promptKey), [promptKey, rev]);
  if (!view) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card/40 px-2.5 py-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <FileCode2 className="h-3 w-3 shrink-0" />
      <span>
        Prompt:
        <span className="font-medium text-foreground">{view.def.name}</span>
        <code className="mx-1 rounded bg-secondary px-1 py-px font-mono text-[10px]">
          {view.def.key}
        </code>
        · 生效{" "}
        {view.isCustomActive ? `自定义 v${view.activeVersion}` : "内置默认 v1"}
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-accent hover:underline"
      >
        在 Prompt 管理查看 / 编辑
        <ExternalLink className="h-3 w-3" />
      </button>
      <PromptManagerDialog
        promptKey={promptKey}
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setRev((v) => v + 1); // 关闭时刷新显示的生效版本
        }}
      />
    </div>
  );
}
