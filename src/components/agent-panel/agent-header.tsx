import { MessageSquarePlus, MessagesSquare, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentSwitcher } from "./agent-switcher";
import { ActivityIndicator } from "./activity-indicator";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";

export function AgentHeader() {
  const {
    clearMessages,
    adaptiveEnabled,
    setAdaptiveEnabled,
    conversations,
    activeConversationId,
    newConversation,
  } = useQAStore();
  const [confirmClear, setConfirmClear] = useState(false);

  // 本会话已发的轮数(= 当前对话里的用户消息数)。对 session 化被测 agent(Gateway/Dex、
  // Platform)= 网关记得的连续轮数:同一对话共用一个 session,新建 / 清空会话即换新 session。
  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const turnCount = activeConv
    ? activeConv.messages.filter((m) => m.role === "user").length
    : 0;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3">
      <div className="flex min-w-0 items-center gap-2">
        <AgentSwitcher />
        <ActivityIndicator />
        {/* 会话状态:同一对话 = 同一 session(被测 agent 记得前 N 轮);新建/清空 = 新 session */}
        <Tooltip>
          <TooltipTrigger asChild>
            {turnCount > 0 ? (
              <span className="hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground @lg/chat:inline-flex">
                <MessagesSquare className="h-3 w-3" />
                同一会话 · {turnCount} 轮
              </span>
            ) : (
              <span className="hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border px-2 py-0.5 text-[10.5px] text-muted-foreground/70 @lg/chat:inline-flex">
                <MessagesSquare className="h-3 w-3" />
                新会话
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent>
            {turnCount > 0
              ? `同一 session：被测 agent 记得本会话前 ${turnCount} 轮上下文。点「新会话」或「清空会话」开新 session，记忆清零。`
              : "新 session：下一条消息起开始记忆。同一对话内连续多轮共用一个 session。"}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* 自适应追问开关:开 → 右侧多一个「自适应」tab(取代原「整段会话轨迹」) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={adaptiveEnabled ? "default" : "ghost"}
              size="sm"
              className={cn(
                "h-7 gap-1 px-2 text-[11px]",
                !adaptiveEnabled && "text-muted-foreground",
              )}
              onClick={() => setAdaptiveEnabled(!adaptiveEnabled)}
              aria-pressed={adaptiveEnabled}
              aria-label="自适应追问"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden @md/chat:inline">自适应追问</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            开启后,右侧「题目 · 打分 · 结果」会多出一个「自适应」tab,据 agent 回答继续追问
          </TooltipContent>
        </Tooltip>
        {/* 新会话:开一段全新对话(全新 session,记忆清零),当前对话保留在左侧列表 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={() => newConversation()}
              aria-label="新会话"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span className="hidden @md/chat:inline">新会话</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            开一段全新对话(全新 session,被测 agent 记忆清零);当前对话保留在左侧
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirmClear(true)}
              aria-label="清空会话"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>清空当前会话(消息清空 + 换新 session)</TooltipContent>
        </Tooltip>
      </div>

      <ConfirmDeleteDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="清空会话？"
        description="将清空当前会话的全部消息,并开启全新的服务端上下文(下次发送从空白开始);左侧会话名还原为「新对话」,右侧也会解绑当前题目。题库与历史评测记录不受影响。"
        confirmLabel="清空"
        onConfirm={clearMessages}
      />
    </header>
  );
}
