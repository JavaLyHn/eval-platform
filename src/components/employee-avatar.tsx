/**
 * Compact avatar renderer for a StandardEmployee.
 *
 * Prefers the bundled image (`avatarUrl`) when present, falls back to the
 * emoji `avatar`. Used by every employee-display site so they all stay in
 * sync — switching back to emojis is a one-line revert here.
 */

import { cn } from "@/lib/utils";

type EmployeeLike = {
  avatar?: string;
  avatarUrl?: string;
  name?: string;
};

interface Props {
  employee: EmployeeLike | null | undefined;
  /** Pixel size of the visible avatar. Default 24. */
  size?: number;
  className?: string;
}

export function EmployeeAvatar({ employee, size = 24, className }: Props) {
  const style = { width: size, height: size };
  if (employee?.avatarUrl) {
    return (
      <img
        src={employee.avatarUrl}
        alt={employee.name ?? ""}
        style={style}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }
  // Emoji fallback — scaled by container size, no rounded clip needed.
  return (
    <span
      style={{ ...style, fontSize: Math.round(size * 0.75), lineHeight: 1 }}
      className={cn("inline-flex items-center justify-center", className)}
      aria-label={employee?.name}
    >
      {employee?.avatar ?? "👤"}
    </span>
  );
}
