import { createContext, useContext, useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { cn } from "@/lib/utils";

/** 桌面左侧列表栏的 class(抽出便于单测)。 */
export function masterListAsideClasses(widthClass: string, extra?: string): string {
  return cn(widthClass, "shrink-0", extra);
}

const CloseListCtx = createContext<() => void>(() => {});

/** 列表内部调用以关抽屉(手机);桌面为 no-op。 */
export function useCloseMasterList(): () => void {
  return useContext(CloseListCtx);
}

/**
 * 「左列表 + 右详情」主从布局外壳。
 * 桌面:定宽 aside + 详情 flex-1(与各页原结构等价)。
 * 手机:详情铺满 + 顶部触发栏,列表进左侧抽屉;列表项点选后经 useCloseMasterList() 关抽屉。
 *
 * 注意(首页 I-1 教训):若列表里含弹窗宿主,不要在开弹窗时关抽屉 —— 那会连宿主一起卸载。
 * 本组件只在「选中列表项」时关。
 */
export function MasterDetailShell({
  list,
  children,
  listWidthClass = "w-72",
  listLabel = "选择",
  listClassName,
  hideList = false,
}: {
  list: React.ReactNode;
  children: React.ReactNode;
  listWidthClass?: string;
  listLabel?: string;
  listClassName?: string;
  /**
   * 暂时没有列表可看(如 SkillOpt 还没攒够题集)。桌面不渲染 aside、手机不显示触发栏与抽屉,
   * 但**组件本身照常挂载** —— 这样调用方可以无条件渲染本组件,避免"有/无列表"切换时
   * children 所在位置的元素类型变化导致 React 重挂子树、丢掉用户正在编辑的状态。
   */
  hideList?: boolean;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  // 没列表可看时把 open 归位。Radix 是受控的:光把 open 传 false 只是"看起来关了",
  // 内部 state 仍是 true —— 等 hideList 再翻回 false,抽屉会自己弹开。
  useEffect(() => {
    if (hideList) setOpen(false);
  }, [hideList]);

  if (!isMobile) {
    return (
      <div className="flex min-h-0 flex-1">
        {!hideList && (
          <aside className={masterListAsideClasses(listWidthClass, listClassName)}>{list}</aside>
        )}
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    );
  }

  return (
    <CloseListCtx.Provider value={() => setOpen(false)}>
      <div className="flex min-h-0 flex-1 flex-col">
        {!hideList && (
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Menu className="h-3.5 w-3.5" />
              {listLabel}
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        <Sheet open={hideList ? false : open} onOpenChange={setOpen}>
          {/* 宽度与首页侧栏抽屉(w-64)刻意不同:首页装的是固定 w-64 的侧栏,宽度必须匹配才
              不露空条;这里装的是流式列表(目录 / 员工),窄屏给到 88vw 更好读。别"统一"。 */}
          {/* p-2 而非 p-0:listClassName 里的内边距只作用于桌面 aside,抽屉里得自己给,
              否则列表贴着屏幕边缘。 */}
          <SheetContent side="left" hideClose className="w-[min(88vw,320px)] overflow-y-auto p-2">
            {list}
          </SheetContent>
        </Sheet>
      </div>
    </CloseListCtx.Provider>
  );
}
