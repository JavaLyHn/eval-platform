import { describe, expect, it } from "vitest";
import {
  partitionForBatchJudge,
  partitionForBatchJudgeAcrossConvs,
  questionCounts,
  upsertBatchJudgeEvaluation,
  judgeQuestionProgress,
  groupJudgeUnitsByContext,
} from "./batch-judge-plan";
import type { ChatMessage, Evaluation } from "@/types";

function u(id: string, qid: string): ChatMessage {
  return { id, role: "user", content: "q", questionId: qid, createdAt: "t" };
}
function a(id: string, qid: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: "assistant", content: "ans", questionId: qid, createdAt: "t", ...extra };
}
function ev(qid: string, mid: string): Evaluation {
  return { id: "e" + mid, questionId: qid, messageId: mid, scores: [], autoScore: 0, notes: "", verdict: "passed", submittedAt: "t" };
}

describe("partitionForBatchJudge", () => {
  it("已答未评 → eligible", () => {
    const r = partitionForBatchJudge(["q1"], [u("u1", "q1"), a("a1", "q1")], []);
    expect(r.eligible.map((x) => x.questionId)).toEqual(["q1"]);
    expect(r.alreadyEvaluated).toEqual([]);
    expect(r.unanswered).toEqual([]);
  });
  it("已答已评(命中最新回答)→ alreadyEvaluated", () => {
    const r = partitionForBatchJudge(["q1"], [u("u1", "q1"), a("a1", "q1")], [ev("q1", "a1")]);
    expect(r.alreadyEvaluated.map((x) => x.questionId)).toEqual(["q1"]);
    expect(r.eligible).toEqual([]);
  });
  it("未答 → unanswered", () => {
    expect(partitionForBatchJudge(["q1"], [], []).unanswered).toEqual(["q1"]);
  });
  it("最新回答超时中断(interruptKind=timeout)→ unanswered", () => {
    const r = partitionForBatchJudge(
      ["q1"],
      [u("u1", "q1"), a("a1", "q1", { interrupted: true, interruptKind: "timeout" })],
      [],
    );
    expect(r.unanswered).toEqual(["q1"]);
  });
  it("最新回答是 agent 反问暂停(interruptKind=agent-pause)→ eligible(完整一轮,可评)", () => {
    const r = partitionForBatchJudge(
      ["q1"],
      [u("u1", "q1"), a("a1", "q1", { interrupted: true, interruptKind: "agent-pause" })],
      [],
    );
    expect(r.eligible.map((x) => x.turn.assistant.id)).toEqual(["a1"]);
    expect(r.unanswered).toEqual([]);
  });
  it("旧回答有评、最新回答无评 → eligible(看最新)", () => {
    const msgs = [u("u1", "q1"), a("a1", "q1"), u("u2", "q1"), a("a2", "q1")];
    const r = partitionForBatchJudge(["q1"], msgs, [ev("q1", "a1")]);
    expect(r.eligible.map((x) => x.turn.assistant.id)).toEqual(["a2"]);
  });
  it("只有确定性自动评测(evaluator.role=deterministic)→ 仍算 eligible,不算已评", () => {
    const detEv: Evaluation = {
      ...ev("q1", "a1"),
      evaluator: { name: "确定性 checker", role: "deterministic" },
    };
    const r = partitionForBatchJudge(["q1"], [u("u1", "q1"), a("a1", "q1")], [detEv]);
    expect(r.eligible.map((x) => x.questionId)).toEqual(["q1"]);
    expect(r.alreadyEvaluated).toEqual([]);
  });
  it("确定性评测 + LLM judge 评测并存 → 算已评", () => {
    const detEv: Evaluation = {
      ...ev("q1", "a1"),
      evaluator: { name: "确定性 checker", role: "deterministic" },
    };
    const judgeEv: Evaluation = { ...ev("q1", "a1"), id: "e-judge", judgeProfileId: "j1" };
    const r = partitionForBatchJudge(["q1"], [u("u1", "q1"), a("a1", "q1")], [detEv, judgeEv]);
    expect(r.alreadyEvaluated.map((x) => x.questionId)).toEqual(["q1"]);
    expect(r.eligible).toEqual([]);
  });
});

