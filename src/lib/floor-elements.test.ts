import { describe, it, expect } from "vitest";
import {
  FLOOR_CATEGORY_LAYER,
  FLOOR_CATEGORY_LABELS,
  layerOf,
  deriveSeedCandidates,
  normalizeFloorTitle,
  dedupeFloorCandidates,
  type FloorCandidate,
} from "./floor-elements";
import type { StandardEmployee } from "@/types";

// 最小可用的员工桩：只填 deriveSeedCandidates 用到的字段。
const aria = {
  id: "aria",
  name: "Aria",
  outOfScope: "不做客服 / 法务 / 财务",
  specificMetricTemplates: [
    {
      key: "aria.copy-deliverability",
      label: "文案能不能发出去",
      description: "x",
      passFormHint: "≥95% 成功发布",
      failFormHint: "只生成不发布",
    },
  ],
} as unknown as StandardEmployee;

describe("floor-elements", () => {
  it("category→layer：前5个 L1、后5个 L2", () => {
    expect(layerOf("master-data")).toBe("L1");
    expect(layerOf("eval-data")).toBe("L1");
    expect(layerOf("permission-identity")).toBe("L2");
    expect(layerOf("audit-security")).toBe("L2");
    expect(Object.keys(FLOOR_CATEGORY_LAYER)).toHaveLength(10);
  });

  it("metric 模板 → 种子候选（带 sourceMetricKey、passForm 抄 hint）", () => {
    const cands = deriveSeedCandidates(aria);
    const fromMetric = cands.find(
      (c) => c.sourceMetricKey === "aria.copy-deliverability",
    );
    expect(fromMetric).toBeTruthy();
    expect(fromMetric!.source).toBe("seed");
    expect(fromMetric!.passForm).toBe("≥95% 成功发布");
    expect(fromMetric!.failForm).toBe("只生成不发布");
    expect(fromMetric!.employeeId).toBe("aria");
    expect(fromMetric!.isRedLine).toBe(false);
  });

  it("outOfScope → 一条 permission-identity 边界候选", () => {
    const cands = deriveSeedCandidates(aria);
    const boundary = cands.find((c) => c.category === "permission-identity");
    expect(boundary).toBeTruthy();
    expect(boundary!.layer).toBe("L2");
    expect(boundary!.failForm).toContain("不做客服");
  });

  it("红线安全种子：隐私/偏见/毒性/注入，全部 isRedLine 且 audit-security", () => {
    const cands = deriveSeedCandidates(aria);
    const redlines = cands.filter((c) => c.isRedLine);
    expect(redlines.length).toBeGreaterThanOrEqual(4);
    for (const r of redlines) {
      expect(r.category).toBe("audit-security");
      expect(r.layer).toBe("L2");
    }
  });

  it("候选不带 id/createdAt（入库时才分配）", () => {
    const cands = deriveSeedCandidates(aria);
    for (const c of cands) {
      expect("id" in c).toBe(false);
      expect("createdAt" in c).toBe(false);
    }
  });

  it("FLOOR_CATEGORY_LABELS 覆盖全部 10 个分类且与 layer 表键一致", () => {
    expect(Object.keys(FLOOR_CATEGORY_LABELS)).toHaveLength(10);
    expect(Object.keys(FLOOR_CATEGORY_LABELS).sort()).toEqual(
      Object.keys(FLOOR_CATEGORY_LAYER).sort(),
    );
  });
});

describe("normalizeFloorTitle / dedupeFloorCandidates", () => {
  const cand = (employeeId: string, title: string): FloorCandidate => ({
    employeeId,
    layer: "L2",
    category: "business-rules",
    title,
    passForm: "p",
    failForm: "f",
    isRedLine: false,
    source: "llm",
  });

  it("normalizeFloorTitle 去空格、压空白、转小写", () => {
    expect(normalizeFloorTitle("  Hello   World ")).toBe("hello world");
  });

  it("与现有同标题（忽略大小写/空格）→ 剔除", () => {
    const existing = [{ employeeId: "aria", title: "不泄露隐私" }];
    const out = dedupeFloorCandidates(existing, [
      cand("aria", "  不泄露隐私 "),
      cand("aria", "新要素"),
    ]);
    expect(out.map((c) => c.title)).toEqual(["新要素"]);
  });

  it("不同员工同标题 → 保留（按员工分）", () => {
    const existing = [{ employeeId: "aria", title: "X" }];
    const out = dedupeFloorCandidates(existing, [cand("sam", "X")]);
    expect(out).toHaveLength(1);
  });

  it("本批内部重复只留第一条", () => {
    const out = dedupeFloorCandidates(
      [],
      [cand("aria", "重复"), cand("aria", "重复"), cand("aria", "唯一")],
    );
    expect(out.map((c) => c.title)).toEqual(["重复", "唯一"]);
  });

  it("existing 为空 → 全保留", () => {
    const out = dedupeFloorCandidates(
      [],
      [cand("aria", "a"), cand("aria", "b")],
    );
    expect(out).toHaveLength(2);
  });
});

describe("deriveSeedCandidates(metrics 参数)", () => {
  const emp = {
    id: "aria",
    name: "Aria",
    outOfScope: "不做客服",
    specificMetricTemplates: [
      { key: "aria.builtin", label: "内置指标", passFormHint: "p", failFormHint: "f" },
    ],
  } as unknown as Parameters<typeof deriveSeedCandidates>[0];

  it("不传 metrics → 用 employee.specificMetricTemplates(向后兼容)", () => {
    const out = deriveSeedCandidates(emp);
    expect(out.some((c) => c.title === "内置指标" && c.sourceMetricKey === "aria.builtin")).toBe(true);
  });

  it("传入解析后的指标 → 种子反映传入的(含自定义),而非内置原表", () => {
    const out = deriveSeedCandidates(emp, [
      { key: "aria.custom-x", label: "自定义指标", passFormHint: "pp", failFormHint: "ff" },
    ]);
    expect(out.some((c) => c.title === "自定义指标" && c.sourceMetricKey === "aria.custom-x")).toBe(true);
    expect(out.some((c) => c.title === "内置指标")).toBe(false); // 内置原表未被使用
  });

  it("显式空 metrics → 无指标种子,但仍保留红线 + outOfScope 种子", () => {
    const out = deriveSeedCandidates(emp, []);
    expect(out.every((c) => c.category !== "eval-data")).toBe(true); // 无 metric 派生项
    expect(out.some((c) => c.isRedLine)).toBe(true);                 // 红线种子仍在
    expect(out.some((c) => c.category === "permission-identity")).toBe(true); // outOfScope 种子仍在
  });
});
