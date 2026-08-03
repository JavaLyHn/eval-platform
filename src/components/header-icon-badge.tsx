import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

type IconType = ComponentType<{ className?: string }>;

/**
 * 页面 / 弹窗头部的动态图标徽标 —— 与首页左上角「QA Platform」徽标同款动效:
 * 渐变底盒(accent→foreground)+ 图标 twinkle(缩放脉动)+ 斜向流光 shimmer。
 * 用它替换各页头部那些静态/纯色的 lucide 图标,动效一眼可辨且全站统一。
 */
export function HeaderIconBadge({
  icon: Icon,
  className,
}: {
  icon: IconType;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-accent to-foreground text-background shadow-sm",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 animate-twinkle" />
      {/* 斜向流光扫过 —— 明显的"动"感(与品牌徽标一致) */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent animate-shimmer" />
    </span>
  );
}
