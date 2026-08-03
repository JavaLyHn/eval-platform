import type { UncertaintySignal, UncertaintySignalType } from "@/types";

export const UNCERTAINTY_TYPES: UncertaintySignalType[] = [
  "hedging",
  "clarify",
  "refusal",
  "confidence",
];

export const UNCERTAINTY_META: Record<
  UncertaintySignalType,
  { label: string; hint: string; color: string }
> = {
  hedging: { label: "软化措辞", hint: "可能/大概/应该等不确定表述", color: "hsl(38 92% 50%)" },
  clarify: { label: "反问澄清", hint: "反问或要求更多信息", color: "hsl(199 89% 48%)" },
  refusal: { label: "拒答/能力声明", hint: "声明无法/超出范围", color: "hsl(280 65% 60%)" },
  confidence: { label: "置信度声明", hint: "主动声明把握度/请核实", color: "hsl(38 92% 50%)" },
};

const QUOTE_MAX = 200;

export function isUncertaintyType(x: unknown): x is UncertaintySignalType {
  return typeof x === "string" && (UNCERTAINTY_TYPES as string[]).includes(x);
}

/**
 * 把 LLM 解析出来的原始数组清洗成合法 UncertaintySignal[]:
 * 丢弃非对象 / type 非法 / quote 非非空字符串的项;quote 去空白并截断到 QUOTE_MAX;
 * 全部非法或非数组 → []。
 */
export function cleanSignals(raw: unknown): UncertaintySignal[] {
  if (!Array.isArray(raw)) return [];
  const out: UncertaintySignal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (!isUncertaintyType(o.type)) continue;
    const q = typeof o.quote === "string" ? o.quote.trim() : "";
    if (!q) continue;
    const quote = q.slice(0, QUOTE_MAX);
    // 完全相同的 (type, quote) 去重,防 judge 偶发把同一句重复输出成两条。
    // 同 type 不同 quote 的保留(表示多处独立信号)。
    if (out.some((s) => s.type === o.type && s.quote === quote)) continue;
    out.push({ type: o.type, quote });
  }
  return out;
}
