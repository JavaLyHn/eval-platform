import type {
  EmployeeMetricTemplate,
  EmployeeMetricsOverlay,
  MetricOverride,
} from "@/types";

export type MetricOrigin = "builtin" | "custom";

/** 解析后用于展示/派生的指标:带来源 + 是否被改写。 */
export interface ResolvedMetric extends EmployeeMetricTemplate {
  origin: MetricOrigin;
  /** 内置且被改写过(与内置原值不同);custom 永远 false。 */
  edited: boolean;
}

export const EMPTY_OVERLAY: EmployeeMetricsOverlay = {
  overrides: {},
  hiddenKeys: [],
  custom: [],
};

// 同 floor-elements.ts 的 normalizeFloorTitle(去重口径一致)。
/** 标签归一化(自定义指标去重口径)。 */
export function normalizeMetricLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 把改写并入内置原值,得到展示用的有效模板(只覆盖明确给出的字段)。 */
function applyOverride(
  base: EmployeeMetricTemplate,
  ov: MetricOverride | undefined,
): EmployeeMetricTemplate {
  if (!ov) return base;
  const next = { ...base };
  if (ov.label !== undefined) next.label = ov.label;
  if (ov.description !== undefined) next.description = ov.description;
  if (ov.passFormHint !== undefined) next.passFormHint = ov.passFormHint;
  if (ov.failFormHint !== undefined) next.failFormHint = ov.failFormHint;
  return next;
}

/** 改写是否实际改变了内置原值(决定 edited 标记)。 */
function overrideChangesBase(
  base: EmployeeMetricTemplate,
  ov: MetricOverride | undefined,
): boolean {
  if (!ov) return false;
  const merged = applyOverride(base, ov);
  return (
    merged.label !== base.label ||
    merged.description !== base.description ||
    (merged.passFormHint ?? "") !== (base.passFormHint ?? "") ||
    (merged.failFormHint ?? "") !== (base.failFormHint ?? "")
  );
}

/** 合并内置 + overlay → 展示用列表:先内置(去掉隐藏、并入改写),再自定义。 */
export function resolveEmployeeMetrics(
  builtins: EmployeeMetricTemplate[],
  overlay: EmployeeMetricsOverlay | undefined,
): ResolvedMetric[] {
  const ov = overlay ?? EMPTY_OVERLAY;
  const hidden = new Set(ov.hiddenKeys);
  const out: ResolvedMetric[] = [];
  for (const b of builtins) {
    if (hidden.has(b.key)) continue;
    const o = ov.overrides[b.key];
    out.push({ ...applyOverride(b, o), origin: "builtin", edited: overrideChangesBase(b, o) });
  }
  for (const c of ov.custom) {
    out.push({ ...c, origin: "custom", edited: false }); // custom 指标无内置原值可比,edited 恒为 false
  }
  return out;
}

/** 被隐藏的内置指标(供「恢复」用)。 */
export function hiddenBuiltins(
  builtins: EmployeeMetricTemplate[],
  overlay: EmployeeMetricsOverlay | undefined,
): EmployeeMetricTemplate[] {
  const hidden = new Set((overlay ?? EMPTY_OVERLAY).hiddenKeys);
  return builtins.filter((b) => hidden.has(b.key));
}

/**
 * 批量自定义指标去重:剔除 label 与 existingLabels(归一化后)重复的,
 * 以及本批内部重复、空 label。用于 AI 草拟 / 批量导入。保序。
 */
export function dedupeMetricInits(
  existingLabels: Iterable<string>,
  inits: Array<Omit<EmployeeMetricTemplate, "key">>,
): Array<Omit<EmployeeMetricTemplate, "key">> {
  const seen = new Set<string>();
  for (const l of existingLabels) seen.add(normalizeMetricLabel(l));
  const out: Array<Omit<EmployeeMetricTemplate, "key">> = [];
  for (const m of inits) {
    const k = normalizeMetricLabel(m.label);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}
