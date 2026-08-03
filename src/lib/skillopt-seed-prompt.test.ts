import { describe, expect, it } from "vitest";
import { ensureAnchors } from "./skillopt-seed-prompt";

describe("ensureAnchors", () => {
  it("appends anchors when missing", () => {
    const out = ensureAnchors("# 客服助手技能\n## 角色\n…");
    expect(out).toContain("<!-- SLOW_UPDATE_START -->");
    expect(out).toContain("<!-- SLOW_UPDATE_END -->");
  });
  it("keeps anchors when present (no duplicate)", () => {
    const src = "# x\n<!-- SLOW_UPDATE_START -->\n<!-- SLOW_UPDATE_END -->";
    const out = ensureAnchors(src);
    expect(out.match(/SLOW_UPDATE_START/g)?.length).toBe(1);
  });
  it("strips a wrapping markdown code fence", () => {
    const out = ensureAnchors("```markdown\n# 标题\n```");
    expect(out.startsWith("# 标题")).toBe(true);
    expect(out).not.toContain("```");
  });
});
