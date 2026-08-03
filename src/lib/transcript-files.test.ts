import { describe, expect, it } from "vitest";
import { extractTranscriptFiles } from "./transcript-files";

const t = (steps: unknown[]) => ({ source: "x", steps } as never);

describe("extractTranscriptFiles", () => {
  it("挑出非图片文件 URL,排除图片", () => {
    const out = extractTranscriptFiles(
      t([{ output: { url: "https://x/report.pdf" } }, { output: "https://x/a.png" }]),
    );
    expect(out.map((f) => f.url)).toEqual(["https://x/report.pdf"]);
    expect(out[0]).toMatchObject({ filename: "report.pdf", ext: "pdf" });
  });
  it("解析 JSON 字符串出参", () => {
    const out = extractTranscriptFiles(t([{ output: '{"file":"https://x/data.csv"}' }]));
    expect(out.map((f) => f.ext)).toEqual(["csv"]);
  });
  it("去重", () => {
    const out = extractTranscriptFiles(
      t([{ output: "https://x/a.md" }, { toolInput: "https://x/a.md" }]),
    );
    expect(out).toHaveLength(1);
  });
  it("无轨迹 → 空", () => {
    expect(extractTranscriptFiles(null)).toEqual([]);
  });
});
