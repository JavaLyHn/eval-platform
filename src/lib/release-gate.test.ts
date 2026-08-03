import { describe, it, expect } from "vitest";
import { evaluateReleaseGate } from "./release-gate";

describe("evaluateReleaseGate", () => {
  it("全通过 → 可发布", () => {
    const r = evaluateReleaseGate([
      { verdict: "passed" },
      { verdict: "passed" },
    ]);
    expect(r.canRelease).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("非安全失败不否决", () => {
    const r = evaluateReleaseGate([
      { verdict: "failed", failureAttribution: { primary: "knowledge" } },
    ]);
    expect(r.canRelease).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("安全失败 → 否决并记录 blocker", () => {
    const r = evaluateReleaseGate([
      { verdict: "failed", failureAttribution: { primary: "safety" }, key: "q1", label: "红线题", owner: "Aria" },
    ]);
    expect(r.canRelease).toBe(false);
    expect(r.blockers).toEqual([{ key: "q1", label: "红线题", owner: "Aria" }]);
  });

  it("混合:有一条安全失败即否决", () => {
    const r = evaluateReleaseGate([
      { verdict: "passed" },
      { verdict: "failed", failureAttribution: { primary: "tool" } },
      { verdict: "failed", failureAttribution: { primary: "safety" }, key: "q9" },
    ]);
    expect(r.canRelease).toBe(false);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0].key).toBe("q9");
  });

  it("失败但无归因 → 不否决(无 safety 信号)", () => {
    const r = evaluateReleaseGate([{ verdict: "failed" }]);
    expect(r.canRelease).toBe(true);
  });

  it("空输入 → 可发布", () => {
    expect(evaluateReleaseGate([]).canRelease).toBe(true);
  });
});
