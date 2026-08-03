import { describe, it, expect } from "vitest";
import {
  EMPTY_OVERLAY,
  resolveEmployeeMetrics,
  hiddenBuiltins,
  normalizeMetricLabel,
  dedupeMetricInits,
} from "./employee-metrics";
import type { EmployeeMetricsOverlay, EmployeeMetricTemplate } from "@/types";

const builtins: EmployeeMetricTemplate[] = [
  { key: "a.one", label: "指标一", description: "d1", passFormHint: "p1", failFormHint: "f1" },
  { key: "a.two", label: "指标二", description: "d2" },
];

describe("resolveEmployeeMetrics", () => {
  it("无 overlay → 原样返回内置,origin=builtin,edited=false", () => {
    const out = resolveEmployeeMetrics(builtins, undefined);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ key: "a.one", label: "指标一", origin: "builtin", edited: false });
    expect(out[1].origin).toBe("builtin");
  });

  it("override 改了字段 → 合并 + edited=true", () => {
    const ov: EmployeeMetricsOverlay = {
      overrides: { "a.one": { label: "改名", passFormHint: "新P" } },
      hiddenKeys: [],
      custom: [],
    };
    const out = resolveEmployeeMetrics(builtins, ov);
    expect(out[0].label).toBe("改名");
    expect(out[0].passFormHint).toBe("新P");
    expect(out[0].description).toBe("d1"); // 未改字段沿用
    expect(out[0].edited).toBe(true);
  });

  it("override 与原值相同 → edited=false", () => {
    const ov: EmployeeMetricsOverlay = {
      overrides: { "a.one": { label: "指标一" } },
      hiddenKeys: [],
      custom: [],
    };
    expect(resolveEmployeeMetrics(builtins, ov)[0].edited).toBe(false);
  });

  it("hiddenKeys 内置被剔除,且出现在 hiddenBuiltins", () => {
    const ov: EmployeeMetricsOverlay = { overrides: {}, hiddenKeys: ["a.one"], custom: [] };
    const out = resolveEmployeeMetrics(builtins, ov);
    expect(out.map((m) => m.key)).toEqual(["a.two"]);
    expect(hiddenBuiltins(builtins, ov).map((m) => m.key)).toEqual(["a.one"]);
  });

  it("custom 追加在内置之后,origin=custom", () => {
    const ov: EmployeeMetricsOverlay = {
      overrides: {},
      hiddenKeys: [],
      custom: [{ key: "a.custom-x", label: "自定义", description: "dc" }],
    };
    const out = resolveEmployeeMetrics(builtins, ov);
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ key: "a.custom-x", origin: "custom", edited: false });
  });
});

describe("normalizeMetricLabel", () => {
  it("去空白 + 压缩 + 小写", () => {
    expect(normalizeMetricLabel("  Foo   Bar ")).toBe("foo bar");
  });
});

describe("dedupeMetricInits", () => {
  it("剔除与已有 label 重复 + 本批内部重复 + 空 label", () => {
    const out = dedupeMetricInits(["已有指标"], [
      { label: "已有指标", description: "x" },
      { label: "新指标", description: "y" },
      { label: "新指标", description: "z" }, // 批内重复
      { label: "   ", description: "w" }, // 空
    ]);
    expect(out.map((m) => m.label)).toEqual(["新指标"]);
  });
});

describe("EMPTY_OVERLAY", () => {
  it("EMPTY_OVERLAY 三个字段都空", () => {
    expect(EMPTY_OVERLAY).toEqual({ overrides: {}, hiddenKeys: [], custom: [] });
  });
});

describe("hiddenBuiltins", () => {
  it("hiddenKeys 含不存在的 key → 安全忽略,返回 []", () => {
    expect(hiddenBuiltins(builtins, { overrides: {}, hiddenKeys: ["nope"], custom: [] })).toEqual([]);
  });
});

describe("dedupeMetricInits — additional", () => {
  it("existingLabels 为空 → 仅做批内去重", () => {
    const out = dedupeMetricInits([], [
      { label: "X", description: "1" },
      { label: "X", description: "2" },
    ]);
    expect(out.map((m) => m.label)).toEqual(["X"]);
  });
});
