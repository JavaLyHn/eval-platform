import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionStatus, Difficulty, QuestionStatus } from "@/types";

const CONNECTION_COLOR: Record<ConnectionStatus, string> = {
  connected: "bg-success text-success",
  connecting: "bg-warning text-warning",
  disconnected: "bg-destructive text-destructive",
};

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connected: "已连接",
  connecting: "连接中",
  disconnected: "未连接",
};

interface ConnectionDotProps {
  status: ConnectionStatus;
  /** If provided, the dot becomes a clickable connect button. */
  onClick?: (e: React.MouseEvent) => void;
  /** Tooltip text. */
  title?: string;
  /** Override the visible label. */
  actionLabel?: string;
}

export function ConnectionDot({
  status,
  onClick,
  title,
  actionLabel,
}: ConnectionDotProps) {
  const label = actionLabel ?? CONNECTION_LABEL[status];
  const body = (
    <>
      {status === "connecting" ? (
        <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-warning" />
      ) : (
        <span className={cn("status-dot", CONNECTION_COLOR[status])} />
      )}
      <span>{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        disabled={status === "connecting"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-80 disabled:hover:bg-transparent",
        )}
      >
        {body}
      </button>
    );
  }
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      {body}
    </span>
  );
}

const DIFF_LABEL: Record<Difficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

const DIFF_CLASS: Record<Difficulty, string> = {
  easy: "bg-success/15 text-success border-success/20",
  medium: "bg-warning/15 text-warning border-warning/20",
  hard: "bg-destructive/15 text-destructive border-destructive/20",
};

export function DifficultyBadge({ value }: { value: Difficulty }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md border px-1.5 text-[10.5px] font-medium",
        DIFF_CLASS[value],
      )}
    >
      {DIFF_LABEL[value]}
    </span>
  );
}

const STATUS_LABEL: Record<QuestionStatus, string> = {
  untested: "未测",
  tested: "已测",
  passed: "通过",
  failed: "失败",
};

const STATUS_CLASS: Record<QuestionStatus, string> = {
  untested: "bg-muted text-muted-foreground border-border",
  tested: "bg-info/15 text-info border-info/20",
  passed: "bg-success/15 text-success border-success/20",
  failed: "bg-destructive/15 text-destructive border-destructive/20",
};

export function StatusBadge({ value }: { value: QuestionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md border px-1.5 text-[10.5px] font-medium",
        STATUS_CLASS[value],
      )}
    >
      {STATUS_LABEL[value]}
    </span>
  );
}
