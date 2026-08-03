export type MobileView = "chat" | "panel";

/**
 * 手机单视图跟随 showRight 的**跳变**联动:
 * 无可评分→有 ⇒ 自动亮出「题目」;有→无 ⇒ 回「对话」;未跳变 ⇒ 返回 null(保持用户当前选择)。
 */
export function nextMobileViewOnShowRightChange(
  prev: boolean,
  next: boolean,
): MobileView | null {
  if (prev === next) return null;
  return next ? "panel" : "chat";
}
