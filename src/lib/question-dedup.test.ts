import { describe, expect, it } from "vitest";
import { questionSignature, findDuplicateQuestion } from "./question-dedup";

describe("questionSignature", () => {
  it("内容相同(忽略空白差异)→ 同签名", () => {
    const a = { prompt: "帮我写个方案", subPrompts: ["再细化一下"] };
    const b = { prompt: "  帮我写个方案 ", subPrompts: ["再细化一下\n"] };
    expect(questionSignature(a)).toBe(questionSignature(b));
  });
  it("prompt 不同 → 不同签名", () => {
    expect(questionSignature({ prompt: "A" })).not.toBe(
      questionSignature({ prompt: "B" }),
    );
  });
  it("subPrompts 不同 → 不同签名(多轮题各轮算身份)", () => {
    expect(
      questionSignature({ prompt: "A", subPrompts: ["x"] }),
    ).not.toBe(questionSignature({ prompt: "A", subPrompts: ["x", "y"] }));
  });
  it("归属不同(员工/skill/kind)→ 不同签名", () => {
    expect(questionSignature({ prompt: "A", targetEmployeeId: "aria" })).not.toBe(
      questionSignature({ prompt: "A", targetEmployeeId: "sam" }),
    );
    expect(questionSignature({ prompt: "A", kind: "agent" })).not.toBe(
      questionSignature({ prompt: "A", kind: "skill" }),
    );
  });
  it("评分配置不同但题面相同 → 同签名(同一道题,不算新题)", () => {
    const a = { prompt: "A" } as Record<string, unknown>;
    const b = { prompt: "A", passForm: "做到X", criteria: [{ key: "acc" }] } as Record<string, unknown>;
    expect(questionSignature(a as never)).toBe(questionSignature(b as never));
  });
});

describe("findDuplicateQuestion", () => {
  const list = [
    { id: "q1", prompt: "今晚帮我发个帖", subPrompts: ["直接用我账号发"] },
    { id: "q2", prompt: "写句定位" },
  ];
  it("命中已存在的同内容题", () => {
    const dup = findDuplicateQuestion(list, {
      prompt: " 今晚帮我发个帖 ",
      subPrompts: ["直接用我账号发"],
    });
    expect(dup?.id).toBe("q1");
  });
  it("无同内容 → null", () => {
    expect(findDuplicateQuestion(list, { prompt: "全新的题" })).toBeNull();
  });
});
