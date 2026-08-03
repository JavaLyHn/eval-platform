import { describe, expect, it } from "vitest";
import { describeExt, langToExt } from "./file-types";

describe("langToExt", () => {
  it("语言映射到扩展名", () => {
    expect(langToExt("markdown")).toBe("md");
    expect(langToExt("javascript")).toBe("js");
    expect(langToExt("HTML")).toBe("html");
    expect(langToExt("")).toBe("txt");
    expect(langToExt("unknownlang")).toBe("unknownlang");
  });
});

describe("describeExt", () => {
  it("已知扩展名给出标签/MIME/图标", () => {
    expect(describeExt("index.html")).toMatchObject({ ext: "html", kind: "code", mime: "text/html", iconName: "code" });
    expect(describeExt("md")).toMatchObject({ ext: "md", kind: "markdown", label: "Markdown" });
    expect(describeExt("report.pdf")).toMatchObject({ ext: "pdf", kind: "pdf", mime: "application/pdf" });
    expect(describeExt("data.json")).toMatchObject({ ext: "json", kind: "data", mime: "application/json" });
  });
  it("已知代码语言扩展名 → code", () => {
    expect(describeExt("app.py")).toMatchObject({ kind: "code", iconName: "code" });
  });
  it("未知扩展名兜底 generic", () => {
    expect(describeExt("thing.xyz")).toMatchObject({ ext: "xyz", kind: "generic", iconName: "file" });
    expect(describeExt("thing.xyz").label).toContain("XYZ");
  });
});
