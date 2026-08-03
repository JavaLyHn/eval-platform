import { describe, expect, it } from "vitest";
import { prefixBeforeMessage } from "./conversation-fork";
import type { ChatMessage } from "@/types";

function msg(id: string): ChatMessage {
  return { id, role: "user", content: id, createdAt: "2026-06-03T00:00:00Z" };
}

describe("prefixBeforeMessage", () => {
  const list = [msg("a"), msg("b"), msg("c"), msg("d")];

  it("命中中间:返回该消息之前的全部", () => {
    expect(prefixBeforeMessage(list, "c").map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("命中首条:返回空数组", () => {
    expect(prefixBeforeMessage(list, "a")).toEqual([]);
  });

  it("命中末条:返回除末条外的全部", () => {
    expect(prefixBeforeMessage(list, "d").map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("找不到 id:原样返回全部(退化为末尾追加)", () => {
    expect(prefixBeforeMessage(list, "zzz").map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("空数组:返回空数组", () => {
    expect(prefixBeforeMessage([], "a")).toEqual([]);
  });
});
