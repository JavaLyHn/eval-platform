import { describe, expect, it } from "vitest";
import { dataUriToFile, transcriptOutputFiles } from "./transcript-output-files";
import type { AgentTranscript } from "@/types";

/** UTF-8 字符串 → base64 data URI(测试构造,含中文验证解码)。 */
function b64DataUri(mime: string, text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(bin)}`;
}

describe("dataUriToFile", () => {
  it("md(含中文)→ 解码为 text", () => {
    const f = dataUriToFile("readme.md", b64DataUri("text/markdown", "# 你好\n世界"));
    expect(f.filename).toBe("readme.md");
    expect(f.text).toBe("# 你好\n世界");
    expect(f.url).toBeUndefined();
  });
  it("csv / json → text", () => {
    expect(dataUriToFile("a.csv", b64DataUri("text/csv", "a,b")).text).toBe("a,b");
    expect(dataUriToFile("a.json", b64DataUri("application/json", "{}")).text).toBe("{}");
  });
  it("pdf → 二进制 url=dataUri", () => {
    const du = "data:application/pdf;base64,JVBERi0=";
    const f = dataUriToFile("doc.pdf", du);
    expect(f.url).toBe(du);
    expect(f.text).toBeUndefined();
  });
  it("未知扩展名 → 二进制", () => {
    const du = "data:application/octet-stream;base64,AAAA";
    expect(dataUriToFile("blob.bin", du).url).toBe(du);
  });
  it("坏 base64(文本类)→ 退回二进制 url", () => {
    const du = "data:text/markdown;base64,@@@@";
    const f = dataUriToFile("x.md", du);
    expect(f.url).toBe(du);
    expect(f.text).toBeUndefined();
  });
});

describe("transcriptOutputFiles", () => {
  const mk = (files?: unknown): AgentTranscript =>
    ({ source: "gateway", sessionId: "s", fetchedAt: "t", steps: [], files }) as AgentTranscript;
  it("映射 files → PreviewFile[]", () => {
    const t = mk([{ filename: "a.md", dataUri: b64DataUri("text/markdown", "hi") }]);
    const out = transcriptOutputFiles(t);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("hi");
  });
  it("无 files / undefined / null / 空 → []", () => {
    expect(transcriptOutputFiles(mk(undefined))).toEqual([]);
    expect(transcriptOutputFiles(null)).toEqual([]);
    expect(transcriptOutputFiles(mk([]))).toEqual([]);
  });
  it("过滤非 data: 项", () => {
    expect(transcriptOutputFiles(mk([{ filename: "a", dataUri: "https://x/a.md" }]))).toEqual([]);
  });
});
