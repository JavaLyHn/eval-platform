import {
  Check,
  ChevronDown,
  Plug,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import { ConnectionDot } from "@/components/status-indicator";
import { AgentAvatar } from "./agent-avatar";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { cn } from "@/lib/utils";

export function AgentSwitcher() {
  const {
    profiles,
    activeProfileId,
    setActiveProfile,
    activeProfile,
    connectionStatus,
    connectActive,
    lastPing,
    clearLocalData,
  } = useQAStore();
  const [clearOpen, setClearOpen] = useState(false);

  const handleConnect = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    void connectActive();
  };

  // 连接状态文案。只有在已配置 Agent 时才显示这块(见下方渲染),
  // 所以不用再为「未配置」准备兜底文案。
  const connectLabel =
    connectionStatus === "connected"
      ? lastPing?.latencyMs != null
        ? `已连接 · ${lastPing.latencyMs}ms`
        : "已连接"
      : connectionStatus === "connecting"
      ? "连接中…"
      : "点击连接";

  const tooltip =
    connectionStatus === "disconnected" && lastPing?.detail
      ? `上次失败：${lastPing.detail}`
      : connectionStatus === "connected" && lastPing?.latencyMs != null
      ? `延迟 ${lastPing.latencyMs}ms`
      : undefined;

  return (
    <>
      <div className="inline-flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                // 不要 focus-visible 蓝环 —— Radix 关闭下拉后会把焦点程序化还给 trigger,
                // 蓝环会一直残留到点别处(用户视为 bug)。保留 hover 效果(移开即消失)。
                "group inline-flex h-8 min-w-0 max-w-[220px] items-center gap-2 rounded-md border border-transparent px-1.5 text-left transition-colors hover:border-border hover:bg-surface focus:outline-none",
              )}
            >
              <AgentAvatar profileId={activeProfileId} size={28} />
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold text-foreground">
                  {activeProfile?.name ?? "未配置 Agent"}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground opacity-60 group-hover:opacity-100" />
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[240px]">
            <DropdownMenuLabel>选择 Agent（被测员工）</DropdownMenuLabel>
            {(() => {
              const agentProfiles = profiles.filter(
                (p) => getProfileKind(p.providerId) === "agent",
              );
              if (agentProfiles.length === 0) {
                return (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    还没有 Agent — 去「Agent 管理」添加 Platform 员工
                  </div>
                );
              }
              return agentProfiles.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={() => setActiveProfile(p.id)}
                  className={cn(
                    p.id === activeProfileId && "text-foreground",
                  )}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {p.id === activeProfileId && (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <AgentAvatar profileId={p.id} size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {p.providerId}
                    </div>
                  </div>
                </DropdownMenuItem>
              ));
            })()}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                handleConnect();
              }}
              disabled={!activeProfile || connectionStatus === "connecting"}
            >
              <Plug />{" "}
              {connectionStatus === "connected" ? "重新测试连接" : "连接 / 测试"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setClearOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 /> 清空本地数据
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 没配 Agent 时不显示连接状态(否则会和按钮里的「未配置 Agent」重复) */}
        {activeProfile && (
          <ConnectionDot
            status={connectionStatus}
            onClick={handleConnect}
            title={tooltip}
            actionLabel={connectLabel}
          />
        )}
      </div>

      <ConfirmDeleteDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="清空本地数据？"
        description="将删除浏览器里保存的所有题目、评测、聊天记录、profile，回到初始示例数据。此操作不可撤销。"
        confirmLabel="全部清空"
        onConfirm={clearLocalData}
      />
    </>
  );
}

export function MiniAgentBadge({ profileId }: { profileId: string | undefined }) {
  const { profiles } = useQAStore();
  if (!profileId) return null;
  const p = profiles.find((pp) => pp.id === profileId);
  if (!p) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      <Sparkles className="h-2.5 w-2.5" />
      {p.name}
    </span>
  );
}

interface BulkButtonProps {
  className?: string;
}
export function BulkAgentSelector(_: BulkButtonProps) {
  // placeholder; left for future enhancements (per-bulk-run override)
  return null;
}
