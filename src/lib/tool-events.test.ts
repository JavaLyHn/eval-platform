import { describe, expect, it } from "vitest";
import { summarizeToolEvents } from "./tool-events";
import type { TranscriptStep } from "@/types";

function tool(name: string, isError = false): TranscriptStep {
  return { role: "tool", content: "", toolName: name, isError };
}

describe("summarizeToolEvents", () => {
  it("按工具名去重 + 累计 calls/errors + 保持首次顺序", () => {
    const steps: TranscriptStep[] = [
      tool("send"),
      { role: "assistant", content: "文字" },
      tool("search", true),
      tool("send"),
      tool("search"),
    ];
    expect(summarizeToolEvents(steps)).toEqual([
      { name: "send", calls: 2, errors: 0 },
      { name: "search", calls: 2, errors: 1 },
    ]);
  });
  it("无工具步 → []", () => {
    expect(summarizeToolEvents([{ role: "assistant", content: "纯文本" }])).toEqual([]);
  });
  it("跳过没有 toolName 的 step", () => {
    expect(summarizeToolEvents([{ role: "tool", content: "" }])).toEqual([]);
  });
  it("空数组 → []", () => {
    expect(summarizeToolEvents([])).toEqual([]);
  });
  it("sample 取首次带 I/O 的调用,字符串原样 / 对象 JSON 串化,无 I/O 则省略", () => {
    const r = summarizeToolEvents([
      { role: "tool", content: "", toolName: "send_email", toolInput: "脱密串", output: undefined },
      { role: "tool", content: "", toolName: "send_email", toolInput: "第二次", output: "ok" },
      { role: "tool", content: "", toolName: "search", toolInput: { q: "x" } },
      { role: "tool", content: "", toolName: "noio" },
    ]);
    const email = r.find((t) => t.name === "send_email")!;
    expect(email.calls).toBe(2);
    expect(email.sample).toEqual({ input: "脱密串" }); // 首次,output 当时 undefined 故省略
    const search = r.find((t) => t.name === "search")!;
    expect(search.sample).toEqual({ input: '{"q":"x"}' });
    const noio = r.find((t) => t.name === "noio")!;
    expect(noio.sample).toBeUndefined();
  });
});
