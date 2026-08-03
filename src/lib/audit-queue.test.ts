import { describe, expect, it } from "vitest";
import {
  hashUnit,
  computeAuditQueue,
  DEFAULT_AUDIT_SAMPLE_RATE,
} from "./audit-queue";
import type { Evaluation, Question } from "@/types";

let _id = 0;
function ev(over: {
  msg: string;
  qid?: string;
  verdict: "passed" | "failed";
  source: "human" | "auto";
  at?: string;
}): Evaluation {
  _id += 1;
  return {
    id: `e${_id}`,
    questionId: over.qid ?? `q-${over.msg}`,
    messageId: over.msg,
    scores: [],
    notes: "",
    verdict: over.verdict,
    submittedAt: over.at ?? "2026-06-08T01:00:00Z",
    ...(over.source === "auto" ? { judgeProfileId: "judge-1" } : {}),
  } as Evaluation;
}
function q(id: string, severity?: "P0" | "P1" | "P2", floor?: string[]): Question {
  return { id, title: `题 ${id}`, severity, floorElementIds: floor } as unknown as Question;
}

describe("hashUnit", () => {
  it("在 [0,1) 且确定性(同输入相等)", () => {
    const a = hashUnit("msg-123");
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(hashUnit("msg-123")).toBe(a);
    expect(hashUnit("other")).not.toBe(a);
  });
});

