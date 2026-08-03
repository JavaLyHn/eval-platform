import { describe, it, expect } from "vitest";
import { groupSkillFiles, fileTypeTag } from "./agent-repo-files";

describe("groupSkillFiles", () => {
  it("按首段分组,剔除根 SKILL.md", () => {
    const g = groupSkillFiles([
      "SKILL.md",
      "references/a.md",
      "scripts/x.py",
      "scripts/y.py",
      "data/c.json",
      "templates/t.hbs",
    ]);
    expect(g).toEqual({
      references: ["references/a.md"],
      scripts: ["scripts/x.py", "scripts/y.py"],
      data: ["data/c.json"],
      templates: ["templates/t.hbs"],
    });
  });
  it("根级非 SKILL.md 文件 → 其它组", () => {
    expect(groupSkillFiles(["SKILL.md", "NOTES.md"])).toEqual({ 其它: ["NOTES.md"] });
  });
  it("只有 SKILL.md / 空 → 空分组", () => {
    expect(groupSkillFiles(["SKILL.md"])).toEqual({});
    expect(groupSkillFiles([])).toEqual({});
  });
  it("深层路径按首段分组", () => {
    expect(groupSkillFiles(["scripts/sub/x.py"])).toEqual({ scripts: ["scripts/sub/x.py"] });
  });
});

describe("fileTypeTag", () => {
  it("按扩展给 label", () => {
    expect(fileTypeTag("references/a.md").label).toBe("MD");
    expect(fileTypeTag("scripts/run.py").label).toBe("PY");
    expect(fileTypeTag("data/c.json").label).toBe("JSON");
    expect(fileTypeTag("data/m.csv").label).toBe("CSV");
    expect(fileTypeTag("templates/t.hbs").label).toBe("HBS");
    expect(fileTypeTag("x.sh").label).toBe("SH");
    expect(fileTypeTag("a.yaml").label).toBe("YAML");
    expect(fileTypeTag("a.yml").label).toBe("YAML");
    expect(fileTypeTag("a.js").label).toBe("JS");
    expect(fileTypeTag("a.mjs").label).toBe("JS");
  });
  it("大小写不敏感", () => {
    expect(fileTypeTag("RUN.PY").label).toBe("PY");
    expect(fileTypeTag("A.MD").label).toBe("MD");
  });
  it("无后缀 / 未知 → FILE", () => {
    expect(fileTypeTag("Makefile").label).toBe("FILE");
    expect(fileTypeTag("a.bin").label).toBe("FILE");
  });
  it("cls 含 Tailwind 配色类(非空)", () => {
    expect(fileTypeTag("a.py").cls).toMatch(/emerald|green/);
    expect(fileTypeTag("a.md").cls).toMatch(/blue/);
    expect(fileTypeTag("Makefile").cls).toMatch(/muted/);
  });
  it("目录名带点不误判 / 隐藏文件 → FILE", () => {
    expect(fileTypeTag("a.dir/file").label).toBe("FILE");   // 点在目录名,文件无后缀
    expect(fileTypeTag(".gitignore").label).toBe("FILE");   // 隐藏文件(leading dot)
    expect(fileTypeTag("scripts/run.py").label).toBe("PY"); // 正常带目录的仍正确
  });
});
