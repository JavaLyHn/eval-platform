import { describe, it, expect } from "vitest";
import { resolveEmployeeForProfile, agentMatchesEmployee } from "./employee-resolve";
import type { AgentProfile } from "@/agents/types";
import type { StandardEmployee } from "@/types";

const emp = (
  id: string,
  name: string,
  associatedProfileId?: string,
): StandardEmployee =>
  ({ id, name, ...(associatedProfileId ? { associatedProfileId } : {}) }) as StandardEmployee;

const profile = (id: string, name: string): AgentProfile =>
  ({ id, name, providerId: "platform", config: {}, createdAt: "t" }) as AgentProfile;

const employees = [emp("aria", "Aria"), emp("sam", "Sam"), emp("dex", "Dex")];

describe("resolveEmployeeForProfile", () => {
  it("空 profileId → null", () => {
    expect(resolveEmployeeForProfile(null, [], employees, {})).toBeNull();
    expect(resolveEmployeeForProfile(undefined, [], employees, {})).toBeNull();
  });

  it("employeeProfileMap 显式关联命中", () => {
    const got = resolveEmployeeForProfile("p1", [profile("p1", "随便起的名")], employees, {
      aria: "p1",
    });
    expect(got?.id).toBe("aria");
  });

  it("员工自带 associatedProfileId 命中", () => {
    const emps = [emp("sam", "Sam", "p9")];
    const got = resolveEmployeeForProfile("p9", [profile("p9", "x")], emps, {});
    expect(got?.id).toBe("sam");
  });

  it("关联优先于名字匹配", () => {
    // profile 名字像 Aria,但显式关联到了 sam → 取 sam
    const got = resolveEmployeeForProfile("p1", [profile("p1", "Aria（PLATFORM）")], employees, {
      sam: "p1",
    });
    expect(got?.id).toBe("sam");
  });

  it("名字兜底:profile 名含员工名(忽略大小写)", () => {
    const got = resolveEmployeeForProfile("p1", [profile("p1", "aria（PLATFORM）")], employees, {});
    expect(got?.id).toBe("aria");
  });

  it("名字不含任何员工名 → null", () => {
    const got = resolveEmployeeForProfile("p1", [profile("p1", "unknown agent")], employees, {});
    expect(got).toBeNull();
  });

  it("多名命中取最长(避免短名误伤)", () => {
    const emps = [emp("al", "Al"), emp("aria", "Aria")];
    const got = resolveEmployeeForProfile("p1", [profile("p1", "Aria 测试")], emps, {});
    expect(got?.id).toBe("aria");
  });
});

describe("agentMatchesEmployee", () => {
  it("profile 名含员工名(忽略大小写)→ true", () => {
    expect(agentMatchesEmployee(profile("p1", "Aria（PLATFORM）"), emp("aria", "Aria"))).toBe(true);
    expect(agentMatchesEmployee(profile("p1", "aria-01"), emp("aria", "Aria"))).toBe(true);
  });

  it("名称不对应 → false(不可关联)", () => {
    expect(agentMatchesEmployee(profile("p1", "Sam-01"), emp("aria", "Aria"))).toBe(false);
    expect(agentMatchesEmployee(profile("p1", "unknown agent"), emp("aria", "Aria"))).toBe(false);
  });

  it("员工名为空 → false", () => {
    expect(agentMatchesEmployee(profile("p1", "Aria"), emp("x", ""))).toBe(false);
  });
});
