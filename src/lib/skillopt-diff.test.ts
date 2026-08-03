import { describe, expect, it } from "vitest";
import { extractLearnedGuidance, diffSkill } from "./skillopt-diff";

describe("extractLearnedGuidance", () => {
  it("extracts content between anchors", () => {
    const s = "# x\n<!-- SLOW_UPDATE_START -->\n## Guidance\nrule\n<!-- SLOW_UPDATE_END -->\n";
    expect(extractLearnedGuidance(s)).toBe("## Guidance\nrule");
  });
  it("returns empty when anchors are empty", () => {
    const s = "# x\n<!-- SLOW_UPDATE_START -->\n<!-- SLOW_UPDATE_END -->\n";
    expect(extractLearnedGuidance(s)).toBe("");
  });
  it("returns empty when no anchors", () => {
    expect(extractLearnedGuidance("# x\nno anchors")).toBe("");
  });
  it("returns empty for undefined / null (legacy/partial frame)", () => {
    expect(extractLearnedGuidance(undefined)).toBe("");
    expect(extractLearnedGuidance(null)).toBe("");
  });
});

describe("diffSkill", () => {
  it("marks added lines", () => {
    const d = diffSkill("a\nb", "a\nb\nc");
    expect(d.filter((l) => l.type === "add").map((l) => l.text)).toEqual(["c"]);
    expect(d.filter((l) => l.type === "same").length).toBe(2);
  });
  it("marks deleted lines", () => {
    const d = diffSkill("a\nb\nc", "a\nc");
    expect(d.filter((l) => l.type === "del").map((l) => l.text)).toEqual(["b"]);
  });
  it("does not throw on undefined seed (legacy/partial frame)", () => {
    expect(() => diffSkill(undefined, "a\nb")).not.toThrow();
    expect(diffSkill(undefined, "a\nb").some((l) => l.type === "add")).toBe(true);
  });
});
