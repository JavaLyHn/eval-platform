/**
 * Per-user agent 可见性判定。纯函数,便于单测。
 *
 * 某员工"已配置" ⟺ 其解析出的 agent profile(resolveProfileId,通常来自
 * store 的 agentForEmployee:显式绑定 ?? associatedProfileId ?? 名字匹配)
 * 落在 `configuredProfileIds` 集合里 —— 该集合 = 当前用户拥有 **且连接测试
 * (ping)已通过(verified)** 的 profile。仅"填了名字/存在"不算,必须验证通过,
 * 否则「填了连不上」的 agent 也会让员工卡显示。
 */
export function selectConfiguredEmployeeIds(
  employees: { id: string }[],
  resolveProfileId: (employeeId: string) => string | null,
  configuredProfileIds: ReadonlySet<string>,
): string[] {
  return employees
    .filter((e) => {
      const pid = resolveProfileId(e.id);
      return pid != null && configuredProfileIds.has(pid);
    })
    .map((e) => e.id);
}

export function isEmployeeConfigured(
  employeeId: string,
  resolveProfileId: (employeeId: string) => string | null,
  configuredProfileIds: ReadonlySet<string>,
): boolean {
  const pid = resolveProfileId(employeeId);
  return pid != null && configuredProfileIds.has(pid);
}

export type EmployeeProfileMap = Record<string, string | null>;

/**
 * 登录 hydrate 时调和本地与服务器的员工→agent 绑定。
 * - 服务器非空 → 后端权威(换设备/换用户跟随登录身份)。
 * - 服务器空、本地非空 → 用本地并标记 migrate(把旧本地绑定一次性推到后端)。
 */
export function reconcileEmployeeProfileMap(
  local: EmployeeProfileMap,
  server: EmployeeProfileMap | null | undefined,
): { map: EmployeeProfileMap; migrate: boolean } {
  const serverHasEntries = !!server && Object.keys(server).length > 0;
  if (serverHasEntries) return { map: server as EmployeeProfileMap, migrate: false };
  const localHasEntries = Object.keys(local).length > 0;
  if (localHasEntries) return { map: local, migrate: true };
  return { map: {}, migrate: false };
}
