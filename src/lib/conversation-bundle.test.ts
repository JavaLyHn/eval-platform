import { describe, expect, it } from "vitest";
import {
  applyConversationBundle,
  buildConversationBundle,
  CONVERSATION_BUNDLE_KIND,
  CONVERSATION_BUNDLE_VERSION,
  parseConversationBundle,
} from "./conversation-bundle";
import type { Conversation, Evaluation, Question, StandardEmployee } from "@/types";

/* ------------------------------ fixtures ------------------------------ */

function q(id: string, title: string, prompt = `prompt-${id}`): Question {
  return { id, title, prompt } as Question;
}
function msg(id: string, questionId: string, role: "user" | "assistant" = "assistant"): Conversation["messages"][number] {
  return { id, role, content: `c-${id}`, questionId, createdAt: "2026-01-01T00:00:00Z" } as Conversation["messages"][number];
}
function ev(id: string, questionId: string, messageId: string): Evaluation {
  return {
    id,
    questionId,
    messageId,
    scores: [],
    notes: "",
    verdict: "passed",
    submittedAt: "2026-01-01T00:00:00Z",
  } as Evaluation;
}
function conv(): Conversation {
  return {
    id: "conv-1",
    title: "A-235 超长文本截断",
    activeQuestionId: "q1",
    gatewaySessionId: "sess-xyz",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    pinned: true,
    messages: [
      { ...msg("m1", "q1", "user") },
      { ...msg("m2", "q1", "assistant"), isStreaming: true } as Conversation["messages"][number],
      msg("m3", "q2", "user"),
      msg("m4", "q2", "assistant"),
    ],
  } as Conversation;
}

/** 确定性 id 生成器(加 new- 前缀,与 fixture 原始 id 命名空间隔离,避免巧合撞车)。 */
function counterIds() {
  const counts: Record<string, number> = {};
  return (prefix = "id") => {
    counts[prefix] = (counts[prefix] ?? 0) + 1;
    return `new-${prefix}-${counts[prefix]}`;
  };
}

/* ------------------------------ build -------------------------------- */

describe("buildConversationBundle", () => {
  const allQ = [q("q1", "题一"), q("q2", "题二"), q("q3", "无关题")];
  const allE = [ev("e1", "q1", "m2"), ev("e2", "q2", "m4"), ev("e3", "q9", "m99")];

  it("只收会话引用到的题目 + messageId 命中的评测", () => {
    const b = buildConversationBundle(conv(), allQ, allE, "2026-07-27T00:00:00Z");
    expect(b.kind).toBe(CONVERSATION_BUNDLE_KIND);
    expect(b.version).toBe(CONVERSATION_BUNDLE_VERSION);
    expect(b.questions.map((x) => x.id).sort()).toEqual(["q1", "q2"]); // 不含无关 q3
    expect(b.evaluations.map((x) => x.id).sort()).toEqual(["e1", "e2"]); // 不含 m99 的 e3
  });

  it("清洗:gatewaySessionId 置空、去掉 pinned、清 isStreaming", () => {
    const b = buildConversationBundle(conv(), allQ, allE, "2026-07-27T00:00:00Z");
    expect(b.conversation.gatewaySessionId).toBeNull();
    expect(b.conversation.pinned).toBeUndefined();
    expect(b.conversation.messages.every((m) => !m.isStreaming)).toBe(true);
  });
});

/* ------------------------------ parse -------------------------------- */

describe("parseConversationBundle", () => {
  it("接受合法包", () => {
    const b = buildConversationBundle(conv(), [q("q1", "题一")], [], "2026-07-27T00:00:00Z");
    const r = parseConversationBundle(JSON.stringify(b));
    expect(r.ok).toBe(true);
  });
  it("拒绝非 JSON / 错 kind / 高版本 / 结构损坏", () => {
    expect(parseConversationBundle("{not json").ok).toBe(false);
    expect(parseConversationBundle(JSON.stringify({ kind: "other", version: 1 })).ok).toBe(false);
    expect(
      parseConversationBundle(
        JSON.stringify({ kind: CONVERSATION_BUNDLE_KIND, version: 999, conversation: { messages: [] }, questions: [], evaluations: [] }),
      ).ok,
    ).toBe(false);
    expect(
      parseConversationBundle(
        JSON.stringify({ kind: CONVERSATION_BUNDLE_KIND, version: 1, conversation: {}, questions: [], evaluations: [] }),
      ).ok,
    ).toBe(false);
  });
});

/* ------------------------------ apply -------------------------------- */

