import { describe, it, expect } from "vitest";
import { isConvStreaming, anyStreaming, isConvBusy, type ConvRun } from "./conv-run";

const run = (activity: ConvRun["activity"]): ConvRun => ({ activity, startedAt: 1, stage: null });

describe("conv-run 按会话忙碌判定", () => {
  it("isConvStreaming:有非 idle 条目才算流式", () => {
    const runs = new Map([["a", run("streaming")], ["b", run("thinking")]]);
    expect(isConvStreaming(runs, "a")).toBe(true);
    expect(isConvStreaming(runs, "b")).toBe(true);
    expect(isConvStreaming(runs, "c")).toBe(false);
    expect(isConvStreaming(runs, null)).toBe(false);
    expect(isConvStreaming(new Map([["a", run("idle")]]), "a")).toBe(false);
  });

  it("anyStreaming:任一会话在跑", () => {
    expect(anyStreaming(new Map())).toBe(false);
    expect(anyStreaming(new Map([["a", run("streaming")]]))).toBe(true);
  });

  it("isConvBusy:流式或有 pendingTurns", () => {
    const runs = new Map([["a", run("streaming")]]);
    const pt = new Map<string, unknown>([["b", {}]]);
    expect(isConvBusy(runs, pt, "a")).toBe(true);  // 流式
    expect(isConvBusy(runs, pt, "b")).toBe(true);  // 有续发
    expect(isConvBusy(runs, pt, "c")).toBe(false); // 都没有
    expect(isConvBusy(new Map(), new Map(), "a")).toBe(false);
  });
});
