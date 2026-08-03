import { describe, expect, it } from "vitest";
import { isAcceptedImportFile, parseImportSources } from "./import-file";

describe("isAcceptedImportFile", () => {
  it("接受 xlsx/xls/csv/json(大小写不敏感)", () => {
    for (const n of ["a.xlsx", "b.XLS", "c.csv", "d.JSON", "e.Xlsx"]) {
      expect(isAcceptedImportFile(n)).toBe(true);
    }
  });
  it("拒绝其它扩展名 / 无扩展名", () => {
    for (const n of ["a.txt", "b.pdf", "c", "d.docx", "e.json.bak", ""]) {
      expect(isAcceptedImportFile(n)).toBe(false);
    }
  });
});

describe("parseImportSources rawRecords", () => {
  const file = (name: string, text: string) =>
    new File([text], name, { type: "text/plain" });

  it("csv 源:rawRecords 与 parsed 对齐、含原始全列", async () => {
    const csv = ["用例标题,测试数据,前置要求", "标题A,帮我做X,分两轮"].join("\n");
    const { sources } = await parseImportSources([file("cases.csv", csv)]);
    const s = sources[0];
    expect(s.parsed).toHaveLength(1);
    expect(s.rawRecords).toHaveLength(1);
    expect(s.rawRecords[0]["前置要求"]).toBe("分两轮");
  });

  it("json 源:rawRecords 由 questionToRawRecord 兜底、与 parsed 对齐", async () => {
    const json = JSON.stringify([{ title: "t", prompt: "p", passForm: "成功" }]);
    const { sources } = await parseImportSources([file("q.json", json)]);
    const s = sources[0];
    expect(s.parsed).toHaveLength(1);
    expect(s.rawRecords).toHaveLength(1);
    expect(s.rawRecords[0]["title"]).toBe("t");
    expect(s.rawRecords[0]["passForm"]).toBe("成功");
  });
});
