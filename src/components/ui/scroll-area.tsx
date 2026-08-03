import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/** 滚动条方位相关 class(抽出便于单测)。 */
export function scrollBarClasses(orientation: "vertical" | "horizontal"): string {
  return orientation === "vertical"
    ? "h-full w-2 border-l border-l-transparent p-[1px]"
    : "h-2 flex-col border-t border-t-transparent p-[1px]";
}

interface ScrollAreaProps
  extends React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  /**
   * 额外挂载水平滚动条。宽内容(表格)必须开:Radix 只有检测到已挂载的水平
   * scrollbar 才把 Viewport 的 overflowX 置为 scroll,否则恒为 hidden —— 超宽
   * 部分不是"要滑动才能看",而是被直接裁掉、完全不可达。
   */
  horizontal?: boolean;
  /**
   * 拿到真正可滚动的 Viewport 元素(Root 的 ref 指向外层容器,读不到 scrollTop)。
   * 需要监听滚动 / 手动 scrollTo(如「贴底 + 回到最新」)时传入。
   */
  viewportRef?: React.Ref<HTMLDivElement>;
}

export const ScrollArea = forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(({ className, children, horizontal, viewportRef, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    // data-hscroll 让 index.css 里那条「Viewport 内层强制 display:block」的全局规则
    // 放行本实例 —— 否则宽表格会被压回容器宽,横滚等于没开。
    data-hscroll={horizontal ? "true" : undefined}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport
      ref={viewportRef}
      className="h-full w-full rounded-[inherit]"
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    {horizontal && <ScrollBar orientation="horizontal" />}
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

export const ScrollBar = forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      scrollBarClasses(orientation),
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border hover:bg-muted-foreground/40" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;
