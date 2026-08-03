import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ChatColumn } from "@/components/agent-panel/chat-column";
import { ChatSidebar } from "@/components/agent-panel/chat-sidebar";
import { QuestionPanel } from "@/components/question-panel/question-panel";
import { useShowRight } from "@/hooks/use-show-right";
import { MobileTopBar } from "./mobile-top-bar";
import { nextMobileViewOnShowRightChange, type MobileView } from "./mobile-view";

/**
 * 手机(<768px)首页外壳:顶栏 + 单视图(对话/题目)+ 左侧导航抽屉。
 * 视图随 showRight 跳变自动切换(见 nextMobileViewOnShowRightChange),两次跳变间用户手动切换生效。
 */
export function MobileWorkspace() {
  const showRight = useShowRight();
  const [navOpen, setNavOpen] = useState(false);
  const [view, setView] = useState<MobileView>(() => (showRight ? "panel" : "chat"));
  const prevShowRight = useRef(showRight);

  useEffect(() => {
    const next = nextMobileViewOnShowRightChange(prevShowRight.current, showRight);
    prevShowRight.current = showRight;
    if (next) setView(next);
  }, [showRight]);

  // 没有可评分内容时强制回对话(题目面板此时也无内容)。
  const contentView: MobileView = view === "panel" && showRight ? "panel" : "chat";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <MobileTopBar
        onOpenNav={() => setNavOpen(true)}
        view={contentView}
        onViewChange={setView}
        showPanelToggle={showRight}
      />
      <div className="min-h-0 flex-1">
        {contentView === "panel" ? <QuestionPanel hideCollapse /> : <ChatColumn />}
      </div>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        {/* 抽屉宽 = 侧栏固定宽(w-64),避免 aside 右侧露空条 */}
        <SheetContent side="left" hideClose className="w-64 p-0">
          <ChatSidebar
            collapsed={false}
            onToggleCollapse={() => setNavOpen(false)}
            onNavigate={() => setNavOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
