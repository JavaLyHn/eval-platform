import type { FailureAttribution, FailureCategory } from "@/types";

export interface FailureCategoryMeta {
  label: string;
  /** 修复方向(诊断提示)。 */
  fixHint: string;
  /** CSS 颜色(donut + 徽章共用)。 */
  color: string;
}

/** 固定顺序:遍历 / 图例用。 */
export const FAILURE_CATEGORIES: FailureCategory[] = [
  "knowledge",
  "tool",
  "param",
  "planning",
  "style",
  "safety",
];

export const FAILURE_CATEGORY_META: Record<FailureCategory, FailureCategoryMeta> = {
  knowledge: { label: "知识", fixHint: "补知识库 / 训练数据", color: "hsl(217 91% 60%)" },
  tool: { label: "工具", fixHint: "修工具调度 / 选型", color: "hsl(258 90% 66%)" },
  param: { label: "参数", fixHint: "修工具入参填充", color: "hsl(38 92% 50%)" },
  planning: { label: "规划", fixHint: "修步骤拆解 / 依赖", color: "hsl(173 80% 40%)" },
  style: { label: "风格", fixHint: "修语气 / 格式规范", color: "hsl(330 81% 60%)" },
  safety: { label: "安全", fixHint: "守红线 / 权限 / 脱敏", color: "hsl(0 84% 60%)" },
};

/** 未归因(饼图灰桶)。 */
export const UNATTRIBUTED_COLOR = "hsl(var(--muted-foreground) / 0.45)";

export const VALID_FAILURE_CATEGORIES = new Set<string>(FAILURE_CATEGORIES);

export function isFailureCategory(v: unknown): v is FailureCategory {
  return typeof v === "string" && VALID_FAILURE_CATEGORIES.has(v);
}

/** 次因清洗:仅合法类、去重、去掉 primary;空 → undefined。 */
export function cleanSecondary(
  primary: FailureCategory,
  secondary: unknown,
): FailureCategory[] | undefined {
  if (!Array.isArray(secondary)) return undefined;
  const out: FailureCategory[] = [];
  const seen = new Set<string>([primary]);
  for (const v of secondary) {
    if (isFailureCategory(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.length ? out : undefined;
}

/** 多数票;平票取在数组里首个出现的;全空 → null。 */
export function aggregatePrimary(
  cats: Array<FailureCategory | null | undefined>,
): FailureCategory | null {
  const counts = new Map<FailureCategory, number>();
  for (const c of cats) {
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: FailureCategory | null = null;
  let bestN = -1;
  for (const c of cats) {
    if (!c) continue;
    const n = counts.get(c)!;
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  return best;
}

/**
 * 组装最终归因:
 *  - 真踩红线(redLineViolated:裁判引用了该题的红线条款)→ 主因强制 safety
 *    (source=redline),judge 主因/次因降为次因(去重去 safety)。
 *  - 否则 judge 有主因 → source=judge + 清洗次因;judge 无主因 → null。
 *
 * 注意:redLineViolated 看的是「这次有没有真踩」(裁判引用了红线条款),而非
 * 「题挂没挂红线要素」。一道红线题若因别的原因失败(裁判未引用红线),应尊重
 * 裁判的实际归因,不再一律强制 safety —— 否则会把非红线失败贴错标签。
 * 返回对象不设置 note;调用方可在返回后另行附加(人工备注)。
 */
export function resolveFailureAttribution(input: {
  redLineViolated: boolean;
  judgePrimary: FailureCategory | null;
  judgeSecondary?: FailureCategory[];
}): FailureAttribution | null {
  const { redLineViolated, judgePrimary, judgeSecondary } = input;
  if (redLineViolated) {
    const sec: FailureCategory[] = [];
    const seen = new Set<FailureCategory>(["safety"]);
    for (const c of [judgePrimary, ...(judgeSecondary ?? [])]) {
      if (c && !seen.has(c)) {
        seen.add(c);
        sec.push(c);
      }
    }
    return {
      primary: "safety",
      source: "redline",
      secondary: sec.length ? sec : undefined,
    };
  }
  if (!judgePrimary) return null;
  return {
    primary: judgePrimary,
    source: "judge",
    secondary: cleanSecondary(judgePrimary, judgeSecondary),
  };
}
