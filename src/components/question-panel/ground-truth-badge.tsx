import type { GroundTruthCheckKind } from "@/types";
import { cn } from "@/lib/utils";

const CHECK_LABEL: Record<GroundTruthCheckKind, string> = {
  "lang-match": "语言一致",
  "no-leak": "不泄漏",
  "tool-succeeded": "发得出去",
  "no-placeholder": "无占位符",
  "must-include": "含关键项",
};

/** 标记一道题是「确定性 ground-truth probe」并列出挂了哪几个 check。 */
export function GroundTruthBadge({
  kinds,
  className,
}: {
  kinds: GroundTruthCheckKind[];
  className?: string;
}) {
  if (!kinds.length) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent",
        className,
      )}
      title={`确定性判分:${kinds.map((k) => CHECK_LABEL[k]).join("、")}`}
    >
      🎯 确定性 · {kinds.map((k) => CHECK_LABEL[k]).join("/")}
    </span>
  );
}
