import { Activity, Loader2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";

/**
 * Lightweight activity badge shown in the agent header.
 * - idle      : hidden
 * - thinking  : "思考中 · 3.2s" with current stage (if available)
 * - streaming : "流式回答中" with spin icon
 */
export function ActivityIndicator() {
  const { agentActivity, activityStartedAt, agentStage, isStreamingHere } =
    useQAStore();
  const elapsed = useElapsedSeconds(activityStartedAt);

  // Only surface the activity badge when the user is actually viewing the
  // conversation that's streaming. A background stream in another conv
  // shouldn't leak its status into the header here.
  if (agentActivity === "idle" || !isStreamingHere) return null;

  if (agentActivity === "thinking") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5",
          "shrink-0 whitespace-nowrap font-mono text-[10.5px] text-warning",
        )}
      >
        <Activity className="h-2.5 w-2.5 animate-pulse-dot" />
        {agentStage ? (
          <>
            <span className="hidden text-warning/80 @sm/chat:inline">{agentStage}</span>
            <span className="hidden text-warning/60 @sm/chat:inline">·</span>
          </>
        ) : (
          <span className="hidden @sm/chat:inline">思考中</span>
        )}
        <span>{elapsed.toFixed(1)}s</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5",
        "shrink-0 whitespace-nowrap font-mono text-[10.5px] text-accent",
      )}
    >
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      <span className="hidden @sm/chat:inline">流式回答中</span>
    </span>
  );
}

/** A thinking placeholder displayed inside the empty assistant bubble. */
export function ThinkingPlaceholder({
  startedAt,
}: {
  startedAt: number | null;
}) {
  const { agentStage } = useQAStore();
  const elapsed = useElapsedSeconds(startedAt);
  return (
    <div className="flex items-center gap-2 py-0.5 text-[12.5px] text-muted-foreground">
      <span className="flex h-3.5 w-3.5 items-center justify-center">
        <Zap className="h-3 w-3 animate-pulse-dot text-warning" />
      </span>
      <span>
        {agentStage ? agentStage : "Agent 正在思考"}
      </span>
      <span className="font-mono tabular-nums">{elapsed.toFixed(1)}s</span>
    </div>
  );
}

function useElapsedSeconds(startedAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [startedAt]);
  if (startedAt == null) return 0;
  return Math.max(0, (now - startedAt) / 1000);
}
