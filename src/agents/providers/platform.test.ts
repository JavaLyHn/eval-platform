import { describe, it, expect, vi } from "vitest";
import { consumePlatformSSE } from "./platform";

function streamOf(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

describe("consumePlatformSSE", () => {
  it("把 start/stage/delta/done 分发到对应回调", async () => {
    const onStart = vi.fn();
    const onStage = vi.fn();
    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const transcript = { source: "platform", sessionId: "s1", fetchedAt: "t", steps: [] };
    const body = streamOf([
      sse({ event: "start", sessionId: "op|s1" }),
      sse({ event: "stage", stage: "调用工具: search" }),
      sse({ delta: "最终答案" }),
      sse({ done: true, sessionId: "op|s1", durationMs: 1200, interrupted: false, transcript }),
    ]);

    await consumePlatformSSE(body, { onStart, onStage, onDelta, onDone, onError });

    expect(onStart).toHaveBeenCalledWith("op|s1");
    expect(onStage).toHaveBeenCalledWith("调用工具: search");
    expect(onDelta).toHaveBeenCalledWith("最终答案");
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ durationMs: 1200, interrupted: false, transcript });
  });

  it("error 帧 → onError", async () => {
    const onError = vi.fn();
    const body = streamOf([sse({ error: "platform 鉴权失败" })]);
    await consumePlatformSSE(body, {
      onStart: vi.fn(), onStage: vi.fn(), onDelta: vi.fn(), onDone: vi.fn(), onError,
    });
    expect(onError).toHaveBeenCalledWith("platform 鉴权失败");
  });

  it("跨 chunk 切断的帧也能拼回", async () => {
    const onDelta = vi.fn();
    const body = streamOf(['data: {"delta":"半', '段"}\n\n']);
    await consumePlatformSSE(body, {
      onStart: vi.fn(), onStage: vi.fn(), onDelta, onDone: vi.fn(), onError: vi.fn(),
    });
    expect(onDelta).toHaveBeenCalledWith("半段");
  });

  it("CRLF(\\r\\n\\r\\n)分隔的帧也能解析(sse-starlette 用 CRLF)", async () => {
    const onDelta = vi.fn();
    const onDone = vi.fn();
    const body = streamOf([
      'data: {"event":"start","sessionId":"op|s"}\r\n\r\n',
      'data: {"delta":"答案"}\r\n\r\n',
      'data: {"done":true,"durationMs":1,"interrupted":false}\r\n\r\n',
    ]);
    await consumePlatformSSE(body, {
      onStart: vi.fn(), onStage: vi.fn(), onDelta, onDone, onError: vi.fn(),
    });
    expect(onDelta).toHaveBeenCalledWith("答案");
    expect(onDone).toHaveBeenCalled();
  });
});
