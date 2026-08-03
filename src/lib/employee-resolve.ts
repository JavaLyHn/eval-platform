import type { AgentProfile } from "@/agents/types";
import type { StandardEmployee } from "@/types";

/**
 * 把一个 Agent profile 反查成对应的标准员工(Aria / Sam / …),用于在对话界面
 * 显示该员工的头像。
 *
 * 解析顺序(用户确认的「关联 + 名字匹配」口径):
 *  1) 显式关联:「员工」tab 里设的 employeeProfileMap[emp.id],或员工自带的
 *     associatedProfileId —— 任一等于该 profileId 即命中。最权威。
 *  2) 名字兜底:profile 名字里包含某位员工名(忽略大小写),如「Aria（PLATFORM）」→ Aria。
 *     免手动关联也能用。多个员工名都命中时取名字最长的,避免短名误伤。
 *  3) 都认不出 → null(调用方回退到通用图标)。
 */
/**
 * 某个 Agent profile 的名称是否「对应」该员工 —— profile 名字(忽略大小写)包含员工名,
 * 如「Aria（PLATFORM）」对应 Aria。用于「员工关联 Agent」只允许关联同名 agent。
 * 与 resolveEmployeeForProfile 第 2 步的名字兜底口径一致。
 */
export function agentMatchesEmployee(
  profile: Pick<AgentProfile, "name" | "providerId">,
  employee: Pick<StandardEmployee, "name" | "homeProviderId">,
): boolean {
  // 扩展员工按「归属 provider」认(如 Dex ↔ gateway)——不依赖 profile 精确
  // 命名。仅对设了 homeProviderId 的员工生效;标准线员工无此字段,走名字匹配。
  if (employee.homeProviderId) {
    return profile.providerId === employee.homeProviderId;
  }
  const hay = (profile.name ?? "").trim().toLowerCase();
  const needle = (employee.name ?? "").trim().toLowerCase();
  return needle.length > 0 && hay.includes(needle);
}

export function resolveEmployeeForProfile(
  profileId: string | null | undefined,
  profiles: AgentProfile[],
  employees: StandardEmployee[],
  employeeProfileMap: Record<string, string | null>,
): StandardEmployee | null {
  if (!profileId) return null;

  // 1) 显式关联优先
  for (const emp of employees) {
    const linked = employeeProfileMap[emp.id] ?? emp.associatedProfileId ?? null;
    if (linked && linked === profileId) return emp;
  }

  const profile = profiles.find((p) => p.id === profileId);

  // 2) 归属 provider 匹配(扩展员工,如 gateway profile → Dex),不依赖命名
  if (profile) {
    const byProvider = employees.find(
      (e) => e.homeProviderId && e.homeProviderId === profile.providerId,
    );
    if (byProvider) return byProvider;
  }

  // 3) 名字兜底(profile 名字含员工名)
  if (profile?.name) {
    const hay = profile.name.toLowerCase();
    const byLongestName = [...employees].sort(
      (a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0),
    );
    for (const emp of byLongestName) {
      const needle = emp.name?.trim().toLowerCase();
      if (needle && hay.includes(needle)) return emp;
    }
  }

  return null;
}
