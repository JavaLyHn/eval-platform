/**
 * 模型 → 官方公开定价（USD per 1M tokens，2026-01 cut-off）。
 *
 * 仅做"消息行成本估算"显示用，不参与计费 / 结算。`modelVersion` 字段来自
 * 各家 API 返回的真实模型 id（如 `claude-opus-4-7` / `gpt-4o-2024-08-06`）；
 * 表里 key 取最稳定的前缀片段，`matchPricing()` 走 lowercase substring，
 * 抓不到的型号成本就显示为 "—" 不展示。
 *
 * 后端只回来"总 tokens"，没有 in/out 拆分，因此用一个默认 70% 输入比例
 * 做混合估算。用户在 lib 内可改 `DEFAULT_INPUT_RATIO`。
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

/** Substring patterns → price (per 1M tokens). Order matters: longer / more
 *  specific patterns FIRST so e.g. `claude-opus-4-7` wins over `claude`. */
const PRICING: Array<[pattern: string, price: ModelPrice]> = [
  // ----- Anthropic -----
  ["claude-opus-4-7", { input: 15, output: 75 }],
  ["claude-opus-4-6", { input: 15, output: 75 }],
  ["claude-opus-4", { input: 15, output: 75 }],
  ["claude-sonnet-4-6", { input: 3, output: 15 }],
  ["claude-sonnet-4-5", { input: 3, output: 15 }],
  ["claude-sonnet-4", { input: 3, output: 15 }],
  ["claude-haiku-4-5", { input: 1, output: 5 }],
  ["claude-haiku-4", { input: 1, output: 5 }],
  ["claude-3-5-sonnet", { input: 3, output: 15 }],
  ["claude-3-5-haiku", { input: 0.8, output: 4 }],
  ["claude-3-opus", { input: 15, output: 75 }],
  ["claude-3-sonnet", { input: 3, output: 15 }],
  ["claude-3-haiku", { input: 0.25, output: 1.25 }],

  // ----- OpenAI -----
  ["gpt-4o-mini", { input: 0.15, output: 0.6 }],
  ["gpt-4o", { input: 2.5, output: 10 }],
  ["gpt-4.1-mini", { input: 0.4, output: 1.6 }],
  ["gpt-4.1", { input: 2, output: 8 }],
  ["gpt-4-turbo", { input: 10, output: 30 }],
  ["gpt-4", { input: 30, output: 60 }],
  ["gpt-3.5-turbo", { input: 0.5, output: 1.5 }],
  ["o4-mini", { input: 1.1, output: 4.4 }],
  ["o3-mini", { input: 1.1, output: 4.4 }],
  ["o3", { input: 2, output: 8 }],
  ["o1-mini", { input: 1.1, output: 4.4 }],
  ["o1", { input: 15, output: 60 }],

  // ----- DeepSeek -----
  ["deepseek-reasoner", { input: 0.55, output: 2.19 }],
  ["deepseek-chat", { input: 0.27, output: 1.1 }],
  ["deepseek", { input: 0.27, output: 1.1 }],

  // ----- Moonshot / Kimi -----
  ["kimi-k2", { input: 0.6, output: 2.5 }],
  ["moonshot-v1-128k", { input: 8.4, output: 8.4 }],
  ["moonshot-v1-32k", { input: 3.3, output: 3.3 }],
  ["moonshot-v1-8k", { input: 1.7, output: 1.7 }],
  ["moonshot", { input: 1.7, output: 1.7 }],

  // ----- Qwen / 通义 -----
  ["qwen-max", { input: 1.4, output: 5.6 }],
  ["qwen-plus", { input: 0.4, output: 1.2 }],
  ["qwen-turbo", { input: 0.05, output: 0.2 }],
  ["qwen", { input: 0.4, output: 1.2 }],

  // ----- 智谱 GLM -----
  ["glm-4-plus", { input: 0.7, output: 0.7 }],
  ["glm-4", { input: 0.14, output: 0.14 }],
  ["glm", { input: 0.14, output: 0.14 }],

  // ----- Google Gemini -----
  ["gemini-2.5-pro", { input: 1.25, output: 10 }],
  ["gemini-2.5-flash", { input: 0.075, output: 0.3 }],
  ["gemini-1.5-pro", { input: 1.25, output: 5 }],
  ["gemini-1.5-flash", { input: 0.075, output: 0.3 }],
  ["gemini", { input: 1.25, output: 5 }],

  // ----- Groq / Together (commodity hosting) — Llama 3.x ish averages -----
  ["llama-3.3-70b", { input: 0.59, output: 0.79 }],
  ["llama-3.1-70b", { input: 0.59, output: 0.79 }],
  ["llama-3-70b", { input: 0.59, output: 0.79 }],
  ["llama", { input: 0.2, output: 0.2 }],

  // ----- Mistral -----
  ["mistral-large", { input: 2, output: 6 }],
  ["mistral", { input: 0.25, output: 0.25 }],
];

