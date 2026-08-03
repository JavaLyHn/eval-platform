import { describe, it, expect } from "vitest";
import { judgeIsolationLevel } from "./judge-isolation";

const judge = (id: string, providerId: string) => ({ id, providerId });

describe("judgeIsolationLevel", () => {
  it("judge 与被测同一 profile → self", () => {
    expect(judgeIsolationLevel(judge("p1", "anthropic"), "p1", "anthropic")).toBe("self");
  });

  it("不同 profile、同供应商 → same-provider", () => {
    expect(judgeIsolationLevel(judge("p2", "anthropic"), "p1", "anthropic")).toBe("same-provider");
  });

  it("不同 profile、不同供应商 → ok", () => {
    expect(judgeIsolationLevel(judge("p2", "openai-compat"), "p1", "anthropic")).toBe("ok");
  });

  it("无 subjectProfileId 但同供应商 → same-provider", () => {
    expect(judgeIsolationLevel(judge("p2", "anthropic"), null, "anthropic")).toBe("same-provider");
  });

  it("subjectProfileId 与 providerId 均为 null → ok", () => {
    expect(judgeIsolationLevel(judge("p2", "anthropic"), null, null)).toBe("ok");
  });
});
