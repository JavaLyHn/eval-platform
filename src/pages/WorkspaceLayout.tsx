/**
 * Two-panel workspace: agent chat on the left, question/evaluation tabs on
 * the right.
 *
 * New / empty conversation → **only the chat** (sidebar + chat = two columns,
 * chat fills the full width). No third column, no reserved blank panel.
 *
 * The right「题目 / 打分 / 结果」panel appears only when there's something to
 * score (selected question / bulk selection / in-flight·done queue for this
 * conv / a question tested here).
 */

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { AgentPanel } from "@/components/agent-panel/agent-panel";
import { QuestionPanel } from "@/components/question-panel/question-panel";
import { QuestionRail } from "@/components/question-panel/question-rail";
import { useQAStore } from "@/hooks/use-qa-store";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useShowRight } from "@/hooks/use-show-right";
import { MobileWorkspace } from "@/components/workspace/mobile-workspace";

export function WorkspaceLayout() {
  const isMobile = useIsMobile();
  const { rightPanelCollapsed } = useQAStore();
  const showRight = useShowRight();

  if (isMobile) return <MobileWorkspace />;

  // 没东西可评分(新会话)→ 只有聊天列,铺满整宽,绝不出现第三列。
  if (!showRight) {
    return (
      <div className="h-full min-h-0">
        <AgentPanel />
      </div>
    );
  }

  // 用户折叠了右栏 → 聊天铺满,右缘留一条 QuestionRail(仿左栏折叠竖条)。
  if (rightPanelCollapsed) {
    return (
      <div className="flex h-full min-h-0">
        <div className="min-w-0 flex-1">
          <AgentPanel />
        </div>
        <QuestionRail />
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId="eval-platform:layout:main"
      className="h-full min-h-0"
    >
      <ResizablePanel defaultSize={40} minSize={22}>
        <AgentPanel />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={60} minSize={28}>
        <QuestionPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
