import { useEffect, useRef, useState } from "react";
import {
  Activity, CheckCircle2, CircleSlash, Flag, Lightbulb, MinusCircle,
  PartyPopper, RefreshCw, ShieldCheck, Sparkles, type LucideIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type RunEvent, type RunEventKind, type RunEventTone } from "@/lib/skillopt-run-events";

const ICON: Record<RunEventKind, LucideIcon> = {
  step: RefreshCw,
  rollout: Activity,
  accept: CheckCircle2,
  "accept-best": CheckCircle2,
  reject: CircleSlash,
  skip: MinusCircle,
  slow: Lightbulb,
  meta: Sparkles,
  baseline: Flag,
  heldout: ShieldCheck,
  done: PartyPopper,
};

const TONE: Record<RunEventTone, string> = {
  ok: "text-success",
  bad: "text-destructive",
  info: "text-muted-foreground",
  accent: "text-accent",
};

function rel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s 前` : `${Math.floor(s / 60)}m${s % 60}s 前`;
}

/** 运行事件流:每行 图标 + tone 颜色 + 主句 + 次要信息 + 相对时间;最新一条 pulse,自动滚到底。 */
export function ActivityFeed({ events }: { events: (RunEvent & { at: number })[] }) {
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight; // 只滚内部列表,不带动整页
  }, [events.length]);

  if (events.length === 0) return null;
  const shown = events.slice(-60);
  const offset = events.length - shown.length;

  return (
    <Card className="p-0">
      <div className="border-b border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">活动流</div>
      <ul ref={listRef} role="log" aria-label="运行事件流" className="max-h-72 space-y-0.5 overflow-auto p-2">
        {shown.map((e, i) => {
          const Icon = ICON[e.kind];
          const last = i === shown.length - 1;
          return (
            <li
              key={offset + i}
              className={cn("flex items-start gap-2 rounded px-1.5 py-1 text-[12px] animate-in fade-in-0", last && "bg-secondary/40")}
            >
              <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", TONE[e.tone], last && "animate-pulse")} />
              <span className="min-w-0 flex-1">
                <span className="text-foreground">{e.text}</span>
                {e.detail && <span className="text-muted-foreground"> · {e.detail}</span>}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground/70">{rel(now - e.at)}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
