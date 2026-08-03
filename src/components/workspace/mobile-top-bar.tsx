import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MobileView } from "./mobile-view";

export function MobileTopBar({
  onOpenNav,
  view,
  onViewChange,
  showPanelToggle,
}: {
  onOpenNav: () => void;
  view: MobileView;
  onViewChange: (v: MobileView) => void;
  showPanelToggle: boolean;
}) {
  const seg = (v: MobileView, label: string) => (
    <button
      type="button"
      onClick={() => onViewChange(v)}
      aria-pressed={view === v}
      className={cn(
        "rounded px-2.5 py-1 text-[12px] transition-colors",
        view === v
          ? "bg-background font-medium text-foreground shadow-sm"
          : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="打开菜单"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Menu className="h-5 w-5" />
      </button>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-foreground">
        QA Platform
      </span>
      {showPanelToggle && (
        <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
          {seg("chat", "对话")}
          {seg("panel", "题目")}
        </div>
      )}
    </header>
  );
}
