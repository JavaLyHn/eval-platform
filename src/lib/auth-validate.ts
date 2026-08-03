export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** 返回错误文案;通过返回 null。v1 仅要求 ≥8 位。 */
export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return "密码至少 8 位";
  return null;
}
