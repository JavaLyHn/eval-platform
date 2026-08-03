import { describe, it, expect, vi, afterEach } from "vitest";
import { runSkillOpt, type SkillOptFrame } from "./skillopt-client";

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("runSkillOpt", () => {
  it("解析 start/log/done 帧并按序回调", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      'data: {"type":"start","outDir":"outputs/run_x","mock":true}\n\n',
      'data: {"type":"log","line":"hello"}\n\n',
      'data: {"type":"done","exitCode":0,"bestSkill":"# Skill","summary":{}}\n\n',
    ])));
    const frames: SkillOptFrame[] = [];
    await runSkillOpt({ mock: true }, { onFrame: (f) => frames.push(f) });
    expect(frames.map((f) => f.type)).toEqual(["start", "log", "done"]);
    const done = frames.find((f) => f.type === "done");
    expect(done && done.type === "done" && done.bestSkill).toBe("# Skill");
  });

  it("跨 chunk 切分的帧也能拼回", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      'data: {"type":"lo', 'g","line":"split"}\n\n',
    ])));
    const frames: SkillOptFrame[] = [];
    await runSkillOpt({ mock: true }, { onFrame: (f) => frames.push(f) });
    expect(frames).toEqual([{ type: "log", line: "split" }]);
  });

  it("非 2xx 抛错", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(runSkillOpt({ mock: true }, { onFrame: () => {} })).rejects.toThrow(/skillopt 500/);
  });
});
