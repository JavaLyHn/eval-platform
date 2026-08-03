import { describe, expect, it } from "vitest";
import { buildBatchResultRows, type LastBatchJudge } from "./batch-results";
import type { Evaluation, Question, StandardEmployee } from "@/types";
import type { AgentProfile } from "@/agents/types";

const ev = (id: string, questionId: string, extra: Partial<Evaluation> = {}): Evaluation =>
  ({ id, questionId, messageId: "m", scores: [], notes: "", verdict: "passed",
     submittedAt: "2026-06-10T00:00:00Z", autoScore: 8, ...extra }) as Evaluation;

const questions = [
  { id: "q1", title: "题一", targetEmployeeId: "aria" },
  { id: "q2", title: "题二", targetEmployeeId: "aria" },
  { id: "q3", title: "题三" },
] as unknown as Question[];
const employees = [{ id: "aria", name: "Aria" }] as unknown as StandardEmployee[];
const profiles = [{ id: "j1", name: "Judge-1" }] as unknown as AgentProfile[];

describe("buildBatchResultRows", () => {
  it("按 entries 顺序成行,解析 eval/员工/裁判", () => {
    const evals = [ev("e1", "q1", { judgeProfileId: "j1", autoScore: 9, verdict: "passed" })];
    const last: LastBatchJudge = {
      ranAt: "2026-06-10T00:00:00Z",
      entries: [
        { questionId: "q1", messageId: "m1", evaluationId: "e1" },
        { questionId: "q2", messageId: "m2", evaluationId: null },
      ],
      judgeProfileIds: ["j1"],
      mode: "skip",
    };
    const rows = buildBatchResultRows(last, evals, questions, employees, profiles);
    expect(rows.map((r) => r.questionId)).toEqual(["q1", "q2"]);
    expect(rows[0].missing).toBe(false);
    expect(rows[0].autoScore).toBe(9);
    expect(rows[0].verdict).toBe("passed");
    expect(rows[0].employeeName).toBe("Aria");
    expect(rows[0].judgeNames).toEqual(["Judge-1"]);
    expect(rows[0].questionTitle).toBe("题一");
    expect(rows[1].missing).toBe(true);
    expect(rows[1].evaluation).toBeNull();
    expect(rows[1].questionTitle).toBe("题二");
    expect(rows[1].employeeName).toBe("Aria");
  });

  it("多 trial 同题不塌缩:每个 trial 各自的 eval + 唯一 rowKey", () => {
    const evals = [
      ev("e1", "q1", { messageId: "m1", autoScore: 9, judgeProfileId: "j1" }),
      ev("e2", "q1", { messageId: "m2", autoScore: 6, verdict: "failed", judgeProfileId: "j1" }),
      ev("e3", "q1", { messageId: "m3", autoScore: 7.5, judgeProfileId: "j1" }),
    ];
    const last: LastBatchJudge = {
      ranAt: "t",
      entries: [
        { questionId: "q1", messageId: "m1", evaluationId: "e1", trialIndex: 0 },
        { questionId: "q1", messageId: "m2", evaluationId: "e2", trialIndex: 1 },
        { questionId: "q1", messageId: "m3", evaluationId: "e3", trialIndex: 2 },
      ],
      judgeProfileIds: ["j1"],
      mode: "redo",
    };
    const rows = buildBatchResultRows(last, evals, questions, employees, profiles);
    expect(rows).toHaveLength(3);
    // 三行各自的分数/判定,不再是同一条
    expect(rows.map((r) => r.autoScore)).toEqual([9, 6, 7.5]);
    expect(rows.map((r) => r.verdict)).toEqual(["passed", "failed", "passed"]);
    expect(rows.map((r) => r.trialIndex)).toEqual([0, 1, 2]);
    // rowKey 全局唯一(可用于弹窗选中/高亮)
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(3);
  });

  it("批量后单独重评(同 messageId 新 eval)→ 行显示最新结果,而非批次冻结的旧 eval", () => {
    const evals = [
      // 批次时的旧评测(分 6 失败)
      ev("e1", "q1", { messageId: "m1", autoScore: 6, verdict: "failed", submittedAt: "2026-06-10T00:00:00Z" }),
      // 事后重评:同一条回答(m1)的更新评测(分 9 通过,时间更晚)
      ev("e9", "q1", { messageId: "m1", autoScore: 9, verdict: "passed", submittedAt: "2026-06-12T00:00:00Z" }),
    ];
    const last: LastBatchJudge = {
      ranAt: "2026-06-10T00:00:00Z",
      entries: [{ questionId: "q1", messageId: "m1", evaluationId: "e1" }],
      judgeProfileIds: ["j1"],
      mode: "skip",
    };
    const rows = buildBatchResultRows(last, evals, questions, employees, profiles);
    expect(rows[0].autoScore).toBe(9);
    expect(rows[0].verdict).toBe("passed");
    expect(rows[0].evaluation?.id).toBe("e9");
  });

  it("evaluationId 指向已删除的 eval → missing", () => {
    const last: LastBatchJudge = {
      ranAt: "t",
      entries: [{ questionId: "q1", messageId: "m1", evaluationId: "gone" }],
      judgeProfileIds: [],
      mode: "skip",
    };
    const rows = buildBatchResultRows(last, [], questions, employees, profiles);
    expect(rows[0].missing).toBe(true);
  });

  it("多裁判 calibrationSnapshots → judgeNames 取全部", () => {
    const evals = [ev("e1", "q1", {
      calibrationSnapshots: [
        { judgeProfileId: "j1", scores: [], verdict: "passed", notes: "" },
        { judgeProfileId: "jX", scores: [], verdict: "failed", notes: "" },
      ],
    } as Partial<Evaluation>)];
    const last: LastBatchJudge = {
      ranAt: "t",
      entries: [{ questionId: "q1", messageId: "m1", evaluationId: "e1" }],
      judgeProfileIds: ["j1", "jX"],
      mode: "redo",
    };
    const rows = buildBatchResultRows(last, evals, questions, employees, profiles);
    expect(rows[0].judgeNames).toEqual(["Judge-1", "jX"]);
  });
});