describe("applyConversationBundle", () => {
  const bundle = buildConversationBundle(
    conv(),
    [q("q1", "题一"), q("q2", "题二")],
    [ev("e1", "q1", "m2"), ev("e2", "q2", "m4")],
    "2026-07-27T00:00:00Z",
  );

  it("round-trip 到空库:题/轨迹/评测齐全且引用不断", () => {
    const r = applyConversationBundle(bundle, { questions: [], evaluations: [] }, { newId: counterIds(), now: "2026-08-01T00:00:00Z" });
    expect(r.addedQuestions).toBe(2);
    expect(r.reusedQuestions).toBe(0);
    expect(r.evaluationCount).toBe(2);
    // 每条评测的 messageId 都指向会话里真实存在的消息;questionId 指向已合并的题。
    const msgIds = new Set(r.conversation.messages.map((m) => m.id));
    const qIds = new Set(r.questions.map((x) => x.id));
    for (const e of r.evaluations) {
      expect(msgIds.has(e.messageId)).toBe(true);
      expect(qIds.has(e.questionId)).toBe(true);
    }
    // 会话内每条带 questionId 的消息,其题都在合并库里。
    for (const m of r.conversation.messages) {
      if (m.questionId) expect(qIds.has(m.questionId)).toBe(true);
    }
    expect(r.conversation.updatedAt).toBe("2026-08-01T00:00:00Z"); // 冒到顶部
    expect(r.conversation.createdAt).toBe("2026-01-01T00:00:00Z"); // 真实创建时间保留
    expect(r.conversation.gatewaySessionId).toBeNull();
  });

  it("撞内容的题复用已有 id、不新增,且消息/评测链到已有题", () => {
    const existing = q("EXIST", "题一", "prompt-q1"); // 与 bundle 里 q1 内容一致(title+prompt)
    const r = applyConversationBundle(bundle, { questions: [existing], evaluations: [] }, { newId: counterIds(), now: "2026-08-01T00:00:00Z" });
    expect(r.reusedQuestions).toBe(1); // q1 复用
    expect(r.addedQuestions).toBe(1); // q2 新增
    // q1 相关的消息/评测应链到既有的 EXIST,而不是新 id。
    const q1Eval = r.evaluations.find((e) => e.messageId === r.conversation.messages[1].id);
    expect(q1Eval?.questionId).toBe("EXIST");
    expect(r.questions.some((x) => x.id === "EXIST")).toBe(true);
    // 未重复新增 q1。
    expect(r.questions.filter((x) => questionSig(x) === "题一").length).toBe(1);
  });

  it("与已有会话/消息 id 相同也不撞:一律分配全新 id", () => {
    // 库里已有一个 id=conv-1 的会话 & 一条 id=m2 的评测锚点(用题/评测模拟)。
    const r = applyConversationBundle(bundle, { questions: [], evaluations: [ev("old", "q1", "m2")] }, { newId: counterIds(), now: "2026-08-01T00:00:00Z" });
    expect(r.conversation.id).not.toBe("conv-1");
    expect(r.conversation.messages.map((m) => m.id)).not.toContain("m2");
    // 新评测的 messageId 全是新 id,不会错挂到库里旧的 m2。
    for (const e of r.evaluations) expect(e.messageId).not.toBe("m2");
  });
});

/** 测试内联的内容指纹(与实现同口径的简化版,仅用于断言"没有重复题")。 */
function questionSig(x: Question): string {
  return x.title;
}

/* -------------- 跨环境重锚定 agentProfileId(线上→本机导入 bug) ------------ */

describe("applyConversationBundle 跨环境重锚定 agentProfileId", () => {
  const FOREIGN = "prod-prof-dex"; // 源端(线上)profile id,本机不存在
  const bundle = buildConversationBundle(
    {
      id: "c9",
      title: "Dex 全量",
      activeQuestionId: "qr",
      gatewaySessionId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      messages: [
        { id: "u1", role: "user", content: "q", questionId: "qr", createdAt: "2026-01-01T00:00:00Z", agentProfileId: FOREIGN },
        { id: "a1", role: "assistant", content: "a", questionId: "qr", createdAt: "2026-01-01T00:00:01Z", agentProfileId: FOREIGN },
      ],
    } as Conversation,
    [{ id: "qr", title: "题R", prompt: "p", targetEmployeeId: "emp-dex" } as Question],
    [{ id: "e1", questionId: "qr", messageId: "a1", scores: [], notes: "", verdict: "passed", submittedAt: "2026-01-01T00:00:02Z", agentProfileId: FOREIGN } as Evaluation],
    "2026-07-27T00:00:00Z",
  );
  const employees = [{ id: "emp-dex", name: "Dex", associatedProfileId: "local-prof-dex" } as StandardEmployee];

  it("给了员工上下文 → 消息/评测 agentProfileId 重锚定到本机该员工 profile", () => {
    const r = applyConversationBundle(bundle, { questions: [], evaluations: [] }, {
      newId: counterIds(), now: "2026-08-01T00:00:00Z", employees, employeeProfileMap: {},
    });
    expect(r.conversation.messages.every((m) => m.agentProfileId === "local-prof-dex")).toBe(true);
    expect(r.evaluations.every((e) => e.agentProfileId === "local-prof-dex")).toBe(true);
  });

  it("employeeProfileMap 显式关联优先于 associatedProfileId", () => {
    const r = applyConversationBundle(bundle, { questions: [], evaluations: [] }, {
      newId: counterIds(), now: "2026-08-01T00:00:00Z", employees, employeeProfileMap: { "emp-dex": "mapped-prof" },
    });
    expect(r.conversation.messages.every((m) => m.agentProfileId === "mapped-prof")).toBe(true);
  });

  it("没给员工上下文 → 保持源 agentProfileId(向后兼容)", () => {
    const r = applyConversationBundle(bundle, { questions: [], evaluations: [] }, {
      newId: counterIds(), now: "2026-08-01T00:00:00Z",
    });
    expect(r.conversation.messages.every((m) => m.agentProfileId === FOREIGN)).toBe(true);
  });

  it("目标端未配置该员工(无 profile) → 不强改,保持原样", () => {
    const r = applyConversationBundle(bundle, { questions: [], evaluations: [] }, {
      newId: counterIds(), now: "2026-08-01T00:00:00Z",
      employees: [{ id: "emp-dex", name: "Dex" } as StandardEmployee],
      employeeProfileMap: {},
    });
    expect(r.conversation.messages.every((m) => m.agentProfileId === FOREIGN)).toBe(true);
  });
});
