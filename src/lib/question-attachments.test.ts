import { describe, expect, it } from "vitest";
import { attachmentsToSendPayload } from "./question-attachments";
import type { Attachment } from "@/types";

const img = (over: Partial<Attachment> = {}): Attachment => ({
  id: "i", name: "shot.png", size: 100, type: "image/png",
  dataUrl: "data:image/png;base64,AAAA", ...over,
});
const txt = (over: Partial<Attachment> = {}): Attachment => ({
  id: "t", name: "brief.md", size: 20, type: "text/markdown",
  text: "# 需求\n做一份分析", ...over,
});

describe("attachmentsToSendPayload", () => {
  it("图片(有 dataUrl)→ images", () => {
    const r = attachmentsToSendPayload([img()]);
    expect(r.images).toEqual(["data:image/png;base64,AAAA"]);
    expect(r.files).toEqual([]);
  });

  it("文本(有 text)→ AttachedFile(ext 从文件名推)", () => {
    const r = attachmentsToSendPayload([txt()]);
    expect(r.images).toEqual([]);
    expect(r.files).toEqual([
      { name: "brief.md", ext: "md", mime: "text/markdown", size: 20, text: "# 需求\n做一份分析" },
    ]);
  });

  it("既无 text 又无 dataUrl(如 pdf 元信息)→ 忽略", () => {
    const r = attachmentsToSendPayload([{ id: "p", name: "a.pdf", size: 9, type: "application/pdf" }]);
    expect(r).toEqual({ files: [], images: [] });
  });

  it("图片没有 dataUrl → 不进 images", () => {
    const r = attachmentsToSendPayload([img({ dataUrl: undefined })]);
    expect(r.images).toEqual([]);
  });

  it("混合保持各自顺序;空/undefined → 空", () => {
    const r = attachmentsToSendPayload([img(), txt()]);
    expect(r.images.length).toBe(1);
    expect(r.files.length).toBe(1);
    expect(attachmentsToSendPayload()).toEqual({ files: [], images: [] });
    expect(attachmentsToSendPayload([])).toEqual({ files: [], images: [] });
  });

  it("无扩展名文件名 → ext 回退 txt", () => {
    const r = attachmentsToSendPayload([txt({ name: "brief", text: "x" })]);
    expect(r.files[0].ext).toBe("txt");
  });
});
