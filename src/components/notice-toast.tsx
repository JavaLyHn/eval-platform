import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

const STYLES = {
  success: "border-success/30 bg-success/10 text-success",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-border bg-popover text-foreground",
} as const;

/**
 * Lightweight, store-driven toast. Listens to `notice` and auto-dismisses
 * after a few seconds (error notices linger longer so users can read the
 * failure reason).
 */
export function NoticeToast() {
  const { notice, dismissNotice } = useQAStore();

  useEffect(() => {
    if (!notice) return;
    const ttl = notice.kind === "error" ? 7000 : 3500;
    const t = setTimeout(() => dismissNotice(notice.id), ttl);
    return () => clearTimeout(t);
  }, [notice, dismissNotice]);

  if (!notice) return null;
  const Icon = ICONS[notice.kind];

  return (
    // 定位写法别"简化":`inset-x-4 + w-auto + ml-auto` 是刻意的 ——
    // 窄屏(390px)靠 inset-x-4 两侧留白、不会像旧写法(right-4 + w-full max-w-sm=384px)
    // 那样把左缘顶到屏幕外;宽屏由 max-w-sm 夹宽、单侧 ml-auto 吃掉余量,仍钉在右上角。
    <div
      className="pointer-events-none fixed inset-x-4 top-4 z-[100] ml-auto flex w-auto max-w-sm justify-end"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          "pointer-events-auto flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 shadow-lg backdrop-blur",
          STYLES[notice.kind],
          "animate-in slide-in-from-top-2 fade-in-0",
        )}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-tight">
            {notice.message}
          </div>
          {notice.detail ? (
            <div className="mt-1 break-words text-[11.5px] leading-snug opacity-80">
              {notice.detail}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => dismissNotice(notice.id)}
          className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
