/** judge 相对被测对象的独立性等级。 */
export type JudgeIsolationLevel = "self" | "same-provider" | "ok";

/**
 * 判定一个 judge 候选相对被测 agent 的隔离等级(黄金准则 §7.1 judge 必须独立)。
 * - self:          与被测同一 profile(自评)—— 禁选
 * - same-provider: 同供应商(providerId 相同)—— 可选但警告 + 运行前确认
 * - ok:            独立
 */
export function judgeIsolationLevel(
  judge: { id: string; providerId: string },
  subjectProfileId: string | null,
  subjectProviderId: string | null,
): JudgeIsolationLevel {
  if (subjectProfileId && judge.id === subjectProfileId) return "self";
  if (subjectProviderId && judge.providerId === subjectProviderId) return "same-provider";
  return "ok";
}
