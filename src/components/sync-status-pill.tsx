/**
 * 全局同步状态药丸(右下角浮层,不占文档流)。统一展示两个方向,让用户能**感知到正在同步**:
 *   - 上行:outbox 有 pending → 「同步 N 条变更…」(本机改动推服务器)
 *   - 下行:isRefetching → 「正在从服务器同步…」(把别的设备的新数据拉到本机)
 *
 * 只有同步持续超过 ~500ms 才显示 —— 切标签页触发的秒级快刷不打扰;真正「要同步一段时间」
 * 的才浮出来。结束时短暂闪一下「已同步」,让完成也可感知;空闲时完全不出现。
 */

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Check } from "lucide-react";

import { outbox } from "@/lib/outbox";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";

type Phase = "idle" | "syncing" | "done";

export function SyncStatusPill() {
  const { isRefetching } = useQAStore();
  const [pending, setPending] = useState(() => outbox.snapshot().pending.length);
  useEffect(() => outbox.onChange((s) => setPending(s.pending.length)), []);

  // 上行(本机→服务器)或下行(服务器→本机)任一在进行都算「同步中」。
  const syncing = pending > 0 || isRefetching;

  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  useEffect(() => {
    if (syncing) {
      // 延迟 500ms 再显示:瞬时同步保持安静,只有拖了一会儿的才浮出来。
      const t = setTimeout(() => setPhase("syncing"), 500);
      return () => clearTimeout(t);
    }
    // 同步结束:之前真的显示过才闪一下「已同步」,否则(瞬时同步)保持空闲。
    if (phaseRef.current === "syncing") {
      setPhase("done");
      const t = setTimeout(() => setPhase("idle"), 1500);
      return () => clearTimeout(t);
    }
    return;
  }, [syncing]);

  if (phase === "idle") return null;

  const done = phase === "done";
  const label = done
    ? "已同步"
    : pending > 0
      ? `同步 ${pending} 条变更…`
      : "正在从服务器同步…";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] shadow-sm backdrop-blur-sm",
        done
          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300",
      )}
    >
      {done ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      )}
      <span>{label}</span>
    </div>
  );
}