describe("computeAuditQueue", () => {
  it("DEFAULT_AUDIT_SAMPLE_RATE 为 0.15", () => {
    expect(DEFAULT_AUDIT_SAMPLE_RATE).toBe(0.15);
  });

  it("rate=1 → 全部自动 PASS 入抽样;rate=0 → 仅 forced", () => {
    const evals = [
      ev({ msg: "m1", qid: "q1", verdict: "passed", source: "auto" }),
      ev({ msg: "m2", qid: "q2", verdict: "passed", source: "auto" }),
      ev({ msg: "m3", qid: "q3", verdict: "passed", source: "auto" }),
    ];
    const questions = [q("q1", "P1"), q("q2", "P2"), q("q3", "P1")];
    const full = computeAuditQueue(evals, questions, 1);
    expect(full.autoPassTotal).toBe(3);
    expect(full.sampledTotal).toBe(3);
    const none = computeAuditQueue(evals, questions, 0);
    expect(none.autoPassTotal).toBe(3);
    expect(none.sampledTotal).toBe(0);
    expect(none.forcedCount).toBe(0);
  });

  it("P0 或红线题即使 rate=0 仍 forced 入队", () => {
    const evals = [
      ev({ msg: "m1", qid: "q-p0", verdict: "passed", source: "auto" }),
      ev({ msg: "m2", qid: "q-red", verdict: "passed", source: "auto" }),
      ev({ msg: "m3", qid: "q-p2", verdict: "passed", source: "auto" }),
    ];
    const questions = [
      q("q-p0", "P0"),
      q("q-red", "P2", ["floor-1"]),
      q("q-p2", "P2"),
    ];
    const r = computeAuditQueue(evals, questions, 0);
    expect(r.forcedCount).toBe(2);
    expect(r.sampledTotal).toBe(2);
    expect(r.pending.some((i) => i.questionId === "q-p0" && i.forced)).toBe(true);
    expect(r.pending.some((i) => i.questionId === "q-red" && i.forced)).toBe(true);
  });

  it("确定性:同输入两次调用 sampledTotal 相同", () => {
    const evals = Array.from({ length: 20 }, (_, i) =>
      ev({ msg: `m${i}`, qid: `q${i}`, verdict: "passed", source: "auto" }),
    );
    const questions = Array.from({ length: 20 }, (_, i) => q(`q${i}`, "P1"));
    const a = computeAuditQueue(evals, questions, 0.5);
    const b = computeAuditQueue(evals, questions, 0.5);
    expect(a.sampledTotal).toBe(b.sampledTotal);
    expect(a.pending.map((i) => i.messageId).sort()).toEqual(
      b.pending.map((i) => i.messageId).sort(),
    );
  });

  it("同 messageId 有人工判 → reviewed;人工判 failed → overturned", () => {
    const evals = [
      ev({ msg: "m1", qid: "q1", verdict: "passed", source: "auto" }),
      ev({ msg: "m1", qid: "q1", verdict: "failed", source: "human" }),
    ];
    const questions = [q("q1", "P0")];
    const r = computeAuditQueue(evals, questions, 0);
    expect(r.sampledTotal).toBe(1);
    const item = r.reviewed[0];
    expect(item.reviewed).toBe(true);
    expect(item.humanVerdict).toBe("failed");
    expect(item.overturned).toBe(true);
    expect(r.overturnedCount).toBe(1);
    expect(r.reviewedCount).toBe(1);
    expect(r.pendingCount).toBe(0);
  });

  it("poolTotal=0(无自动判 / 纯人工 / 空)→ 计数全 0;全 failed 现进池", () => {
    expect(computeAuditQueue([], [], 1).poolTotal).toBe(0);
    const onlyHuman = [ev({ msg: "m1", verdict: "passed", source: "human" })];
    const r1 = computeAuditQueue(onlyHuman, [q("q-m1", "P1")], 1);
    expect(r1.poolTotal).toBe(0); // 纯人工无自动判 → 不进池
    expect(r1.sampledTotal).toBe(0);
    // 全 failed:双向抽审下现在进池(旧口径会整条丢掉)
    const autoFail = [ev({ msg: "m2", qid: "q2", verdict: "failed", source: "auto" })];
    const r2 = computeAuditQueue(autoFail, [q("q2", "P1")], 1);
    expect(r2.autoPassTotal).toBe(0);
    expect(r2.autoFailTotal).toBe(1);
    expect(r2.poolTotal).toBe(1);
    expect(r2.sampledTotal).toBe(1);
  });

  it("同 messageId 多条自动判取最新定 verdict", () => {
    const evals = [
      ev({ msg: "m1", qid: "q1", verdict: "failed", source: "auto", at: "2026-06-08T01:00:00Z" }),
      ev({ msg: "m1", qid: "q1", verdict: "passed", source: "auto", at: "2026-06-08T02:00:00Z" }),
    ];
    const r = computeAuditQueue(evals, [q("q1", "P0")], 1);
    expect(r.autoPassTotal).toBe(1);
    expect(r.sampledTotal).toBe(1);
  });

  it("rate 越界钳到 [0,1]", () => {
    const evals = [ev({ msg: "m1", qid: "q1", verdict: "passed", source: "auto" })];
    const questions = [q("q1", "P1")];
    expect(computeAuditQueue(evals, questions, 5).rate).toBe(1);
    expect(computeAuditQueue(evals, questions, -1).rate).toBe(0);
  });

  it("rate=NaN 回退到默认 0.15", () => {
    const evals = [ev({ msg: "m1", qid: "q1", verdict: "passed", source: "auto" })];
    const questions = [q("q1", "P1")];
    expect(computeAuditQueue(evals, questions, NaN).rate).toBe(0.15);
  });

  it("pendingForcedCount 只数「待复核」里的红线;明细两部分恒等于 pendingCount", () => {
    const evals = [
      // m1: P0(forced)已复核 → 不在 pending
      ev({ msg: "m1", qid: "q-p0a", verdict: "passed", source: "auto" }),
      ev({ msg: "m1", qid: "q-p0a", verdict: "passed", source: "human" }),
      // m2: P0(forced)未复核 → pending & forced
      ev({ msg: "m2", qid: "q-p0b", verdict: "passed", source: "auto" }),
      // m3: P1(rate=1 抽中,非 forced)未复核 → pending & 非 forced
      ev({ msg: "m3", qid: "q-p1a", verdict: "passed", source: "auto" }),
      // m4: P1 已复核 → 不在 pending
      ev({ msg: "m4", qid: "q-p1b", verdict: "passed", source: "auto" }),
      ev({ msg: "m4", qid: "q-p1b", verdict: "passed", source: "human" }),
    ];
    const questions = [q("q-p0a", "P0"), q("q-p0b", "P0"), q("q-p1a", "P1"), q("q-p1b", "P1")];
    const r = computeAuditQueue(evals, questions, 1);
    expect(r.forcedCount).toBe(2); // 含已复核的 m1
    expect(r.pendingCount).toBe(2); // m2 + m3
    expect(r.pendingForcedCount).toBe(1); // 仅 m2(m1 已复核不算)
    // 明细必须自洽:P0/红线 + 抽样 === 待复核
    expect(r.pendingForcedCount + (r.pendingCount - r.pendingForcedCount)).toBe(r.pendingCount);
    // 且区别于 forcedCount —— 这正是原 bug(明细用了含已复核的 forcedCount)
    expect(r.pendingForcedCount).not.toBe(r.forcedCount);
  });

  it("LLM 判失败的回答也进抽审池(双向抽审 · 抓错杀)", () => {
    const evals = [
      ev({ msg: "m1", qid: "q1", verdict: "passed", source: "auto" }),
      ev({ msg: "m2", qid: "q2", verdict: "failed", source: "auto" }),
    ];
    const questions = [q("q1", "P1"), q("q2", "P1")];
    const r = computeAuditQueue(evals, questions, 1);
    expect(r.autoPassTotal).toBe(1);
    expect(r.autoFailTotal).toBe(1);
    expect(r.poolTotal).toBe(2);
    expect(r.sampledTotal).toBe(2); // 通过 + 失败 都抽中
    expect(
      r.pending.some((i) => i.messageId === "m2" && i.autoVerdict === "failed"),
    ).toBe(true);
  });

  it("overturned = 人工判 ≠ LLM 判(双向):人工放行 LLM 判失败 = 推翻", () => {
    const evals = [
      // LLM 判失败,人工判通过 → 推翻(错杀)
      ev({ msg: "m1", qid: "q1", verdict: "failed", source: "auto" }),
      ev({ msg: "m1", qid: "q1", verdict: "passed", source: "human" }),
    ];
    const r = computeAuditQueue(evals, [q("q1", "P0")], 0);
    expect(r.reviewed[0].autoVerdict).toBe("failed");
    expect(r.reviewed[0].humanVerdict).toBe("passed");
    expect(r.reviewed[0].overturned).toBe(true);
    expect(r.overturnedCount).toBe(1);
  });

  it("人工判 passed → reviewed 但不 overturned", () => {
    const evals = [
      ev({ msg: "m1", qid: "q1", verdict: "passed", source: "auto" }),
      ev({ msg: "m1", qid: "q1", verdict: "passed", source: "human" }),
    ];
    const r = computeAuditQueue(evals, [q("q1", "P0")], 0);
    expect(r.reviewedCount).toBe(1);
    expect(r.reviewed[0].overturned).toBe(false);
    expect(r.overturnedCount).toBe(0);
  });
});
