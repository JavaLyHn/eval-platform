import { describe, expect, it } from "vitest";

import { EMPLOYEE_SCENARIOS, scenariosForEmployee } from "./employee-scenarios";
import { STANDARD_EMPLOYEE_IDS } from "./standard-employees";

describe("EMPLOYEE_SCENARIOS", () => {
  it("覆盖全部 标准员工,且每位 ≥8 条、无重复", () => {
    for (const id of STANDARD_EMPLOYEE_IDS) {
      const list = EMPLOYEE_SCENARIOS[id];
      expect(list, `缺 ${id} 的场景表`).toBeDefined();
      expect(list.length).toBeGreaterThanOrEqual(8);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("scenariosForEmployee:已知员工给表,未知/未选回 null", () => {
    expect(scenariosForEmployee("sam")).toEqual(EMPLOYEE_SCENARIOS.sam);
    expect(scenariosForEmployee("nobody")).toBeNull();
    expect(scenariosForEmployee(undefined)).toBeNull();
  });
});
