import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { cn } from "@/lib/utils";

interface AgentPickerProps {
  /** Selected profile IDs. Empty = "any agent" (no restriction). */
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

export function AgentPicker({
  selected,
  onChange,
  className,
}: AgentPickerProps) {
  const { profiles: allProfiles } = useQAStore();
  // 被测员工 picker — only show real agents (走 bridge 的完整智能体). LLM 模型
  // 是裁判 / AI 助手，不该出现在被测候选里。
  const profiles = allProfiles.filter(
    (p) => getProfileKind(p.providerId) === "agent",
  );

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 gap-1.5 px-2.5 text-xs", className)}
        >
          <Sparkles className="h-3 w-3" />
          {selected.length === 0 ? (
            <span className="text-muted-foreground">任意 agent</span>
          ) : (
            <>
              {selected.length} 个 agent
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
          选择此题适用的 agent · 不选 = 任意（按当前活动 agent 发送）
        </div>
        <ul className="p-1">
          {profiles.length === 0 && (
            <li className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              还没有 profile · 先去顶栏添加
            </li>
          )}
          {profiles.map((p) => {
            const checked = selected.includes(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-secondary",
                    checked && "text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border",
                      checked
                        ? "border-foreground bg-foreground text-background"
                        : "border-border",
                    )}
                  >
                    {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {p.providerId}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        {selected.length > 0 && (
          <div className="flex items-center justify-between border-t border-border p-2">
            <span className="text-[11px] text-muted-foreground">
              已选 {selected.length} 个
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => onChange([])}
            >
              <X className="h-3 w-3" /> 清除
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Display-only chips showing which agents a question targets.
 * Empty array → "任意 agent" muted badge.
 */
export function AgentChips({
  agentIds,
  size = "xs",
}: {
  agentIds: string[] | undefined;
  size?: "xs" | "sm";
}) {
  const { profiles } = useQAStore();
  if (!agentIds || agentIds.length === 0) {
    return (
      <Badge variant="muted" className={size === "sm" ? "text-[10.5px]" : "text-[10px]"}>
        任意 agent
      </Badge>
    );
  }
  return (
    <>
      {agentIds.map((id) => {
        const p = profiles.find((pp) => pp.id === id);
        if (!p) {
          return (
            <Badge key={id} variant="destructive" className="text-[10px]">
              ⚠ 失效 profile
            </Badge>
          );
        }
        return (
          <Badge
            key={id}
            variant="accent"
            className={size === "sm" ? "text-[10.5px]" : "text-[10px]"}
          >
            <Sparkles className="mr-0.5 h-2.5 w-2.5" />
            {p.name}
          </Badge>
        );
      })}
    </>
  );
}
