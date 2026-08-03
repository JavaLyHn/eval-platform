import { describe, expect, it } from "vitest";
import { extractTranscriptImages } from "./transcript-images";
import type { AgentTranscript } from "@/types";

const tx = (steps: AgentTranscript["steps"]): AgentTranscript => ({
  source: "platform",
  sessionId: "s",
  fetchedAt: "f",
  steps,
});

describe("extractTranscriptImages", () => {
  it("无轨迹 / 空步骤 → []", () => {
    expect(extractTranscriptImages(null)).toEqual([]);
    expect(extractTranscriptImages(tx([]))).toEqual([]);
  });

  it("扩展名图片 URL(任意键)→ 抽出", () => {
    const out = extractTranscriptImages(
      tx([{ role: "tool", content: "", toolName: "panel_show", output: { note: "https://cdn.x/cloud.png" } }]),
    );
    expect(out).toEqual(["https://cdn.x/cloud.png"]);
  });

  it("无扩展名但键名暗示图片/文件 → 抽出;普通键的非图 URL → 跳过", () => {
    const out = extractTranscriptImages(
      tx([
        {
          role: "tool",
          content: "",
          toolName: "preview_file",
          output: { fileUrl: "https://platform.x/api/file/abc123", link: "https://platform.x/page" },
        },
      ]),
    );
    expect(out).toEqual(["https://platform.x/api/file/abc123"]);
  });

  it("preview_file 的 output 直接是裸 URL(用工具名当线索)→ 抽出", () => {
    const out = extractTranscriptImages(
      tx([{ role: "tool", content: "", toolName: "preview_file", output: "https://platform.x/f/xyz" }]),
    );
    expect(out).toEqual(["https://platform.x/f/xyz"]);
  });

  it("data:image 一律抽出 + 去重", () => {
    const data = "data:image/png;base64,AAAA";
    const out = extractTranscriptImages(
      tx([
        { role: "tool", content: "", toolName: "panel_show", output: { img: data } },
        { role: "tool", content: "", toolName: "panel_show", output: { again: data } },
      ]),
    );
    expect(out).toEqual([data]);
  });

  it("preview_file 真实形状:toolInput.url + output 是 JSON 字符串 → 抽出(去重)", () => {
    const url =
      "https://example-bucket.s3.amazonaws.com/agent-images/1781664444822_x_cloud_image.png";
    const out = extractTranscriptImages(
      tx([
        {
          role: "tool",
          content: "",
          toolName: "preview_file",
          toolInput: { url },
          output: JSON.stringify({ fileName: "cloud_image.png", fileType: "image/png", url }),
        },
      ]),
    );
    expect(out).toEqual([url]);
  });

  it("非 URL 字符串不误抽", () => {
    const out = extractTranscriptImages(
      tx([{ role: "tool", content: "", toolName: "preview_file", output: { url: "not-a-url" } }]),
    );
    expect(out).toEqual([]);
  });

  it("非图片文件(键名像 file/media 也不误抽)→ 跳过,交给文件卡", () => {
    const out = extractTranscriptImages(
      tx([
        { role: "tool", content: "", toolName: "preview_file", output: { file: "https://x/README.md" } },
        { role: "tool", content: "", toolName: "preview_file", output: { media: "https://x/report.pdf" } },
      ]),
    );
    expect(out).toEqual([]);
  });
});
