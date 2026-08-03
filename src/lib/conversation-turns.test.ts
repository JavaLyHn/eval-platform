import { describe, expect, it } from "vitest";
import { answeredTurns, latestAnsweredTurn, answeredTurnsByTrial } from "./conversation-turns";
import type { ChatMessage } from "@/types";

function u(id: string, qid: string, content: string): ChatMessage {
  return { id, role: "user", content, questionId: qid, createdAt: "2026-06-03T00:00:00Z" };
}
function a(id: string, qid: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: "assistant", content, questionId: qid, createdAt: "2026-06-03T00:00:00Z", ...extra };
}

describe("answeredTurns", () => {
  it("配对 user→assistant", () => {
    const msgs = [u("u1", "q1", "问1"), a("a1", "q1", "答1")];
    const t = answeredTurns(msgs, "q1");
    expect(t).toHaveLength(1);
    expect(t[0].userPrompt).toBe("问1");
    expect(t[0].assistant.id).toBe("a1");
  });
  it("多回合:全部按序返回", () => {
    const msgs = [u("u1", "q1", "问1"), a("a1", "q1", "答1"), u("u2", "q1", "问2"), a("a2", "q1", "答2")];
    expect(answeredTurns(msgs, "q1").map((x) => x.assistant.id)).toEqual(["a1", "a2"]);
  });
  it("跳过 streaming 的 assistant", () => {
    const msgs = [u("u1", "q1", "问1"), a("a1", "q1", "", { isStreaming: true })];
    expect(answeredTurns(msgs, "q1")).toEqual([]);
  });
  it("只取该题、别题打断 pending", () => {
    const msgs = [u("u1", "q1", "问1"), u("uX", "q2", "别题"), a("aX", "q2", "别答"), a("a1", "q1", "答1")];
    expect(answeredTurns(msgs, "q1")).toEqual([]);
  });
});

describe("latestAnsweredTurn", () => {
  it("取最新一个回合", () => {
    const msgs = [u("u1", "q1", "问1"), a("a1", "q1", "答1"), u("u2", "q1", "问2"), a("a2", "q1", "答2")];
    expect(latestAnsweredTurn(msgs, "q1")?.assistant.id).toBe("a2");
  });
  it("无回答 → null", () => {
    expect(latestAnsweredTurn([], "q1")).toBeNull();
  });
});

const mk = (
  id: string,
  role: "user" | "assistant",
  questionId: string,
  trialIndex?: number,
): ChatMessage => ({
  id,
  role,
  content: id,
  questionId,
  ...(trialIndex != null ? { trialIndex } : {}),
  createdAt: "2026-07-25T00:00:00.000Z",
});

describe("answeredTurnsByTrial", () => {
  it("按 trialIndex 把同题回合分组(每 trial 各自的多轮)", () => {
    // trial0: u0/a0, u1/a1 ; trial1: u2/a2, u3/a3
    const msgs: ChatMessage[] = [
      mk("u0", "user", "q1", 0), mk("a0", "assistant", "q1", 0),
      mk("u1", "user", "q1", 0), mk("a1", "assistant", "q1", 0),
      mk("u2", "user", "q1", 1), mk("a2", "assistant", "q1", 1),
      mk("u3", "user", "q1", 1), mk("a3", "assistant", "q1", 1),
    ];
    const m = answeredTurnsByTrial(msgs, "q1");
    expect(m.get(0)?.map((t) => t.assistant.id)).toEqual(["a0", "a1"]);
    expect(m.get(1)?.map((t) => t.assistant.id)).toEqual(["a2", "a3"]);
  });

  it("非多 trial(无 trialIndex)归到 key=-1 的单组", () => {
    const msgs: ChatMessage[] = [
      mk("u0", "user", "q1"), mk("a0", "assistant", "q1"),
      mk("u1", "user", "q1"), mk("a1", "assistant", "q1"),
    ];
    const m = answeredTurnsByTrial(msgs, "q1");
    expect(m.get(-1)?.map((t) => t.assistant.id)).toEqual(["a0", "a1"]);
  });
});
