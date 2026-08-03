/** 401 是否应跳转登录页:/v1/auth/* 的 401 是预期(探测/登录失败),不跳;其余跳。 */
export function shouldRedirectOn401(path: string): boolean {
  return !path.startsWith("/v1/auth/");
}
