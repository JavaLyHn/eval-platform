/** 生成中排队发送(单槽)—— 纯类型 + 纯判定,供 store 的自动 flush effect 复用。 */

export type PendingSend = {
  /** 排队时绑定的会话 id:仅当回到该会话且其空闲时才自动发出。 */
  convId: string;
  /** 本轮正文(可为空 = 只发图)。 */
  prompt: string;
  /** 随本轮发出的图片(data URL)。 */
  images?: string[];
  /** 随本轮发出的文本文件附件。 */
  files?: import("./file-input").AttachedFile[];
  /** true = 上一轮 timeout/error 后保留、暂停自动发,等用户点击补发。 */
  held?: boolean;
};

export type FlushContext = {
  pendingSend: PendingSend | null;
  activeConversationId: string | null;
  isStreaming: boolean;
  streamingConvId: string | null;
  /** = pendingTurns?.convId ?? null,当前正跑多轮题的会话。 */
  pendingTurnsConvId: string | null;
};

/**
 * 现在是否应把排队消息自动发出。全部满足才 true:
 * 有排队 · 未 held · 正看着该会话 · 该会话既不在流式、也无多轮题在跑。
 */
export function shouldFlushPendingSend(ctx: FlushContext): boolean {
  const p = ctx.pendingSend;
  if (!p) return false;
  if (p.held) return false;
  if (ctx.activeConversationId !== p.convId) return false;
  if (ctx.isStreaming && ctx.streamingConvId === p.convId) return false;
  if (ctx.pendingTurnsConvId === p.convId) return false;
  return true;
}
