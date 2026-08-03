import { MessageSquare, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";
import { AgentAvatar } from "./agent-avatar";

interface ConversationSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Bucket label shown on the right side of each row. */
function bucketLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.floor(
    (startOfDay(now) - startOfDay(d)) / 86_400_000,
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Past week";
  if (diffDays < 30) return `${diffDays} days ago`;
  return d.toISOString().slice(0, 10);
}

/**
 * Claude.ai-style command palette for conversations: full-screen dim overlay,
 * centered card with search input on top and a keyboard-navigable list below.
 */
export function ConversationSearchDialog({
  open,
  onOpenChange,
}: ConversationSearchDialogProps) {
  const { conversations, switchConversation } = useQAStore();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Sort by most-recently-updated and filter by query.
  const items: Conversation[] = useMemo(() => {
    // 按真实时刻倒序(不能用字符串比较:本地 UTC 与服务端 +08:00 混排会乱序)。
    const sorted = [...conversations].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Focus the input on the next tick — Radix Dialog steals focus on mount.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp active index when the filtered list shrinks.
  useEffect(() => {
    setActiveIdx((i) => Math.min(Math.max(0, i), Math.max(0, items.length - 1)));
  }, [items.length]);

  // Scroll the active row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const pick = (id: string) => {
    switchConversation(id);
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 输入法组字中(选中文候选词)按 Enter 是选词,别当成「打开选中结果」。
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const item = items[activeIdx];
      if (item) {
        e.preventDefault();
        pick(item.id);
      }
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[18%] z-50 w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onKeyDown={onKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">搜索对话</DialogPrimitive.Title>

          {/* Search row */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索对话…"
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="关闭"
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Results */}
          <ul
            ref={listRef}
            className="max-h-[60vh] overflow-y-auto py-1"
            role="listbox"
            aria-label="对话搜索结果"
          >
            {items.length === 0 ? (
              <li className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
                {query ? "没有匹配的对话" : "暂无对话"}
              </li>
            ) : (
              items.map((c, i) => {
                const active = i === activeIdx;
                const agentId = [...c.messages]
                  .reverse()
                  .find((m) => m.agentProfileId)?.agentProfileId;
                return (
                  <li key={c.id} data-idx={i}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => pick(c.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors",
                        active
                          ? "bg-secondary text-foreground"
                          : "text-foreground/85 hover:bg-secondary/50",
                      )}
                    >
                      {agentId ? (
                        <AgentAvatar profileId={agentId} size={20} className="shrink-0" />
                      ) : (
                        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                        {bucketLabel(c.updatedAt)}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {/* Hint footer */}
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <Kbd>↑↓</Kbd> 选择
              <Kbd>Enter</Kbd> 打开
              <Kbd>Esc</Kbd> 关闭
            </span>
            <span>{items.length} 条</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 items-center rounded border border-border bg-background px-1 font-mono text-[10px] tabular-nums text-foreground">
      {children}
    </kbd>
  );
}
