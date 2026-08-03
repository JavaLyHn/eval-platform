import { clearAllPlatformData } from "./persistence";

// 注意:marker 用 qa-auth: 前缀,**不在** eval-platform: 前缀内,
// 这样 clearAllPlatformData()(只清 eval-platform:*)不会把它一起清掉。
// 导出 key:供 AuthProvider 监听 storage 事件做跨标签页身份变更侦测。
export const AUTH_MARKER_KEY = "qa-auth:lastUserId";
const MARKER = AUTH_MARKER_KEY;

/** 登录用户与上次不一致 → 清空本地数据切片(换用户隔离)。幂等。 */
export function reconcileLocalUser(userId: string): void {
  if (typeof localStorage === "undefined") return;
  const prev = localStorage.getItem(MARKER);
  if (prev !== userId) {
    clearAllPlatformData();
    localStorage.setItem(MARKER, userId);
  }
}

export function clearLocalUserMarker(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(MARKER);
}

// 本机登录过的邮箱(仅邮箱,绝不存密码),供登录页「切换账号」快捷回填。
// 同样用 qa-auth: 前缀 → 不被 clearAllPlatformData / 登出清掉(切换的意义就是记住)。
const KNOWN_EMAILS = "qa-auth:knownEmails";
const MAX_KNOWN = 6;

export function getKnownEmails(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const arr = JSON.parse(localStorage.getItem(KNOWN_EMAILS) ?? "[]");
    return Array.isArray(arr) ? arr.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

/** 记住一个登录邮箱(去重、置顶、上限 6 个)。幂等。 */
export function rememberEmail(email: string): void {
  if (typeof localStorage === "undefined") return;
  const e = email.trim().toLowerCase();
  if (!e) return;
  const list = [e, ...getKnownEmails().filter((x) => x !== e)].slice(0, MAX_KNOWN);
  localStorage.setItem(KNOWN_EMAILS, JSON.stringify(list));
}

export function forgetEmail(email: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    KNOWN_EMAILS,
    JSON.stringify(getKnownEmails().filter((x) => x !== email.trim().toLowerCase())),
  );
}
