import { describe, it, expect } from "vitest";
import {
  selectConfiguredEmployeeIds,
  isEmployeeConfigured,
  reconcileEmployeeProfileMap,
} from "./employee-visibility";

const EMPS = [{ id: "aria" }, { id: "sam" }, { id: "dex" }];

describe("selectConfiguredEmployeeIds", () => {
  it("解析出的 profile 属于自有 → 计入", () => {
    const resolve = (id: string) => (id === "aria" ? "p-aria" : null);
    const owned = new Set(["p-aria", "p-other"]);
    expect(selectConfiguredEmployeeIds(EMPS, resolve, owned)).toEqual(["aria"]);
  });

  it("解析出的 profile 不属于自有(陈旧绑定)→ 不计入", () => {
    const resolve = (id: string) => (id === "aria" ? "p-stale" : null);
    const owned = new Set(["p-other"]);
    expect(selectConfiguredEmployeeIds(EMPS, resolve, owned)).toEqual([]);
  });

  it("全部未解析 → 空", () => {
    expect(selectConfiguredEmployeeIds(EMPS, () => null, new Set())).toEqual([]);
  });

  it("多个命中,保持 employees 顺序", () => {
    const resolve = (id: string) =>
      id === "aria" ? "p1" : id === "dex" ? "p2" : null;
    const owned = new Set(["p1", "p2"]);
    expect(selectConfiguredEmployeeIds(EMPS, resolve, owned)).toEqual([
      "aria",
      "dex",
    ]);
  });
});

describe("isEmployeeConfigured", () => {
  const owned = new Set(["p-aria"]);
  const resolve = (id: string) => (id === "aria" ? "p-aria" : null);
  it("命中 → true", () => {
    expect(isEmployeeConfigured("aria", resolve, owned)).toBe(true);
  });
  it("未命中 → false", () => {
    expect(isEmployeeConfigured("sam", resolve, owned)).toBe(false);
  });
  it("resolver 返回 null → false", () => {
    expect(isEmployeeConfigured("aria", () => null, new Set(["p-aria"]))).toBe(false);
  });
});

describe("reconcileEmployeeProfileMap", () => {
  it("服务器非空 → 用服务器值,不迁移", () => {
    const r = reconcileEmployeeProfileMap({ aria: "local" }, { aria: "srv" });
    expect(r).toEqual({ map: { aria: "srv" }, migrate: false });
  });

  it("服务器空、本地非空 → 用本地值,迁移", () => {
    const r = reconcileEmployeeProfileMap({ aria: "local" }, {});
    expect(r).toEqual({ map: { aria: "local" }, migrate: true });
  });

  it("服务器 null(拉取失败)、本地非空 → 用本地,迁移", () => {
    const r = reconcileEmployeeProfileMap({ aria: "local" }, null);
    expect(r).toEqual({ map: { aria: "local" }, migrate: true });
  });

  it("两者皆空 → 空,不迁移", () => {
    expect(reconcileEmployeeProfileMap({}, {})).toEqual({ map: {}, migrate: false });
  });
});
