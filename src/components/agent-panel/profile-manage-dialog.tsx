import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  Pencil,
  Plus,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ProfileFormDialog } from "./profile-form-dialog";
import { HeaderIconBadge } from "@/components/header-icon-badge";
import { brandIconForModel } from "@/components/brand-icons";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import { useQAStore, listProviders } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { cn } from "@/lib/utils";
import type { AgentProfile, ProviderKind } from "@/agents/types";

interface ProfileManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which pool to manage. Defaults to "agent" for back-compat. */
  kind?: ProviderKind;
}

interface PingState {
  status: "idle" | "pinging" | "ok" | "fail";
  detail?: string;
  latencyMs?: number;
}

export function ProfileManageDialog({
  open,
  onOpenChange,
  kind = "agent",
}: ProfileManageDialogProps) {
  const {
    profiles,
    activeProfileId,
    setActiveProfile,
    deleteProfile,
    connectProfile,
  } = useQAStore();

  const [formOpen, setFormOpen] = useState(false);
  const [formKind, setFormKind] = useState<ProviderKind>(kind);
  const [editing, setEditing] = useState<AgentProfile | undefined>();
  const [deleting, setDeleting] = useState<AgentProfile | null>(null);
  const [pings, setPings] = useState<Record<string, PingState>>({});

  const handlePing = async (id: string) => {
    setPings((p) => ({ ...p, [id]: { status: "pinging" } }));
    // 走 connectProfile:测试通过会顺带置 verified=true(对应员工卡随即显示 + 可自动关联),
    // 而非只更新本地展示。silent=true —— 通知不弹,详情就地展示。
    const res = await connectProfile(id, { silent: true });
    setPings((p) => ({
      ...p,
      [id]: {
        status: res.ok ? "ok" : "fail",
        detail: res.detail,
        latencyMs: res.latencyMs,
      },
    }));
  };

  const providers = listProviders();
  const agentProfiles = profiles.filter(
    (p) => getProfileKind(p.providerId) === "agent",
  );
  const llmProfiles = profiles.filter(
    (p) => getProfileKind(p.providerId) === "llm",
  );

  const openAdd = (kind: ProviderKind) => {
    setEditing(undefined);
    setFormKind(kind);
    setFormOpen(true);
  };
  const openEdit = (p: AgentProfile) => {
    setEditing(p);
    setFormKind(getProfileKind(p.providerId) ?? "agent");
    setFormOpen(true);
  };

  const renderProfile = (p: AgentProfile) => {
    const provider = providers.find((pp) => pp.id === p.providerId);
    const ping = pings[p.id];
    const isActive = p.id === activeProfileId;
    const isAgent = getProfileKind(p.providerId) === "agent";
    // 按"模型 / baseUrl / provider"选品牌图标(逻辑集中在 brandIconForModel,覆盖
    // Claude/GPT/DeepSeek/GLM/Qwen/Gemini/Kimi/Grok/Mistral/豆包/文心/MiniMax/Yi/Llama…);
    // 未命中回退通用图标。
    const brandIcon =
      brandIconForModel(
        String(p.config.model ?? ""),
        String(p.config.baseUrl ?? ""),
        p.providerId,
      ) ?? (isAgent ? Bot : BrainCircuit);
    return (
      <li
        key={p.id}
        className={cn(
          "rounded-lg border bg-card p-3",
          isActive ? "border-foreground/30" : "border-border",
        )}
      >
        <div className="flex items-start gap-2.5">
          {/* 动态徽标(渐变 + twinkle + 流光);图标按 provider/格式 选 Claude / OpenAI,其余回退 */}
          <HeaderIconBadge icon={brandIcon} className="h-7 w-7" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold text-foreground">
                {p.name}
              </span>
              {isActive && isAgent && (
                <Badge variant="accent" className="text-[10px]">
                  当前被测
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
              <span>{provider?.label ?? p.providerId}</span>
              {typeof p.config.baseUrl === "string" && (
                <span className="truncate">· {String(p.config.baseUrl)}</span>
              )}
            </div>
            {ping && (
              <div className="mt-1 text-[11px]">
                {ping.status === "pinging" && (
                  <span className="text-muted-foreground">测试中...</span>
                )}
                {ping.status === "ok" && (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCircle2 className="h-3 w-3" />
                    {ping.detail}
                    {ping.latencyMs != null && ` (${ping.latencyMs}ms)`}
                  </span>
                )}
                {ping.status === "fail" && (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <XCircle className="h-3 w-3" />
                    {ping.detail}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10.5px]"
              onClick={() => handlePing(p.id)}
              disabled={ping?.status === "pinging"}
            >
              <Zap className="h-3 w-3" />
              测试
            </Button>
            {isAgent && !isActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10.5px]"
                onClick={() => setActiveProfile(p.id)}
              >
                设为当前
              </Button>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6"
              onClick={() => openEdit(p)}
              aria-label="编辑"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 text-destructive hover:text-destructive"
              onClick={() => setDeleting(p)}
              aria-label="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </li>
    );
  };

  const isAgent = kind === "agent";
  const visible = isAgent ? agentProfiles : llmProfiles;
  const title = isAgent ? "Agent 管理（被测员工）" : "LLM 模型管理（裁判 / AI 助手）";
  const description = isAgent
    ? "完整智能体 — Platform 员工实例。被测对象池。"
    : "直连 API 的裸大模型 — GPT / DeepSeek / Claude / 通义 等。裁判 / AI 助手用。";
  const addLabel = isAgent ? "添加 Agent" : "添加 LLM";
  const emptyHint = isAgent
    ? "还没有 Agent — 点右上「添加 Agent」配置 Platform 员工连接"
    : "还没有 LLM 模型 — 点右上「添加 LLM」配置 GPT / DeepSeek / Claude 等";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {/* 与首页左上角品牌徽章同款:渐变方块 + 持续闪烁 + 常驻高光扫过 */}
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-accent to-foreground text-background shadow-sm">
              {isAgent ? (
                <Bot className="h-3.5 w-3.5 animate-twinkle" />
              ) : (
                <BrainCircuit className="h-3.5 w-3.5 animate-twinkle" />
              )}
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent animate-shimmer" />
            </span>
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center justify-between">
          <div className="text-[12px] text-muted-foreground">
            共{" "}
            <span className="font-mono text-foreground">{visible.length}</span>{" "}
            个
          </div>
          <Button
            variant="default"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => openAdd(kind)}
          >
            <Plus className="h-3 w-3" /> {addLabel}
          </Button>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/40 px-3 py-8 text-center text-[12px] text-muted-foreground">
            {emptyHint}
          </div>
        ) : (
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {visible.map(renderProfile)}
          </ul>
        )}

        <ProfileFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          profile={editing}
          kind={formKind}
        />

        <ConfirmDeleteDialog
          open={!!deleting}
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`删除「${deleting?.name ?? ""}」？`}
          description="此操作不会影响已有的评测记录。"
          onConfirm={() => deleting && deleteProfile(deleting.id)}
        />
      </DialogContent>
    </Dialog>
  );
}

