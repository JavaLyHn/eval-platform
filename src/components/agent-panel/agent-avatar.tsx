import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { useQAStore } from "@/hooks/use-qa-store";
import { resolveEmployeeForProfile } from "@/lib/employee-resolve";
import { cn } from "@/lib/utils";

/**
 * 对话界面里某个 Agent 的头像 —— 解析出它对应的标准员工(Aria/Sam…)就显示员工头像,
 * 认不出(没关联、名字也不匹配)则保留通用 ✨ 图标。三处共用:消息气泡 / 顶部切换器 /
 * 会话列表。解析口径见 resolveEmployeeForProfile。
 */
export function AgentAvatar({
  profileId,
  size = 28,
  className,
}: {
  profileId?: string | null;
  /** 头像边长(px)。 */
  size?: number;
  className?: string;
}) {
  const { profiles, standardEmployees, employeeProfileMap } = useQAStore();
  const employee = useMemo(
    () =>
      resolveEmployeeForProfile(
        profileId,
        profiles,
        standardEmployees,
        employeeProfileMap,
      ),
    [profileId, profiles, standardEmployees, employeeProfileMap],
  );

  if (employee) {
    return (
      <EmployeeAvatar
        employee={employee}
        size={size}
        className={cn("shrink-0", className)}
      />
    );
  }

  // 兜底:通用 ✨ 图标,沿用消息气泡原先的描边小方块。
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground",
        className,
      )}
      aria-label="Agent"
    >
      <Sparkles
        style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }}
      />
    </span>
  );
}
