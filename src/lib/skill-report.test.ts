import { describe, expect, it } from "vitest";
import {
  composeSkillReportMeta,
  defaultSkillReportTitle,
  skillReportStats,
  upsertAuditMark,
  withThresholds,
  calibrationSummary,
  releaseVerdict,
  DEFAULT_GATE_THRESHOLDS,
  type SkillEvalReport,
  type SkillAuditMark,
} from "./skill-report";
import type { SkillOptDoneFrame, SkillOptSummary, SkillOptCase } from "./skillopt-client";

const summary = (over?: Partial<SkillOptSummary>): SkillOptSummary => ({
  mock: false, model: "gpt-5.2", caseSet: "LLM 生成题集", epochs: 2, trainSize: 10, testSize: 4,
  baselineSelectionHard: 1, bestSelectionHard: 1, bestStep: 1, bestOrigin: "", totalSteps: 4,
  totalAccepts: 1, totalRejects: 1, totalSkips: 0,
  baselineTestHard: 0.5, baselineTestSoft: 0.6, testHard: 0.75, testSoft: 0.83,
  baselineTestPassk: 0.25, testPassk: 0.5, testK: 3, wallTimeS: 120,
  tokens: { calls: 10, promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  ...over,
});

const frame = (cases: SkillOptDoneFrame["cases"], over?: Partial<SkillOptSummary>): SkillOptDoneFrame => ({
  type: "done", exitCode: 0, bestSkill: "", seedSkill: "", summary: summary(over), history: [], cases,
});

describe("composeSkillReportMeta", () => {
  it("模型留空回落 summary.model;tokens/wallTime 透传", () => {
    const m = composeSkillReportMeta({ caseSourceLabel: "Sam", epochs: 2 }, summary());
    expect(m.targetLabel).toBe("Sam");
    expect(m.targetModel).toBe("gpt-5.2");
    expect(m.optimizerModel).toBe("gpt-5.2");
    expect(m.wallTimeS).toBe(120);
    expect(m.tokens?.totalTokens).toBe(150);
  });
  it("显式模型覆盖;gate 留空=undefined;updateMode 透传", () => {
    const m = composeSkillReportMeta(
      { caseSourceLabel: "内置题集", targetModel: "claude-x", optimizerModel: "claude-y", epochs: 1, gateMetric: "", skillUpdateMode: "patch" },
      summary(),
    );
    expect(m.targetModel).toBe("claude-x");
    expect(m.optimizerModel).toBe("claude-y");
    expect(m.gateMetric).toBeUndefined();
    expect(m.skillUpdateMode).toBe("patch");
  });
});

describe("defaultSkillReportTitle", () => {
  it("被测对象 · 模型 · 到分钟", () => {
    const meta = composeSkillReportMeta({ caseSourceLabel: "Sam", epochs: 2 }, summary());
    expect(defaultSkillReportTitle(meta, "2026-06-09T17:05:30.000Z")).toBe("Sam · gpt-5.2 · 2026-06-09 17:05");
  });
});

describe("skillReportStats", () => {
  const mk = (cases: SkillOptDoneFrame["cases"], over?: Partial<SkillOptSummary>): SkillEvalReport => ({
    id: "x", createdAt: "", title: "", meta: composeSkillReportMeta({ caseSourceLabel: "y", epochs: 1 }, summary(over)),
    frame: frame(cases, over), logs: [],
  });
  it("有 cases:soft 基线→最优 + 通过数", () => {
    const st = skillReportStats(mk([
      { id: "a", prompt: "", caseType: "", taskType: "", baselineHard: 0, baselineSoft: 0, bestHard: 1, bestSoft: 1, baselineFailReason: "", bestFailReason: "", bestAnswer: "", passCount: 3, k: 3 },
      { id: "b", prompt: "", caseType: "", taskType: "", baselineHard: 1, baselineSoft: 1, bestHard: 0, bestSoft: 0, baselineFailReason: "", bestFailReason: "x", bestAnswer: "", passCount: 1, k: 3 },
    ]));
    expect(st.passN).toBe(1);
    expect(st.total).toBe(2);
    expect(st.baselineSoft).toBe(0.6);
    expect(st.bestSoft).toBe(0.83);
  });
  it("无 cases:total 0,soft 取 summary(可能 null)", () => {
    const st = skillReportStats(mk(null, { baselineTestSoft: null, testSoft: null, testPassk: null }));
    expect(st.total).toBe(0);
    expect(st.passN).toBe(0);
    expect(st.bestSoft).toBeNull();
  });
});

// 最小报告构造:仅含 audit 相关测试所需字段(frame 用空壳,cases 置空)
function bareReport(over: Partial<SkillEvalReport> = {}): SkillEvalReport {
  return {
    id: "r1",
    createdAt: "2026-06-10T00:00:00.000Z",
    title: "t",
    meta: {} as SkillEvalReport["meta"],
    frame: { summary: {}, history: [], cases: null } as unknown as SkillEvalReport["frame"],
    logs: [],
    ...over,
  };
}
const mark = (caseId: string, autoCorrect: boolean): SkillAuditMark => ({
  caseId,
  autoCorrect,
  reviewedAt: "2026-06-10T01:00:00.000Z",
});

describe("upsertAuditMark", () => {
  it("报告无 audit 时初始化并写入", () => {
    const r = upsertAuditMark(bareReport(), mark("c1", true));
    expect(r.audit?.marks).toEqual([mark("c1", true)]);
  });
  it("同 caseId 覆盖(不累计)", () => {
    let r = upsertAuditMark(bareReport(), mark("c1", true));
    r = upsertAuditMark(r, mark("c1", false));
    expect(r.audit?.marks).toEqual([mark("c1", false)]);
  });
  it("不同 caseId 追加", () => {
    let r = upsertAuditMark(bareReport(), mark("c1", true));
    r = upsertAuditMark(r, mark("c2", false));
    expect(r.audit?.marks.map((m) => m.caseId).sort()).toEqual(["c1", "c2"]);
  });
  it("不改原对象(纯函数)", () => {
    const orig = bareReport();
    upsertAuditMark(orig, mark("c1", true));
    expect(orig.audit).toBeUndefined();
  });
  it("保留已有 thresholds(不被 upsert 抹掉)", () => {
    const base = withThresholds(bareReport(), { agreePct: 70, coveragePct: 60 });
    const r = upsertAuditMark(base, mark("c1", true));
    expect(r.audit?.thresholds).toEqual({ agreePct: 70, coveragePct: 60 });
    expect(r.audit?.marks).toHaveLength(1);
  });
});

describe("withThresholds", () => {
  it("写入并 clamp 到 0–100 整数", () => {
    const r = withThresholds(bareReport(), { agreePct: 150, coveragePct: -5 });
    expect(r.audit?.thresholds).toEqual({ agreePct: 100, coveragePct: 0 });
  });
  it("保留已有 marks", () => {
    const base = upsertAuditMark(bareReport(), mark("c1", true));
    const r = withThresholds(base, { agreePct: 80, coveragePct: 50 });
    expect(r.audit?.marks).toHaveLength(1);
    expect(r.audit?.thresholds).toEqual({ agreePct: 80, coveragePct: 50 });
  });
  it("默认门槛 = 85 / 100", () => {
    expect(DEFAULT_GATE_THRESHOLDS).toEqual({ agreePct: 85, coveragePct: 100 });
  });
  it("NaN / Infinity → clamp(NaN→0, Infinity→0)", () => {
    const r = withThresholds(bareReport(), { agreePct: NaN, coveragePct: Infinity });
    expect(r.audit?.thresholds).toEqual({ agreePct: 0, coveragePct: 0 });
  });
});

// ── calibrationSummary ────────────────────────────────────────────────

// 造留出题(只填 calibrationSummary 用到的字段)
const oneCase = (id: string, caseType: string): SkillOptCase =>
  ({ id, caseType, bestHard: 1 } as unknown as SkillOptCase);

function reportWithCases(cases: SkillOptCase[], audit?: SkillEvalReport["audit"]): SkillEvalReport {
  return bareReport({
    frame: { summary: {}, history: [], cases } as unknown as SkillEvalReport["frame"],
    ...(audit ? { audit } : {}),
  });
}

describe("calibrationSummary", () => {
  it("空留出 → total=0 / coveragePct=null / gatePass=false", () => {
    const c = calibrationSummary(reportWithCases([]));
    expect(c.heldoutTotal).toBe(0);
    expect(c.coveragePct).toBeNull();
    expect(c.agreePct).toBeNull();
    expect(c.gatePass).toBe(false);
  });

  it("全审一致(默认 85/100)→ gatePass=true", () => {
    const cases = [oneCase("c1", "acceptAny"), oneCase("c2", "interception")];
    const audit = {
      marks: [
        { caseId: "c1", autoCorrect: true, reviewedAt: "x" },
        { caseId: "c2", autoCorrect: true, reviewedAt: "x" },
      ],
    };
    const c = calibrationSummary(reportWithCases(cases, audit));
    expect(c).toMatchObject({ heldoutTotal: 2, reviewed: 2, coveragePct: 100, agreePct: 100, gatePass: true });
  });

  it("覆盖不足(只审 1/2)→ gatePass=false", () => {
    const cases = [oneCase("c1", "acceptAny"), oneCase("c2", "acceptAny")];
    const audit = { marks: [{ caseId: "c1", autoCorrect: true, reviewedAt: "x" }] };
    const c = calibrationSummary(reportWithCases(cases, audit));
    expect(c.coveragePct).toBe(50);
    expect(c.gatePass).toBe(false);
  });

  it("红线题翻案 → redlineOverturns≥1 且 gatePass=false(即使其余一致、覆盖满)", () => {
    const cases = [oneCase("c1", "interception")];
    const audit = { marks: [{ caseId: "c1", autoCorrect: false, reviewedAt: "x" }] };
    const c = calibrationSummary(reportWithCases(cases, audit));
    expect(c.redlineOverturns).toBe(1);
    expect(c.gatePass).toBe(false);
  });

  it("用户门槛覆盖:降 coveragePct 到 50 → 审一半也覆盖达标;降 agreePct 到 50 → 50% 一致也达标", () => {
    const cases = [oneCase("c1", "acceptAny"), oneCase("c2", "acceptAny")];
    const audit = {
      marks: [
        { caseId: "c1", autoCorrect: true, reviewedAt: "x" },
        { caseId: "c2", autoCorrect: false, reviewedAt: "x" },
      ],
      thresholds: { agreePct: 50, coveragePct: 50 },
    };
    const c = calibrationSummary(reportWithCases(cases, audit));
    expect(c.agreePct).toBe(50);
    expect(c.coveragePct).toBe(100);
    expect(c.gatePass).toBe(true); // 50%≥50 且 100%≥50 且无红线翻案
  });

  it("有题但无 audit → coveragePct=0(非 null)/ agreePct=null / gatePass=false", () => {
    const c = calibrationSummary(reportWithCases([oneCase("c1", "acceptAny")]));
    expect(c.coveragePct).toBe(0);
    expect(c.agreePct).toBeNull();
    expect(c.gatePass).toBe(false);
  });

  it("marks 含重复 caseId → 不双计(coveragePct 不超 100)", () => {
    const cases = [oneCase("c1", "acceptAny"), oneCase("c2", "acceptAny")];
    const audit = {
      marks: [
        { caseId: "c1", autoCorrect: true, reviewedAt: "1" },
        { caseId: "c1", autoCorrect: false, reviewedAt: "2" }, // 重复,应只算最后一条
        { caseId: "c2", autoCorrect: true, reviewedAt: "1" },
      ],
    };
    const c = calibrationSummary(reportWithCases(cases, audit));
    expect(c.reviewed).toBe(2);
    expect(c.coveragePct).toBe(100);
    expect(c.overturns).toBe(1); // c1 最后一条是 false
  });

  it("overturns 包含红线翻案(redlineOverturns ⊆ overturns)", () => {
    const cases = [oneCase("c1", "interception"), oneCase("c2", "acceptAny")];
    const audit = {
      marks: [
        { caseId: "c1", autoCorrect: false, reviewedAt: "x" },
        { caseId: "c2", autoCorrect: false, reviewedAt: "x" },
      ],
    };
    const c = calibrationSummary(reportWithCases(cases, audit));
    expect(c.overturns).toBe(2);
    expect(c.redlineOverturns).toBe(1);
  });
});

// ── releaseVerdict ────────────────────────────────────────────────────

// summary 造数:只填 verdict 用到的留出 hard/soft/passk 字段
function reportFor(
  summary: Record<string, unknown>,
  cases: SkillOptCase[] | null,
  audit?: SkillEvalReport["audit"],
): SkillEvalReport {
  return bareReport({
    frame: { summary, history: [], cases } as unknown as SkillEvalReport["frame"],
    ...(audit ? { audit } : {}),
  });
}
const fullAudit = (ids: string[]): SkillEvalReport["audit"] => ({
  marks: ids.map((id) => ({ caseId: id, autoCorrect: true, reviewedAt: "x" })),
});

describe("releaseVerdict", () => {
  it("无留出集 → caution", () => {
    const v = releaseVerdict(reportFor({}, null));
    expect(v.tier).toBe("caution");
  });

  it("校准未过(没审)即便 best 分高 → pending-review,不进分数判定", () => {
    const cases = [oneCase("c1", "acceptAny")];
    const v = releaseVerdict(
      reportFor({ baselineTestHard: 0.2, testHard: 0.9, baselineTestSoft: 0.2, testSoft: 0.9 }, cases),
    );
    expect(v.tier).toBe("pending-review");
    expect(v.reasons.join()).toMatch(/覆盖/);
  });

  it("校准过 + 留出回归 → reject", () => {
    const cases = [oneCase("c1", "acceptAny")];
    const v = releaseVerdict(
      reportFor({ baselineTestHard: 0.8, testHard: 0.5, baselineTestSoft: 0.8, testSoft: 0.5 }, cases, fullAudit(["c1"])),
    );
    expect(v.tier).toBe("reject");
    expect(v.heldout.regressed).toBe(true);
  });

  it("校准过 + 提升 → recommend", () => {
    const cases = [oneCase("c1", "acceptAny")];
    const v = releaseVerdict(
      reportFor({ baselineTestHard: 0.4, testHard: 0.9, baselineTestSoft: 0.4, testSoft: 0.9 }, cases, fullAudit(["c1"])),
    );
    expect(v.tier).toBe("recommend");
  });

  it("校准过 + 持平 → caution", () => {
    const cases = [oneCase("c1", "acceptAny")];
    const v = releaseVerdict(
      reportFor({ baselineTestHard: 0.6, testHard: 0.6, baselineTestSoft: 0.6, testSoft: 0.6 }, cases, fullAudit(["c1"])),
    );
    expect(v.tier).toBe("caution");
  });

  it("校准过 + 留出 hard 指标缺失(null)→ caution(诚实文案,不谎称无收益)", () => {
    const cases = [oneCase("c1", "acceptAny")];
    const v = releaseVerdict(
      reportFor({ baselineTestHard: null, testHard: null, baselineTestSoft: 0.5, testSoft: 0.9 }, cases, fullAudit(["c1"])),
    );
    expect(v.tier).toBe("caution");
    expect(v.reasons.join()).toMatch(/缺失/);
  });

  it("覆盖门槛=0 且零抽审 → pending-review,兜底文案点明未抽审", () => {
    const cases = [oneCase("c1", "acceptAny")];
    const v = releaseVerdict(
      reportFor({ baselineTestHard: 0.5, testHard: 0.5, baselineTestSoft: 0.5, testSoft: 0.5 }, cases, {
        marks: [],
        thresholds: { agreePct: 85, coveragePct: 0 },
      }),
    );
    expect(v.tier).toBe("pending-review");
    expect(v.reasons.join()).toMatch(/未完成任何抽审|无法计算/);
  });
});
