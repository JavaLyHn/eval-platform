import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  INNER_STAGES,
  type InnerStageKey,
  type StageKey,
} from "@/lib/skillopt-stages";

/** 官方式 6 阶段内循环管线:🎯Rollout → 🔍Reflect → 🔗Aggregate → ✂️Select → 📝Update → 🚦Gate。
 *  active = 当前阶段(由日志 `[N/6 STAGE]` 解析);macroStage==="done" 时全部置为已完成。
 *  hover 任一阶段卡片显示该阶段在 SkillOpt 里的具体作用。 */
export function StagePipeline({
  active,
  macroStage,
}: {
  active?: InnerStageKey;
  macroStage?: StageKey;
}) {
  const activeIdx = active ? INNER_STAGES.findIndex((s) => s.key === active) : -1;
  const allDone = macroStage === "done";

  return (
    <div className="flex items-stretch justify-between gap-1 overflow-x-auto">
      {INNER_STAGES.map((s, i) => {
        const status: "done" | "active" | "pending" = allDone
          ? "done"
          : activeIdx < 0
            ? "pending"
            : i < activeIdx
              ? "done"
              : i === activeIdx
                ? "active"
                : "pending";
        return (
          // min-w 只在手机兜底(让六格可横滑、文字不挤成两行);桌面回到纯 flex-1 均分 ——
          // 否则可拖拽面板被拖窄时,桌面会新出现横向滚动条(改前是文字换行)。
          <div key={s.key} className="flex flex-1 min-w-[68px] items-center gap-1 md:min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex flex-1 cursor-help flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-colors",
                    status === "active" &&
                      "border-accent bg-accent/5 ring-2 ring-accent/30",
                    status === "done" && "border-success/40 bg-success/5",
                    status === "pending" && "border-border bg-card",
                  )}
                >
                  <span
                    className={cn(
                      "text-base leading-none transition-opacity",
                      status === "pending" ? "opacity-40 grayscale" : "opacity-100",
                      status === "active" && "animate-bounce",
                    )}
                  >
                    {s.icon}
                  </span>
                  <span
                    className={cn(
                      "text-[10.5px] font-semibold leading-none",
                      status === "active"
                        ? "text-accent"
                        : status === "done"
                          ? "text-foreground/70"
                          : "text-muted-foreground/60",
                    )}
                  >
                    {s.label}
                  </span>
                  <span
                    className={cn(
                      "text-[9px] leading-none",
                      status === "active" ? "text-accent/80" : "text-muted-foreground/50",
                    )}
                  >
                    {s.zh}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px]">
                <div className="text-[11px] font-semibold">
                  {s.icon} {s.label} · {s.zh}
                </div>
                <div className="mt-0.5 text-[11px] font-normal leading-relaxed opacity-90">
                  {s.desc}
                </div>
              </TooltipContent>
            </Tooltip>
            {i < INNER_STAGES.length - 1 && (
              <span
                className={cn(
                  "shrink-0 text-[11px]",
                  i < activeIdx || allDone ? "text-success/60" : "text-border",
                )}
                aria-hidden
              >
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
