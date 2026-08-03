import { describe, expect, it } from "vitest";
import { parseStage, reduceStage, INITIAL_RUN_STATUS, caseTally, stageStatus, type RunStatus } from "./skillopt-stages";

describe("parseStage", () => {
  it("detects baseline", () => {
    expect(parseStage("  BASELINE — evaluate initial skill on Selection set (valid_seen)").stage).toBe("baseline");
  });
  it("detects step with numbers", () => {
    const r = parseStage("  [STEP 2/6] epoch=1 step_in_epoch=0");
    expect(r.stage).toBe("train");
    expect(r.currentStep).toBe(2);
    expect(r.totalSteps).toBe(6);
  });
  it("detects rollout score", () => {
    const r = parseStage("    [1/6 done] hard=0.5000 soft=0.7500");
    expect(r.stage).toBe("train");
    expect(r.lastHard).toBe(0.5);
    expect(r.lastSoft).toBe(0.75);
  });
  it("detects enrich on slow update or meta", () => {
    expect(parseStage("    [slow update] sampled 4 train items (seed=1)").stage).toBe("enrich");
    expect(parseStage("  [META SKILL epoch 2] resumed — already done").stage).toBe("enrich");
  });
  it("detects heldout", () => {
    expect(parseStage("  BASELINE TEST — evaluate initial skill on Test set (valid_unseen)").stage).toBe("heldout");
    expect(parseStage("  BEST SKILL TEST — evaluate best skill on Test set (valid_unseen)").stage).toBe("heldout");
  });
  it("detects done", () => {
    expect(parseStage("  Final Summary").stage).toBe("done");
  });
  it("returns empty for unrelated lines", () => {
    expect(parseStage("some random line").stage).toBeUndefined();
  });
});

describe("reduceStage", () => {
  it("parses a case line into progress + result", () => {
    const s = reduceStage(INITIAL_RUN_STATUS, "    [case 1/8] id=case-001 hard=1 soft=0.80");
    expect(s.caseDone).toBe(1);
    expect(s.caseTotal).toBe(8);
    expect(s.caseResults).toEqual([{ hard: 1 }]);
  });
  it("captures fail reason (may contain spaces)", () => {
    const s = reduceStage(INITIAL_RUN_STATUS, "    [case 2/8] id=c2 hard=0 soft=0.30 reason=意图判别 不符");
    expect(s.caseResults[0]).toEqual({ hard: 0, reason: "意图判别 不符" });
  });
  it("appends within a group and resets when i===1 starts a new group", () => {
    let s: RunStatus = INITIAL_RUN_STATUS;
    s = reduceStage(s, "    [case 1/2] id=a hard=1 soft=1.00");
    s = reduceStage(s, "    [case 2/2] id=b hard=0 soft=0.10 reason=x");
    expect(s.caseResults.length).toBe(2);
    s = reduceStage(s, "    [case 1/4] id=c hard=1 soft=0.90");
    expect(s.caseResults).toEqual([{ hard: 1 }]);
    expect(s.caseTotal).toBe(4);
    expect(s.caseDone).toBe(1);
  });
  it("clears case fields on stage change", () => {
    const prev: RunStatus = { ...INITIAL_RUN_STATUS, stage: "train", caseDone: 3, caseTotal: 8, caseResults: [{ hard: 1 }] };
    const s = reduceStage(prev, "  BASELINE TEST — evaluate initial skill on Test set (valid_unseen)");
    expect(s.stage).toBe("heldout");
    expect(s.caseDone).toBeUndefined();
    expect(s.caseTotal).toBeUndefined();
    expect(s.caseResults).toEqual([]);
  });
  it("delegates non-case lines to parseStage and keeps caseResults within same stage", () => {
    const prev: RunStatus = { ...INITIAL_RUN_STATUS, stage: "train", caseResults: [{ hard: 1 }] };
    const s = reduceStage(prev, "    [1/6 done] hard=0.5000 soft=0.7500");
    expect(s.lastSoft).toBe(0.75);
    expect(s.caseResults).toEqual([{ hard: 1 }]);
  });
  it("returns prev unchanged for unrelated lines", () => {
    const prev: RunStatus = { ...INITIAL_RUN_STATUS, caseDone: 2, caseTotal: 4, caseResults: [{ hard: 1 }, { hard: 0 }] };
    expect(reduceStage(prev, "some random line")).toBe(prev);
  });
  it("captures currentCaseId and keeps hard/reason after group renumber", () => {
    const s = reduceStage(INITIAL_RUN_STATUS, "    [case 2/8] id=m1tr_refund_zh hard=0 soft=0.40 reason=意图不符");
    expect(s.currentCaseId).toBe("m1tr_refund_zh");
    expect(s.caseDone).toBe(2);
    expect(s.caseResults[0]).toEqual({ hard: 0, reason: "意图不符" });
  });
  it("sets currentCaseId for a no-reason interception line", () => {
    const s = reduceStage(INITIAL_RUN_STATUS, "    [case 3/4] id=m1va_intercept_thinking hard=1 soft=1.00");
    expect(s.currentCaseId).toBe("m1va_intercept_thinking");
    expect(s.caseResults[0]).toEqual({ hard: 1 });
  });
  it("clears currentCaseId on stage change", () => {
    const prev: RunStatus = { ...INITIAL_RUN_STATUS, stage: "train", currentCaseId: "x", caseResults: [{ hard: 1 }] };
    const s = reduceStage(prev, "  BASELINE TEST — evaluate initial skill on Test set (valid_unseen)");
    expect(s.currentCaseId).toBeUndefined();
  });
});

describe("caseTally", () => {
  it("通过/失败/待测/总数/已完成", () => {
    const t = caseTally({ caseResults: [{ hard: 1 }, { hard: 1 }, { hard: 0 }], caseTotal: 5 });
    expect(t).toEqual({ pass: 2, fail: 1, pending: 2, total: 5, done: 3 });
  });
  it("空 → 全 0", () => {
    expect(caseTally({ caseResults: [] })).toEqual({ pass: 0, fail: 0, pending: 0, total: 0, done: 0 });
  });
  it("caseTotal 缺省 → total=done,pending 不为负", () => {
    const t = caseTally({ caseResults: [{ hard: 1 }, { hard: 0 }] });
    expect(t.total).toBe(2);
    expect(t.pending).toBe(0);
  });
});

describe("stageStatus", () => {
  it("已过=done / 当前=active / 未到=pending", () => {
    expect(stageStatus("baseline", "enrich")).toBe("done");
    expect(stageStatus("train", "enrich")).toBe("done");
    expect(stageStatus("enrich", "enrich")).toBe("active");
    expect(stageStatus("heldout", "enrich")).toBe("pending");
    expect(stageStatus("done", "enrich")).toBe("pending");
  });
  it("active=done → 所有阶段 done", () => {
    for (const k of ["baseline", "train", "enrich", "heldout", "done"] as const) {
      expect(stageStatus(k, "done")).toBe("done");
    }
  });
  it("无 active → pending", () => {
    expect(stageStatus("train", undefined)).toBe("pending");
  });
});
