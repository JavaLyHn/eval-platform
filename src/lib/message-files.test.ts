import { describe, expect, it } from "vitest";
import { fileNameHint, isFileLikeCodeBlock, fileNameForCodeBlock } from "./message-files";

const long = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");

describe("fileNameHint", () => {
  it("从信息串取文件名", () => {
    expect(fileNameHint("index.html")).toBe("index.html");
    expect(fileNameHint("path/to/app.py")).toBe("app.py");
    expect(fileNameHint("")).toBeNull();
    expect(fileNameHint(undefined)).toBeNull();
    expect(fileNameHint("nofilename")).toBeNull();
  });
});

describe("isFileLikeCodeBlock", () => {
  it("有文件名提示 → true", () => {
    expect(isFileLikeCodeBlock("", "x", "a.html")).toBe(true);
  });
  it("文档/代码类语言 且够长 → true", () => {
    expect(isFileLikeCodeBlock("html", long)).toBe(true);
    expect(isFileLikeCodeBlock("json", "x".repeat(500))).toBe(true);
  });
  it("短片段 / 非文档语言 → false", () => {
    expect(isFileLikeCodeBlock("html", "hi")).toBe(false);
    expect(isFileLikeCodeBlock("", long)).toBe(false);
  });
});

describe("fileNameForCodeBlock", () => {
  it("优先信息串,否则兜底带序号与扩展名", () => {
    expect(fileNameForCodeBlock("html", "index.html", 0)).toBe("index.html");
    expect(fileNameForCodeBlock("markdown", undefined, 2)).toBe("文件-3.md");
    expect(fileNameForCodeBlock("python", "", 0)).toBe("文件-1.py");
  });
});
