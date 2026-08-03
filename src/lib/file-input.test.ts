import { describe, expect, it } from "vitest";
import { isAcceptedTextFile, inlineAttachments, type AttachedFile } from "./file-input";

const fake = (name: string, type = "") => ({ name, type, size: 10 }) as unknown as File;

describe("isAcceptedTextFile", () => {
  it("文本类扩展名接受", () => {
    expect(isAcceptedTextFile(fake("a.md"))).toBe(true);
    expect(isAcceptedTextFile(fake("a.json"))).toBe(true);
    expect(isAcceptedTextFile(fake("a.html"))).toBe(true);
  });
  it("图片 / 未知二进制拒绝", () => {
    expect(isAcceptedTextFile(fake("a.png", "image/png"))).toBe(false);
    expect(isAcceptedTextFile(fake("a.exe"))).toBe(false);
  });
  it("MIME 兜底(text/* 或 json)", () => {
    expect(isAcceptedTextFile(fake("weird", "text/plain"))).toBe(true);
  });
});

describe("inlineAttachments", () => {
  it("拼成带文件名的围栏文本", () => {
    const files: AttachedFile[] = [{ name: "a.html", ext: "html", mime: "text/html", size: 3, text: "<h1>" }];
    const s = inlineAttachments(files);
    expect(s).toContain("【附件 a.html】");
    expect(s).toContain("```html");
    expect(s).toContain("<h1>");
  });
  it("空数组 → 空串", () => {
    expect(inlineAttachments([])).toBe("");
  });
});
