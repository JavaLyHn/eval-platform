/**
 * Rough token-count heuristic for providers that don't return usage metadata
 * (e.g. platform). Treats CJK as ~1 token/char and other
 * text as ~4 chars/token — close enough for cost-tracking UX, not accurate
 * enough for billing.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    // CJK Unified Ideographs + Hiragana/Katakana + Hangul. Good enough.
    if (/[぀-ヿ㐀-䶿一-鿿가-힯]/.test(ch)) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.max(1, Math.ceil(cjk + other / 4));
}
