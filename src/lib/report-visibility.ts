import type { EvaluatorRef, UserProfile } from "@/types";

/**
 * 一份评测报告对某个用户是否可见 —— 每个用户只看自己生成的报告。
 *
 * 规则:
 *  - 无主报告(老数据,生成时未填个人信息)→ 对所有人可见,避免历史报告凭空消失。
 *  - 有主报告 → 当前用户身份与 owner 匹配才可见。
 *  - 匹配口径(宽松 OR,避免改了邮箱/角色后认不出自己的旧报告):
 *      邮箱都非空且相等  → 视为本人
 *      姓名都非空且相等(去空格、忽略大小写) → 视为本人
 *  - 当前用户既无姓名又无邮箱 → 认不出任何"自己的",只看到无主报告。
 */
export function reportVisibleTo(
  report: { owner?: EvaluatorRef },
  user: UserProfile,
): boolean {
  const owner = report.owner;
  if (!owner) return true; // 无主:历史/未署名报告,人人可见

  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  const uName = norm(user.name);
  const oName = norm(owner.name);
  const uEmail = norm(user.email);
  const oEmail = norm(owner.email);

  if (uEmail && oEmail && uEmail === oEmail) return true;
  if (uName && oName && uName === oName) return true;
  return false;
}