/** Default split when we only have a total. Most chat workloads are roughly
 *  60–80% input by token count; pick 70% as a middle. */
const DEFAULT_INPUT_RATIO = 0.7;

/** Look up the price entry whose pattern is contained in `modelVersion`. */
export function matchPricing(modelVersion: string | undefined): ModelPrice | null {
  if (!modelVersion) return null;
  const lower = modelVersion.toLowerCase();
  for (const [pattern, price] of PRICING) {
    if (lower.includes(pattern)) return price;
  }
  return null;
}

/**
 * Estimate USD cost given a total token count.
 *
 * Returns null when no pricing entry matches — caller should hide the slot.
 */
export function estimateCostUSD(
  modelVersion: string | undefined,
  totalTokens: number | undefined,
  inputRatio = DEFAULT_INPUT_RATIO,
): number | null {
  if (!modelVersion || !totalTokens || totalTokens <= 0) return null;
  const price = matchPricing(modelVersion);
  if (!price) return null;
  const inTok = totalTokens * inputRatio;
  const outTok = totalTokens * (1 - inputRatio);
  return (inTok * price.input + outTok * price.output) / 1_000_000;
}

/** Render a USD figure with sensible precision: */
export function formatUSD(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export type TokenBasis = "measured" | "estimated" | "legacy";

export interface NormalizedTokens {
  /** 输入 token(legacy 无拆分时为 0)。 */
  input: number;
  /** 输出 token(legacy 无拆分时为 0)。 */
  output: number;
  /** 总 token。 */
  total: number;
  /** measured=厂商真实用量;estimated=本地估算(platform);legacy=只有总数。 */
  basis: TokenBasis;
}

/**
 * 把原始 token 字段归一化成 input/output/total + basis 标签。
 * - 有 in & out → measured(opts.estimated 时为 estimated)
 * - 否则只有正 total → legacy(显示时按 70/30 估)
 * - 都没有 → null(不显示成本)
 */
export function normalizeTokens(
  t: { tokens?: number; tokensIn?: number; tokensOut?: number },
  opts?: { estimated?: boolean },
): NormalizedTokens | null {
  if (t.tokensIn != null && t.tokensOut != null) {
    return {
      input: t.tokensIn,
      output: t.tokensOut,
      total: t.tokensIn + t.tokensOut,
      basis: opts?.estimated ? "estimated" : "measured",
    };
  }
  if (t.tokens != null && t.tokens > 0) {
    return { input: 0, output: 0, total: t.tokens, basis: "legacy" };
  }
  return null;
}

/**
 * 用明确的 input/output token 数计价(不走 70/30)。
 * 无匹配定价 → null。
 */
export function costFromSplit(
  modelVersion: string | undefined,
  inTok: number,
  outTok: number,
): number | null {
  if (!modelVersion) return null;
  const price = matchPricing(modelVersion);
  if (!price) return null;
  return (inTok * price.input + outTok * price.output) / 1_000_000;
}
