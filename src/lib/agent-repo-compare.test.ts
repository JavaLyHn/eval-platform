import { describe, it, expect } from "vitest";
import { repoEmpToStandardId, reconcileSkills, reconcileSummary } from "./agent-repo-compare";

describe("repoEmpToStandardId", () => {
  it("映射已知员工", () => {
    expect(repoEmpToStandardId("aria")).toBe("aria");
    expect(repoEmpToStandardId("sam-user")).toBe("sam");
    expect(repoEmpToStandardId("dex")).toBe("dex");
  });
  it("无平台对应 → null", () => {
    expect(repoEmpToStandardId("duncan")).toBeNull();
    expect(repoEmpToStandardId("sam-customer")).toBeNull();
    expect(repoEmpToStandardId("unknown")).toBeNull();
  });
});

describe("reconcileSkills", () => {
  const repo = [
    { name: "copywriting", description: "", version: "1.1.0" },
    { name: "cold-email", description: "", version: "2.0.0" },
    { name: "repo-only-skill", description: "", version: "1.0.0" },
  ];
  const platform = [
    { name: "copywriting", version: "1.1.0" },
    { name: "cold-email", version: "2.1.0" },
    { name: "platform-only-skill", version: "1.0.0" },
  ];
  const rows = reconcileSkills(repo, platform);
  const byName = (n: string) => rows.find((r) => r.name.toLowerCase() === n)!;

  it("版本相等 → both-same", () => expect(byName("copywriting").status).toBe("both-same"));
  it("版本不等 → both-version-diff", () => {
    expect(byName("cold-email").status).toBe("both-version-diff");
    expect(byName("cold-email").repoVersion).toBe("2.0.0");
    expect(byName("cold-email").platformVersion).toBe("2.1.0");
  });
  it("仅 repo → repo-only", () => expect(byName("repo-only-skill").status).toBe("repo-only"));
  it("仅 platform → platform-only", () => expect(byName("platform-only-skill").status).toBe("platform-only"));

  it("一方版本缺失不算 version-diff", () => {
    const r = reconcileSkills([{ name: "x", description: "", version: null }], [{ name: "x", version: "1.0.0" }]);
    expect(r[0].status).toBe("both-same");
  });

  it("summary 计数", () => {
    const s = reconcileSummary(rows);
    expect(s.total).toBe(4);
    expect(s.same).toBe(1);
    expect(s.versionDiff).toBe(1);
    expect(s.repoOnly).toBe(1);
    expect(s.platformOnly).toBe(1);
  });
});
