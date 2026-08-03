import { describe, expect, it } from "vitest";
import { collectJudgeFileTexts } from "./judge-attachments";
import type { AgentTranscript } from "@/types";

const b64 = (s: string) => btoa(s);
const textFile = (filename: string, content: string) => ({
  filename,
  dataUri: `data:text/markdown;base64,${b64(content)}`,
});
const pdfFile = (filename: string) => ({
  filename,
  dataUri: `data:application/pdf;base64,${b64("%PDF-1.4")}`,
});
const tr = (files: { filename: string; dataUri: string }[]): AgentTranscript =>
  ({ source: "gateway", steps: [], files }) as unknown as AgentTranscript;

describe("collectJudgeFileTexts", () => {
  it("文本文件解码纳入;binary(pdf)排除", () => {
    const r = collectJudgeFileTexts([tr([textFile("a.md", "hello"), pdfFile("b.pdf")])]);
    expect(r.files).toEqual([{ filename: "a.md", text: "hello", truncated: false }]);
    expect(r.omittedCount).toBe(0);
  });

  it("单文件超 perFileCap → 截断 + truncated", () => {
    const long = "x".repeat(50);
    const r = collectJudgeFileTexts([tr([textFile("a.md", long)])], { perFileCap: 10, totalCap: 100 });
    expect(r.files[0].text).toBe("x".repeat(10));
    expect(r.files[0].truncated).toBe(true);
  });

  it("合计触 totalCap → 停 + omittedCount", () => {
    const r = collectJudgeFileTexts(
      [tr([textFile("a.md", "aaaa"), textFile("b.md", "bbbb"), textFile("c.md", "cccc")])],
      { perFileCap: 100, totalCap: 6 },
    );
    // a(4) 纳入,b 只剩 2 额度 → 截断纳入(总 6);c 无额度 → 省略
    expect(r.files.map((f) => f.filename)).toEqual(["a.md", "b.md"]);
    expect(r.files[1].text).toBe("bb");
    expect(r.files[1].truncated).toBe(true);
    expect(r.omittedCount).toBe(1);
  });

  it("跨多 transcript 按 (filename+text) 去重", () => {
    const t = textFile("same.md", "dup");
    const r = collectJudgeFileTexts([tr([t]), tr([t])]);
    expect(r.files.length).toBe(1);
  });

  it("空 / undefined / 无文本 → 空", () => {
    expect(collectJudgeFileTexts([])).toEqual({ files: [], omittedCount: 0 });
    expect(collectJudgeFileTexts([null, undefined])).toEqual({ files: [], omittedCount: 0 });
    expect(collectJudgeFileTexts([tr([pdfFile("b.pdf")])])).toEqual({ files: [], omittedCount: 0 });
  });
});