const mkU = (qid: string): ChatMessage =>
  ({ id: `u-${qid}-${Math.random()}`, role: "user", content: "q", questionId: qid }) as ChatMessage;
const mkA = (qid: string, id: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: "assistant", content: "a", questionId: qid, ...extra }) as ChatMessage;

describe("partitionForBatchJudge — 多 trial", () => {
  it("多 trial 题(回答带 trialIndex)→ 每个 trial 各一个 target", () => {
    const msgs: ChatMessage[] = [
      mkU("q1"), mkA("q1", "a0", { trialIndex: 0, trialTotal: 3 }),
      mkU("q1"), mkA("q1", "a1", { trialIndex: 1, trialTotal: 3 }),
      mkU("q1"), mkA("q1", "a2", { trialIndex: 2, trialTotal: 3 }),
    ];
    const part = partitionForBatchJudge(["q1"], msgs, []);
    expect(part.eligible.map((t) => t.turn.assistant.id)).toEqual(["a0", "a1", "a2"]);
    expect(part.alreadyEvaluated).toHaveLength(0);
  });

  it("多 trial:已评的 trial 进 alreadyEvaluated,未评的进 eligible", () => {
    const msgs: ChatMessage[] = [
      mkU("q1"), mkA("q1", "a0", { trialIndex: 0, trialTotal: 2 }),
      mkU("q1"), mkA("q1", "a1", { trialIndex: 1, trialTotal: 2 }),
    ];
    const evals = [{ questionId: "q1", messageId: "a0" }] as Evaluation[];
    const part = partitionForBatchJudge(["q1"], msgs, evals);
    expect(part.alreadyEvaluated.map((t) => t.turn.assistant.id)).toEqual(["a0"]);
    expect(part.eligible.map((t) => t.turn.assistant.id)).toEqual(["a1"]);
  });

  it("普通题(无 trialIndex)→ 仍只判最新一轮(现状不变)", () => {
    const msgs: ChatMessage[] = [
      mkU("q2"), mkA("q2", "b0"),
      mkU("q2"), mkA("q2", "b1"),
    ];
    const part = partitionForBatchJudge(["q2"], msgs, []);
    expect(part.eligible).toHaveLength(1);
    expect(part.eligible[0].turn.assistant.id).toBe("b1");
  });

  it("多 trial:全部超时/失败(timeout/error)→ unanswered", () => {
    const msgs: ChatMessage[] = [
      mkU("q3"), mkA("q3", "c0", { trialIndex: 0, trialTotal: 2, interrupted: true, interruptKind: "timeout" }),
      mkU("q3"), mkA("q3", "c1", { trialIndex: 1, trialTotal: 2, interrupted: true, interruptKind: "error" }),
    ];
    const part = partitionForBatchJudge(["q3"], msgs, []);
    expect(part.unanswered).toEqual(["q3"]);
  });

  it("多 trial:1 干净 + 2 agent 反问暂停 → 全部 3 条 eligible(pass^k 分母凑满 K)", () => {
    // 复现真实 bug:2题×3次里某题 trial1/trial2 以 present_options 反问结束,
    // 旧逻辑会剔掉这两条只剩 1 条;反问轮是完整一轮,应全部计入。
    const msgs: ChatMessage[] = [
      mkU("q4"), mkA("q4", "d0", { trialIndex: 0, trialTotal: 3 }),
      mkU("q4"), mkA("q4", "d1", { trialIndex: 1, trialTotal: 3, interrupted: true, interruptKind: "agent-pause" }),
      mkU("q4"), mkA("q4", "d2", { trialIndex: 2, trialTotal: 3, interrupted: true, interruptKind: "agent-pause" }),
    ];
    const part = partitionForBatchJudge(["q4"], msgs, []);
    expect(part.eligible.map((t) => t.turn.assistant.id)).toEqual(["d0", "d1", "d2"]);
    expect(part.unanswered).toEqual([]);
  });

  it("多 trial:混合 —— 干净/反问计入,超时排除", () => {
    const msgs: ChatMessage[] = [
      mkU("q5"), mkA("q5", "e0", { trialIndex: 0, trialTotal: 3 }),
      mkU("q5"), mkA("q5", "e1", { trialIndex: 1, trialTotal: 3, interrupted: true, interruptKind: "agent-pause" }),
      mkU("q5"), mkA("q5", "e2", { trialIndex: 2, trialTotal: 3, interrupted: true, interruptKind: "timeout" }),
    ];
    const part = partitionForBatchJudge(["q5"], msgs, []);
    expect(part.eligible.map((t) => t.turn.assistant.id)).toEqual(["e0", "e1"]);
  });

  it("多 trial:旧数据裸 interrupted(无 interruptKind)→ 视为可评(默认按 agent 反问处理)", () => {
    const msgs: ChatMessage[] = [
      mkU("q6"), mkA("q6", "f0", { trialIndex: 0, trialTotal: 2, interrupted: true }),
      mkU("q6"), mkA("q6", "f1", { trialIndex: 1, trialTotal: 2, interrupted: true }),
    ];
    const part = partitionForBatchJudge(["q6"], msgs, []);
    expect(part.eligible.map((t) => t.turn.assistant.id)).toEqual(["f0", "f1"]);
    expect(part.unanswered).toEqual([]);
  });
});

