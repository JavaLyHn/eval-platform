import { describe, expect, it } from "vitest";
import { previewMode, dataUriToBlob } from "./file-preview";

describe("previewMode", () => {
  it("html/htm → html", () => {
    expect(previewMode("a.html")).toBe("html");
    expect(previewMode("a.htm")).toBe("html");
  });
  it("md/markdown → markdown", () => {
    expect(previewMode("README.md")).toBe("markdown");
    expect(previewMode("x.markdown")).toBe("markdown");
  });
  it("其它 / 无扩展名 → source", () => {
    expect(previewMode("data.json")).toBe("source");
    expect(previewMode("a.py")).toBe("source");
    expect(previewMode("noext")).toBe("source");
  });
});

describe("dataUriToBlob", () => {
  it("base64 data URI → Blob(mime + 非空)", async () => {
    // "hello" 的 base64 = aGVsbG8=
    const blob = dataUriToBlob("data:application/pdf;base64,aGVsbG8=");
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe("application/pdf");
    expect(blob!.size).toBe(5);
    expect(await blob!.text()).toBe("hello");
  });
  it("非 base64 data URI(urlencoded)→ Blob", async () => {
    const blob = dataUriToBlob("data:text/plain,hi%20there");
    expect(blob).not.toBeNull();
    expect(await blob!.text()).toBe("hi there");
  });
  it("非 data: URI → null", () => {
    expect(dataUriToBlob("https://x/a.pdf")).toBeNull();
    expect(dataUriToBlob("not a uri")).toBeNull();
  });
  it("坏 base64 → null(不抛)", () => {
    expect(dataUriToBlob("data:application/pdf;base64,@@@@")).toBeNull();
  });
});
