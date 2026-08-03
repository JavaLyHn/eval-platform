import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 统一的「返回首页(评测中心 /)」按钮。放在各全屏子页头部,
 * 保证不管在哪个界面都能一键回首页。
 */
export function HomeButton({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      title="返回首页(评测中心)"
      aria-label="返回首页"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      <Home className="h-3.5 w-3.5" />
      首页
    </Link>
  );
}
