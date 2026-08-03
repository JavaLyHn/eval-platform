import { useState } from "react";
import { ChatColumn } from "./chat-column";
import { ChatSidebar } from "./chat-sidebar";

const STORAGE_KEY = "eval-platform:sidebar-collapsed";

export function AgentPanel() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  });

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // 左侧会话栏宽度**固定**(展开 w-64 / 折叠 w-12,均写死在 ChatSidebar 内部、shrink-0):
  // 不随右侧评分面板出现与否(新会话 vs 评测)而变,也不再提供拖拽手柄 ——
  // 唯一能改变它宽度的就是「折叠」开关。聊天区 flex-1 吃掉剩余宽度。
  return (
    <section
      className="flex h-full min-h-0 border-r border-border bg-background"
      aria-label="Agent 对话区"
    >
      <ChatSidebar collapsed={collapsed} onToggleCollapse={toggle} />
      <ChatColumn />
    </section>
  );
}
