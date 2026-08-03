import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NoticeToast } from "@/components/notice-toast";
import { ServerStatusBanner } from "@/components/server-status-banner";
import { SyncStatusPill } from "@/components/sync-status-pill";
import { EvaluationRunBanner } from "@/components/evaluation-run-banner";
import { WorkspaceLayout } from "@/pages/WorkspaceLayout";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";

export default function App() {
  // 首页(WorkspaceLayout)常驻挂载,切到别的路由只是 display:none 隐藏(不卸载),
  // 返回首页时保留原本的滚动位置 / 进行中的流式输出 / 弹窗等,不刷新重建。
  const onHome = useLocation().pathname === "/";

  // 进入首页时,右侧始终落回「题目」tab —— 不要停在上次选的「自适应」(或其它)tab。
  // 只在「→ 首页」这一跳触发(用 ref 记上次是否在首页),不干扰用户在首页内主动切 tab。
  const { setRightTab } = useQAStore();
  const wasHome = useRef(false);
  useEffect(() => {
    if (onHome && !wasHome.current) setRightTab("current");
    wasHome.current = onHome;
  }, [onHome, setRightTab]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full flex-col overflow-x-hidden bg-background text-foreground">
        <ServerStatusBanner />
        <EvaluationRunBanner />
        <div className="flex-1 min-h-0">
          <div className={cn("h-full min-h-0", !onHome && "hidden")}>
            <WorkspaceLayout />
          </div>
          {/* 非首页路由(题库 / 报告 / SkillOpt…)在此渲染;首页时无子路由匹配 → 渲染空 */}
          {!onHome && <Outlet />}
        </div>
        <NoticeToast />
        <SyncStatusPill />
      </div>
    </TooltipProvider>
  );
}
