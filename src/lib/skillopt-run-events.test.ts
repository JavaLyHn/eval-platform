import { describe, expect, it } from "vitest";
import { parseEvent, reduceMetrics, INITIAL_METRICS } from "./skillopt-run-events";

describe("parseEvent", () => {
  it("STEP → step 事件(accent)", () => {
    expect(parseEvent("  [STEP 2/4] epoch=1 step_in_epoch=0 ====")).toMatchObject({ kind: "step", tone: "accent" });
  });
  it("[1/6 done] → rollout 通过率", () => {
    const e = parseEvent("    [1/6 done] hard=0.5000 soft=0.7500")!;
    expect(e.kind).toBe("rollout");
    expect(e.text).toContain("50%");
  });
  it("ACCEPT (new best) → accept-best,ok,含前后分", () => {
    const e = parseEvent("    [6/6 EVALUATE] ACCEPT (new best) soft=0.8300 > prev best 0.7000")!;
    expect(e.kind).toBe("accept-best");
    expect(e.tone).toBe("ok");
    expect(e.detail).toContain("0.70");
    expect(e.detail).toContain("0.83");
  });
  it("ACCEPT → accept", () => {
    expect(parseEvent("    [6/6 EVALUATE] ACCEPT soft=0.8000 > current=0.7000")!.kind).toBe("accept");
  });
  it("REJECT → reject,tone=info(丢弃是常态不红)", () => {
    const e = parseEvent("    [6/6 EVALUATE] REJECT soft=0.6500 <= current=0.7000")!;
    expect(e.kind).toBe("reject");
    expect(e.tone).toBe("info");
  });
  it("skip / slow / baseline / pass^k / done", () => {
    expect(parseEvent("    [skip] no usable patches — skill unchanged")!.kind).toBe("skip");
    expect(parseEvent("    [slow update] sampled 4 train items (seed=1)")!.kind).toBe("slow");
    expect(parseEvent("  [baseline result] selection hard=1.0000 soft=1.0000 gate[soft]=1.0000")!.kind).toBe("baseline");
    const pk = parseEvent("    pass^k: 0.2500 -> 0.5000 (delta=+0.2500)")!;
    expect(pk.kind).toBe("heldout");
    expect(pk.tone).toBe("ok");
    expect(parseEvent("  Final Summary")!.kind).toBe("done");
  });
  it("逐题 [case] 行 → null(交给网格);无关行 → null", () => {
    expect(parseEvent("    [case 1/8] id=x hard=1 soft=1.00")).toBeNull();
    expect(parseEvent("some noise")).toBeNull();
  });
});

describe("reduceMetrics", () => {
  it("STEP → step/totalSteps;[1/6 done] → rollout 分", () => {
    let m = reduceMetrics(INITIAL_METRICS, "  [STEP 2/4] epoch=1 step_in_epoch=0");
    expect(m.step).toBe(2);
    expect(m.totalSteps).toBe(4);
    m = reduceMetrics(m, "    [1/6 done] hard=0.5 soft=0.75");
    expect(m.lastRolloutHard).toBe(0.5);
    expect(m.lastRolloutSoft).toBe(0.75);
  });
  it("baseline → series[0] + bestScore", () => {
    const m = reduceMetrics(INITIAL_METRICS, "  [baseline result] selection hard=0.7 soft=0.7 gate[soft]=0.70");
    expect(m.bestScore).toBeCloseTo(0.7);
    expect(m.selectionSeries).toEqual([0.7]);
  });
  it("baseline 支持 mixed gate 标签(嵌套中括号)", () => {
    const m = reduceMetrics(INITIAL_METRICS, "  [baseline result] selection hard=0.8 soft=0.8 gate[mixed[w=0.5]]=0.85");
    expect(m.bestScore).toBeCloseTo(0.85);
    expect(m.selectionSeries).toEqual([0.85]);
  });
  it("ACCEPT/REJECT 计数 + series 追加;accept-best 更新 bestScore", () => {
    let m = reduceMetrics(INITIAL_METRICS, "  [baseline result] selection hard=0.7 soft=0.7 gate[soft]=0.70");
    m = reduceMetrics(m, "    [6/6 EVALUATE] REJECT soft=0.6500 <= current=0.7000");
    expect(m.rejects).toBe(1);
    expect(m.selectionSeries).toEqual([0.7, 0.65]);
    m = reduceMetrics(m, "    [6/6 EVALUATE] ACCEPT (new best) soft=0.8300 > prev best 0.7000");
    expect(m.accepts).toBe(1);
    expect(m.bestScore).toBeCloseTo(0.83);
    expect(m.selectionSeries).toEqual([0.7, 0.65, 0.83]);
  });
  it("skip 计数;无关行原样返回(同一引用)", () => {
    expect(reduceMetrics(INITIAL_METRICS, "    [skip] no usable patches — skill unchanged").skips).toBe(1);
    expect(reduceMetrics(INITIAL_METRICS, "noise")).toBe(INITIAL_METRICS);
  });
});
