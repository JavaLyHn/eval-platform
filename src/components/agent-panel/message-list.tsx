import { ArrowDown, ListChecks, MessageSquareText, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./message-bubble";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQAStore } from "@/hooks/use-qa-store";

export function MessageList() {
  const {
    messages,
    isStreamingHere,
    isQuestionInProgressHere,
    stopGeneration,
    pendingSend,
    cancelPendingSend,
    flushPendingSend,
    activeConversationId,
  } = useQAStore();
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastSig = useRef("");
  // 是否「贴底」:用户在最新处 → 新消息自动跟随;划上去了 → 不动、显示「回到最新」pill。
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true); // 供 messages effect 读最新值,不必把 atBottom 入依赖
  const setPinned = (v: boolean) => {
    atBottomRef.current = v;
    setAtBottom(v);
  };
  const empty = messages.length === 0;

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = viewportRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // 「直接开聊」= 聚焦下方输入框(id 在 agent-footer.tsx);不跳布局、不闪烁。
  const focusComposer = () =>
    (document.getElementById("agent-composer") as HTMLInputElement | null)?.focus();

  // 监听滚动:实时判断是否贴底(距底 < 80px 视为贴底)。empty→非空时 Viewport 才挂载,
  // 故把 empty 入依赖,首条消息出现后重新绑定监听。
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () =>
      setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty, activeConversationId]);

  // 切换会话:直达最新、复位为贴底(进入一段会话看到的是最新回复)。
  useEffect(() => {
    setPinned(true);
    lastSig.current = "";
    requestAnimationFrame(() => scrollToBottom("auto"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  // 新消息 / 流式增量:**只有贴底时**才自动滚到底;用户划上去了就不动(靠 pill 提示)。
  useEffect(() => {
    const last = messages[messages.length - 1];
    const sig = `${messages.length}:${last?.content.length ?? 0}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    if (atBottomRef.current) scrollToBottom("smooth");
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
        {/* brand mark —— 与左侧栏一致,空会话也有点生气 */}
        <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-accent to-foreground text-background shadow-sm">
          <Sparkles className="h-7 w-7 animate-twinkle" />
          <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
        </div>

        <div className="space-y-1.5">
          <p className="text-[15px] font-semibold text-foreground">开始一段新评测</p>
          <p className="mx-auto max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
            在下方输入框直接和 Agent 对话就能开始 —— 想用题库里的题,就去「题库」挑题作答。
          </p>
        </div>

        {/* 两条上手路径(可点):直接开聊 = 聚焦输入框;从题库作答 = 去题库 */}
        <div className="flex w-full max-w-sm flex-col gap-2 text-left">
          <button
            type="button"
            onClick={focusComposer}
            className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-foreground">直接开聊</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                在下方输入框直接提问,自由对话会作为「临时题」一并计入评分。
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate("/library")}
            className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-foreground">从题库作答</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                打开「题库」选题,点「去首页答题」带回这里作答。
              </p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  const showStop = isStreamingHere || isQuestionInProgressHere;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollArea viewportRef={viewportRef} className="min-w-0 flex-1">
        <div className="min-w-0 space-y-3 p-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {pendingSend && pendingSend.convId === activeConversationId && (
            <div className="flex justify-end">
              <div className="group relative max-w-[85%] rounded-2xl border border-dashed border-border bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground">
                {pendingSend.images && pendingSend.images.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {pendingSend.images.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt={`待发送附图 ${i + 1}`}
                        className="h-12 w-12 rounded-md border border-border object-cover opacity-70"
                      />
                    ))}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">
                  {pendingSend.prompt || "[图片]"}
                </div>
                <div className="mt-1 flex items-center justify-end gap-2 text-[11px]">
                  {pendingSend.held ? (
                    <button
                      type="button"
                      onClick={flushPendingSend}
                      className="rounded px-1 font-medium text-accent hover:underline"
                    >
                      已暂停(上一轮未成功)· 点击发送
                    </button>
                  ) : (
                    <span className="text-muted-foreground/80">
                      待发送 · 上一轮结束后自动发出
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={cancelPendingSend}
                    aria-label="取消待发送"
                    className="inline-flex items-center gap-0.5 rounded px-1 hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                    取消
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="h-1" />
        </div>
      </ScrollArea>

      {/* 底部悬浮:上「回到最新消息」(仅划上去时)/ 下「停止生成」(仅生成中);两者可同时出现 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center gap-2">
        {!atBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[12px] text-foreground shadow-md backdrop-blur transition-colors hover:bg-secondary"
          >
            <ArrowDown className="h-3.5 w-3.5 text-accent" />
            回到最新消息
          </button>
        )}
        {showStop && (
          <Button
            variant="outline"
            size="sm"
            onClick={stopGeneration}
            className="pointer-events-auto h-8 gap-1.5 rounded-full border-border bg-card px-3 text-[12px] shadow-md backdrop-blur hover:bg-secondary"
          >
            <Square className="h-3 w-3 fill-current" />
            停止生成
          </Button>
        )}
      </div>
    </div>
  );
}
