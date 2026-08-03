import { describe, expect, it } from "vitest";
import { shouldFlushPendingSend, type FlushContext, type PendingSend } from "./pending-send";

const P: PendingSend = { convId: "c1", prompt: "hi" };

/** 基线:待发送属 c1、正看 c1、c1 空闲(不流式、无多轮题)→ 应发。 */
const base: FlushContext = {
  pendingSend: P,
  activeConversationId: "c1",
  isStreaming: false,
  streamingConvId: null,
  pendingTurnsConvId: null,
};

describe("shouldFlushPendingSend", () => {
  it("空闲且在同一会话 → true", () => {
    expect(shouldFlushPendingSend(base)).toBe(true);
  });

  it("无待发送 → false", () => {
    expect(shouldFlushPendingSend({ ...base, pendingSend: null })).toBe(false);
  });

  it("held(报错保留)→ false", () => {
    expect(
      shouldFlushPendingSend({ ...base, pendingSend: { ...P, held: true } }),
    ).toBe(false);
  });

  it("用户切到别的会话 → false(挂起)", () => {
    expect(shouldFlushPendingSend({ ...base, activeConversationId: "c2" })).toBe(
      false,
    );
  });

  it("该会话仍在流式 → false", () => {
    expect(
      shouldFlushPendingSend({ ...base, isStreaming: true, streamingConvId: "c1" }),
    ).toBe(false);
  });

  it("流式的是别的会话 → true(不阻塞本会话发送)", () => {
    expect(
      shouldFlushPendingSend({ ...base, isStreaming: true, streamingConvId: "c2" }),
    ).toBe(true);
  });

  it("该会话有多轮题在跑 → false(等多轮题跑完)", () => {
    expect(
      shouldFlushPendingSend({ ...base, pendingTurnsConvId: "c1" }),
    ).toBe(false);
  });

  it("别的会话有多轮题在跑 → true", () => {
    expect(
      shouldFlushPendingSend({ ...base, pendingTurnsConvId: "c2" }),
    ).toBe(true);
  });
});