describe("partitionForBatchJudgeAcrossConvs(跨会话:每题独立会话)", () => {
  const at = (s: string) => s; // createdAt 直接传 ISO 字符串
  const u3 = (qid: string, t: string): ChatMessage =>
    ({ id: `u-${qid}-${t}`, role: "user", content: "q", questionId: qid, createdAt: at(t) }) as ChatMessage;
  const a3 = (qid: string, id: string, t: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
    ({ id, role: "assistant", content: "a", questionId: qid, createdAt: at(t), ...extra }) as ChatMessage;

  it("3 题散在 3 个会话 → 全部找到、各带 conversationId", () => {
    const convs = [
      { id: "c1", messages: [u3("q1", "2026-01-01T10:00:00Z"), a3("q1", "a1", "2026-01-01T10:01:00Z")] },
      { id: "c2", messages: [u3("q2", "2026-01-01T11:00:00Z"), a3("q2", "a2", "2026-01-01T11:01:00Z")] },
      { id: "c3", messages: [u3("q3", "2026-01-01T12:00:00Z"), a3("q3", "a3", "2026-01-01T12:01:00Z")] },
    ];
    const part = partitionForBatchJudgeAcrossConvs(["q1", "q2", "q3"], convs, []);
    expect(part.eligible.map((t) => t.questionId).sort()).toEqual(["q1", "q2", "q3"]);
    expect(part.eligible.find((t) => t.questionId === "q2")?.conversationId).toBe("c2");
    expect(part.unanswered).toEqual([]);
  });

  it("同题答过两个会话 → 取回答时间最新的那个", () => {
    const convs = [
      { id: "old", messages: [u3("q1", "2026-01-01T10:00:00Z"), a3("q1", "a-old", "2026-01-01T10:01:00Z")] },
      { id: "new", messages: [u3("q1", "2026-01-02T10:00:00Z"), a3("q1", "a-new", "2026-01-02T10:01:00Z")] },
    ];
    const part = partitionForBatchJudgeAcrossConvs(["q1"], convs, []);
    expect(part.eligible).toHaveLength(1);
    expect(part.eligible[0].turn.assistant.id).toBe("a-new");
    expect(part.eligible[0].conversationId).toBe("new");
  });

  it("哪个会话都没答过 → unanswered", () => {
    const convs = [{ id: "c1", messages: [u3("q9", "2026-01-01T10:00:00Z"), a3("q9", "x", "2026-01-01T10:01:00Z")] }];
    expect(partitionForBatchJudgeAcrossConvs(["q1"], convs, []).unanswered).toEqual(["q1"]);
  });

  it("多 trial 题在 run 会话里 → 逐 trial 入队(行为与单会话版一致)", () => {
    const convs = [
      {
        id: "run",
        messages: [
          u3("q1", "2026-01-01T10:00:00Z"), a3("q1", "t0", "2026-01-01T10:01:00Z", { trialIndex: 0, trialTotal: 2 }),
          u3("q1", "2026-01-01T10:02:00Z"), a3("q1", "t1", "2026-01-01T10:03:00Z", { trialIndex: 1, trialTotal: 2 }),
        ],
      },
    ];
    const part = partitionForBatchJudgeAcrossConvs(["q1"], convs, []);
    expect(part.eligible.map((t) => t.turn.assistant.id)).toEqual(["t0", "t1"]);
    expect(part.eligible.every((t) => t.conversationId === "run")).toBe(true);
  });
});

describe("questionCounts(按题计数,多 trial 同题只算一次)", () => {
  const mkU2 = (qid: string): ChatMessage =>
    ({ id: `u-${qid}-${Math.random()}`, role: "user", content: "q", questionId: qid }) as ChatMessage;
  const mkA2 = (qid: string, id: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
    ({ id, role: "assistant", content: "a", questionId: qid, ...extra }) as ChatMessage;
  const judgedEv = (qid: string, mid: string): Evaluation =>
    ({ id: `e-${mid}`, questionId: qid, messageId: mid, judgeProfileId: "j1" }) as Evaluation;

  it("2 题 × 3 trial 全部已评 → 已评=2(题),不是 6", () => {
    const msgs: ChatMessage[] = [];
    const evals: Evaluation[] = [];
    for (const qid of ["q1", "q2"]) {
      for (let i = 0; i < 3; i++) {
        const mid = `${qid}-t${i}`;
        msgs.push(mkU2(qid), mkA2(qid, mid, { trialIndex: i, trialTotal: 3 }));
        evals.push(judgedEv(qid, mid));
      }
    }
    const part = partitionForBatchJudge(["q1", "q2"], msgs, evals);
    // trial 级:6 条已评
    expect(part.alreadyEvaluated).toHaveLength(6);
    // 题级:2 题
    const qc = questionCounts(part);
    expect(qc).toEqual({ eligible: 0, alreadyEvaluated: 2, unanswered: 0, answered: 2 });
  });

  it("一题部分 trial 已评 → 该题算「可评」(非「已评」)", () => {
    const msgs: ChatMessage[] = [
      mkU2("q1"), mkA2("q1", "a0", { trialIndex: 0, trialTotal: 2 }),
      mkU2("q1"), mkA2("q1", "a1", { trialIndex: 1, trialTotal: 2 }),
    ];
    const part = partitionForBatchJudge(["q1"], msgs, [judgedEv("q1", "a0")]);
    const qc = questionCounts(part);
    expect(qc).toEqual({ eligible: 1, alreadyEvaluated: 0, unanswered: 0, answered: 1 });
  });
});

describe("upsertBatchJudgeEvaluation(redo 落库去重)", () => {
  const judge = (mid: string, extra: Partial<Evaluation> = {}): Evaluation =>
    ({
      id: "j" + mid,
      questionId: "q1",
      messageId: mid,
      scores: [],
      autoScore: 5,
      notes: "",
      verdict: "passed",
      submittedAt: "t1",
      judgeProfileId: "judge-1",
      ...extra,
    }) as Evaluation;

  it("同 (messageId, subIndex) 的上一版 LLM 评测被替换,不累积重复", () => {
    const prev = [judge("m1", { id: "old", verdict: "failed" })];
    const out = upsertBatchJudgeEvaluation(prev, judge("m1", { id: "new", verdict: "passed" }));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("new");
    expect(out[0].verdict).toBe("passed");
  });

  it("保留同一条消息上的确定性 / 人工评测(无 judgeProfileId,不删)", () => {
    const deterministic = { ...ev("q1", "m1"), id: "det", evaluator: { name: "checker", role: "deterministic" as const } };
    const manual = { ...ev("q1", "m1"), id: "man", verdict: "failed" as const }; // 无 judgeProfileId
    const prev: Evaluation[] = [deterministic, manual, judge("m1", { id: "oldjudge" })];
    const out = upsertBatchJudgeEvaluation(prev, judge("m1", { id: "newjudge" }));
    // 旧 LLM 评测被顶掉,det + manual 保留,新 LLM 加入
    expect(out.map((e) => e.id).sort()).toEqual(["det", "man", "newjudge"].sort());
  });

  it("不同 subIndex(逐轮单评)互不替换 —— 各轮各留一条", () => {
    const prev = [judge("m1", { id: "sub0", subIndex: 0 })];
    const out = upsertBatchJudgeEvaluation(prev, judge("m1", { id: "sub1", subIndex: 1 }));
    expect(out.map((e) => e.id).sort()).toEqual(["sub0", "sub1"]);
  });

  it("不同 messageId 互不影响", () => {
    const prev = [judge("m1", { id: "keep" })];
    const out = upsertBatchJudgeEvaluation(prev, judge("m2", { id: "new" }));
    expect(out).toHaveLength(2);
  });
});

describe("judgeQuestionProgress(进度按题折算,困难题多轮=1)", () => {
  // q1 单轮(1 单元)、q2 三轮(3 单元)→ 共 2 题 / 4 单元。
  const plan = [
    { key: "q1-a", questionId: "q1" },
    { key: "q2-r0", questionId: "q2" },
    { key: "q2-r1", questionId: "q2" },
    { key: "q2-r2", questionId: "q2" },
  ];

  it("总数按题(2)与单元(4)分开返回", () => {
    const r = judgeQuestionProgress(plan, []);
    expect(r).toEqual({ doneQ: 0, totalQ: 2, totalUnits: 4 });
  });

  it("多轮题只有部分轮判完 → 该题不算完成", () => {
    const r = judgeQuestionProgress(plan, ["q1-a", "q2-r0", "q2-r1"]);
    expect(r.doneQ).toBe(1); // 只有 q1 全判完;q2 还差 r2
    expect(r.totalQ).toBe(2);
  });

  it("多轮题所有轮判完 → 该题算 1 条完成", () => {
    const r = judgeQuestionProgress(plan, ["q1-a", "q2-r0", "q2-r1", "q2-r2"]);
    expect(r.doneQ).toBe(2);
  });

  it("空 plan → 全 0", () => {
    expect(judgeQuestionProgress(undefined, undefined)).toEqual({
      doneQ: 0,
      totalQ: 0,
      totalUnits: 0,
    });
  });
});

describe("groupJudgeUnitsByContext(并发分组:多轮题不拆线程、组内按序)", () => {
  type U = { qid: string; trial: number | null; sub: number; key: string };
  const ck = (u: U) => `${u.qid}#${u.trial ?? -1}`;
  const ord = (u: U) => u.sub;

  it("同一道多轮题的各轮 → 归一组、按 subIndex 顺序(乱序输入也排好)", () => {
    const units: U[] = [
      { qid: "q1", trial: null, sub: 2, key: "q1-r2" },
      { qid: "q1", trial: null, sub: 0, key: "q1-r0" },
      { qid: "q1", trial: null, sub: 1, key: "q1-r1" },
    ];
    const jobs = groupJudgeUnitsByContext(units, ck, ord);
    expect(jobs).toHaveLength(1); // 一道多轮题 = 一个作业(一个线程)
    expect(jobs[0].map((u) => u.key)).toEqual(["q1-r0", "q1-r1", "q1-r2"]); // 按序
  });

  it("不同题 → 不同作业(可并行)", () => {
    const units: U[] = [
      { qid: "q1", trial: null, sub: 0, key: "a" },
      { qid: "q2", trial: null, sub: 0, key: "b" },
    ];
    const jobs = groupJudgeUnitsByContext(units, ck, ord);
    expect(jobs).toHaveLength(2);
  });

  it("多 trial:同题不同 trial → 拆成不同作业(trial 间独立、可并行);同 trial 各轮同组", () => {
    const units: U[] = [
      { qid: "q1", trial: 0, sub: 0, key: "t0r0" },
      { qid: "q1", trial: 0, sub: 1, key: "t0r1" },
      { qid: "q1", trial: 1, sub: 0, key: "t1r0" },
      { qid: "q1", trial: 1, sub: 1, key: "t1r1" },
    ];
    const jobs = groupJudgeUnitsByContext(units, ck, ord);
    expect(jobs).toHaveLength(2); // trial0 一组、trial1 一组
    expect(jobs[0].map((u) => u.key)).toEqual(["t0r0", "t0r1"]);
    expect(jobs[1].map((u) => u.key)).toEqual(["t1r0", "t1r1"]);
  });

  it("单轮题 → 各自单元素作业", () => {
    const units: U[] = [
      { qid: "q1", trial: null, sub: 0, key: "a" },
      { qid: "q2", trial: null, sub: 0, key: "b" },
      { qid: "q3", trial: null, sub: 0, key: "c" },
    ];
    const jobs = groupJudgeUnitsByContext(units, ck, ord);
    expect(jobs.map((j) => j.length)).toEqual([1, 1, 1]);
  });
});
