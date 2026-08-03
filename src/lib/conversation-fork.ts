import type { ChatMessage } from "@/types";

/**
 * 返回 id 所在消息**之前**的消息(用于「编辑并重发 = 从该点分叉重生」:
 * 删掉该消息及其之后的所有消息,再从这条重新发)。
 * 找不到 id 时**原样返回全部** —— 调用方据此退化为「在末尾追加新一轮」,不崩。
 */
export function prefixBeforeMessage(
  messages: ChatMessage[],
  id: string,
): ChatMessage[] {
  const idx = messages.findIndex((m) => m.id === id);
  return idx >= 0 ? messages.slice(0, idx) : messages;
}
