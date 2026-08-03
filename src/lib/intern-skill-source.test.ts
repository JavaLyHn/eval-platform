import { describe, it, expect } from "vitest";
import {
  bundledToSkillSummaries, loadInternSkillSummaries, loadInternSkillBody, INTERN_EMP,
} from "./intern-skill-source";

describe("intern-skill-source", () => {
  it("bundledToSkillSummaries:映射为 name/description/version 形状", () => {
    const out = bundledToSkillSummaries([
      { id: "a", name: "skill-a", description: "desc-a", body: "# a" },
    ]);
    expect(out).toEqual([{ name: "skill-a", description: "desc-a", version: null }]);
  });

  it("INTERN_EMP 常量", () => {
    expect(INTERN_EMP).toBe("dex");
  });

  it("loadInternSkillSummaries:从 bundled JSON 取到非空技能列表", async () => {
    const sums = await loadInternSkillSummaries();
    expect(sums.length).toBeGreaterThan(0);
    expect(sums[0]).toHaveProperty("name");
  });

  it("loadInternSkillBody:首个技能有正文;未知名 → 空串", async () => {
    const sums = await loadInternSkillSummaries();
    const body = await loadInternSkillBody(sums[0].name);
    expect(body.length).toBeGreaterThan(0);
    expect(await loadInternSkillBody("不存在的技能名")).toBe("");
  });
});
