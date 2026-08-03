import { describe, expect, it } from "vitest";
import {
  GROUND_TRUTH_CHECK_META,
  buildGroundTruthProbePrompt,
} from "./ground-truth-generator";

describe("GROUND_TRUTH_CHECK_META", () => {
  it("has exactly 4 entries", () => {
    expect(GROUND_TRUTH_CHECK_META).toHaveLength(4);
  });

  it("contains all 4 check kinds", () => {
    const kinds = GROUND_TRUTH_CHECK_META.map((m) => m.kind);
    expect(kinds).toContain("lang-match");
    expect(kinds).toContain("no-leak");
    expect(kinds).toContain("tool-succeeded");
    expect(kinds).toContain("no-placeholder");
  });

  it("lang-match and no-leak map to sam", () => {
    const samMeta = GROUND_TRUTH_CHECK_META.filter(
      (m) => m.employeeId === "sam",
    );
    expect(samMeta.map((m) => m.kind)).toEqual(
      expect.arrayContaining(["lang-match", "no-leak"]),
    );
  });

  it("tool-succeeded and no-placeholder map to aria", () => {
    const ariaMeta = GROUND_TRUTH_CHECK_META.filter(
      (m) => m.employeeId === "aria",
    );
    expect(ariaMeta.map((m) => m.kind)).toEqual(
      expect.arrayContaining(["tool-succeeded", "no-placeholder"]),
    );
  });

  it("each entry has non-empty label and intent", () => {
    for (const m of GROUND_TRUTH_CHECK_META) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.intent.length).toBeGreaterThan(0);
    }
  });
});

describe("buildGroundTruthProbePrompt", () => {
  const samMeta = GROUND_TRUTH_CHECK_META.find(
    (m) => m.kind === "lang-match",
  )!;
  const ariaMeta = GROUND_TRUTH_CHECK_META.find(
    (m) => m.kind === "tool-succeeded",
  )!;

  it("includes the employee name", () => {
    const prompt = buildGroundTruthProbePrompt({
      employeeName: "Sam",
      check: samMeta,
      count: 3,
    });
    expect(prompt).toContain("Sam");
  });

  it("includes the count", () => {
    const prompt = buildGroundTruthProbePrompt({
      employeeName: "Aria",
      check: ariaMeta,
      count: 5,
    });
    expect(prompt).toContain("5");
  });

  it("includes the check intent text", () => {
    const prompt = buildGroundTruthProbePrompt({
      employeeName: "Sam",
      check: samMeta,
      count: 3,
    });
    expect(prompt).toContain(samMeta.intent);
  });

  it("references the JSON key 'questions'", () => {
    const prompt = buildGroundTruthProbePrompt({
      employeeName: "Aria",
      check: ariaMeta,
      count: 3,
    });
    expect(prompt).toContain('"questions"');
  });

  it("lang-match prompt instructs per-language writing", () => {
    const prompt = buildGroundTruthProbePrompt({
      employeeName: "Sam",
      check: samMeta,
      count: 3,
    });
    // should mention language dispersion instruction
    expect(prompt).toContain("语种");
  });
});
