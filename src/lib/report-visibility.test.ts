import { describe, it, expect } from "vitest";
import { reportVisibleTo } from "./report-visibility";
import type { EvaluationReport, UserProfile } from "@/types";

function makeReport(owner?: EvaluationReport["owner"]): EvaluationReport {
  return {
    id: "r1",
    createdAt: "2026-06-01T00:00:00.000Z",
    title: "t",
    agentProfileId: "p1",
    agentName: "Aria",
    items: [],
    ...(owner ? { owner } : {}),
  };
}

const aria: UserProfile = { name: "Aria", email: "aria@x.com" };

describe("reportVisibleTo", () => {
  it("无主报告对所有人可见(含空用户)", () => {
    const r = makeReport(undefined);
    expect(reportVisibleTo(r, aria)).toBe(true);
    expect(reportVisibleTo(r, { name: "" })).toBe(true);
  });

  it("姓名匹配 → 可见(忽略大小写/空格)", () => {
    const r = makeReport({ name: "Aria" });
    expect(reportVisibleTo(r, { name: "  aria " })).toBe(true);
  });

  it("姓名不同且无邮箱 → 不可见", () => {
    const r = makeReport({ name: "Bob" });
    expect(reportVisibleTo(r, { name: "Aria" })).toBe(false);
  });

  it("邮箱匹配 → 可见(即使姓名不同)", () => {
    const r = makeReport({ name: "Bob", email: "aria@x.com" });
    expect(reportVisibleTo(r, aria)).toBe(true);
  });

  it("有主报告,但当前用户没设姓名/邮箱 → 不可见", () => {
    const r = makeReport({ name: "Aria" });
    expect(reportVisibleTo(r, { name: "" })).toBe(false);
  });

  it("姓名相同但邮箱都非空且不同 → 仍按姓名放行(宽松 OR)", () => {
    const r = makeReport({ name: "Aria", email: "aria@old.com" });
    expect(reportVisibleTo(r, { name: "Aria", email: "aria@new.com" })).toBe(
      true,
    );
  });
});
