import { AgentFooter } from "./agent-footer";
import { AgentHeader } from "./agent-header";
import { MessageList } from "./message-list";

/**
 * 聊天列:头部 + 消息流 + 输入框。桌面 AgentPanel 与手机外壳共用。
 * 保留 `@container/chat` 让内部容器查询继续生效。
 */
export function ChatColumn() {
  return (
    <div className="@container/chat flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <AgentHeader />
      <MessageList />
      <AgentFooter />
    </div>
  );
}
