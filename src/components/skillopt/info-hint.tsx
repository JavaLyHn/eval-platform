import { HelpCircle } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * 参数标签旁的「ⓘ」悬浮解释。需有 TooltipProvider 祖先(run-config-card 根部已包)。
 * 用于把 SkillOpt 的专业名词就地讲清楚,不打断布局。
 */
export function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="说明"
          className="inline-flex shrink-0 text-muted-foreground/50 transition-colors hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[18rem] text-[11px] leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}
