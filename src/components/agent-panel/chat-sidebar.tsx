import {
  Bot,
  BrainCircuit,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Download,
  FileCode2,
  FileText,
  GitBranch,
  Check,
  Library,
  ListFilter,
  MessageSquare,
  MessageSquarePlus,
  Moon,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmDeleteDialog } from "@/components/question-panel/confirm-delete-dialog";
import { EmployeesTab } from "@/components/question-panel/employees-tab";
import { HeaderIconBadge } from "@/components/header-icon-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProfileManageDialog } from "./profile-manage-dialog";
import { ConversationSearchDialog } from "./conversation-search-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { AgentAvatar } from "./agent-avatar";
import { UserProfileDialog } from "@/components/user/user-profile-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useQAStore } from "@/hooks/use-qa-store";
import { useTheme } from "@/hooks/use-theme";
import { formatSyncedAgo } from "@/lib/refetch-gate";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Conversation } from "@/types";

interface ChatSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Navigation model                                                            */
/* -------------------------------------------------------------------------- */

interface RouteItem {
  kind: "route";
  to: string;
  label: string;
  icon: typeof Library;
  end?: boolean;
}

type ModalKey = "employees";

interface ModalItem {
  kind: "modal";
  key: ModalKey;
  label: string;
  icon: typeof Library;
}

type NavItem = RouteItem | ModalItem;

const NAV_ITEMS: NavItem[] = [
  { kind: "route", to: "/", label: "评测中心", icon: MessageSquare, end: true },
  { kind: "route", to: "/library", label: "题库", icon: Library },
  { kind: "route", to: "/reports", label: "评测报告", icon: FileText },
  // 「自动评测运行」隐藏:报告展示与「评测报告」重复(路由 /runs 保留,直接访问 URL 仍可达):
  // { kind: "route", to: "/runs", label: "自动评测运行", icon: FlaskConical },
  // 「技能」「技能对比」暂时隐藏(后续会用,路由 / 页面均保留,直接访问 URL 仍可达):
  // { kind: "route", to: "/skills", label: "技能", icon: Boxes },
  { kind: "route", to: "/skills-repo", label: "技能", icon: GitBranch },
  // { kind: "route", to: "/skills-compare", label: "技能对比", icon: GitCompare },
  { kind: "route", to: "/skillopt", label: "Skill 评测", icon: Sparkles },
  { kind: "route", to: "/prompts", label: "Prompt 管理", icon: FileCode2 },
  { kind: "modal", key: "employees", label: "标准员工", icon: Users },
];

const MODAL_CONFIG: Record<
  ModalKey,
  { title: string; subtitle: string; icon: typeof Library; render: () => React.ReactNode }
> = {
  employees: {
    title: "标准员工",
    subtitle: "预置 AI 员工的档案 + 角色专属指标模板",
    icon: Users,
    render: () => <EmployeesTab />,
  },
};

/* -------------------------------------------------------------------------- */

export function ChatSidebar({ collapsed, onToggleCollapse, onNavigate }: ChatSidebarProps) {
  const {
    conversations,
    activeConversationId,
    activeProfileId,
    newConversation,
    switchConversation,
    deleteConversation,
    renameConversation,
    togglePinConversation,
    runningConversationIds,
    exportConversation,
    importConversationBundle,
    showNotice,
  } = useQAStore();
  const { theme, toggle } = useTheme();

  // 「导入会话」：隐藏 file input,点按钮触发选择,读文本后交给 store 合并。
  const importInputRef = useRef<HTMLInputElement>(null);
  const onPickImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许再次选同一个文件
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (importConversationBundle(text)) onNavigate?.();
    };
    reader.onerror = () =>
      showNotice({ kind: "error", message: "读取文件失败" });
    reader.readAsText(file);
  };

  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [agentManageOpen, setAgentManageOpen] = useState(false);
  const [llmManageOpen, setLlmManageOpen] = useState(false);
  const [modalKey, setModalKey] = useState<ModalKey | null>(null);
  // Recents 分组方式(参考 claude.ai 的 Group by):date=按日期 / none=默认不分组。持久化到 localStorage。
  const [recentsGroupBy, setRecentsGroupBy] = useState<"date" | "none">(() =>
    typeof localStorage !== "undefined" &&
    localStorage.getItem(RECENTS_GROUPBY_KEY) === "none"
      ? "none"
      : "date",
  );
  const chooseGroupBy = (v: "date" | "none") => {
    setRecentsGroupBy(v);
    try {
      localStorage.setItem(RECENTS_GROUPBY_KEY, v);
    } catch {
      /* ignore */
    }
  };

  // ⌘/Ctrl+K opens the conversation search palette from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sorted = useMemo(
    () =>
      // 按真实时刻倒序(最新在最上)。不能用字符串 localeCompare:本地新建的会话
      // updatedAt 是 UTC(…Z),服务端回灌的是 +08:00,字面比较会把刚建的会话排到最下。
      [...conversations].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [conversations],
  );
  // 置顶会话聚到最上方独立分组,不再参与下面的日期分组(避免一条会话出现两次)。
  // 两组都保持 sorted 的时间倒序。
  const pinned = useMemo(() => sorted.filter((c) => c.pinned), [sorted]);
  const unpinned = useMemo(() => sorted.filter((c) => !c.pinned), [sorted]);
  // Recents 按日期分组(参考 claude.ai):今天 / 昨天 / 具体日期。unpinned 已按时间倒序,
  // 相邻同日期天然归到一组,保持时间顺序。
  const recentGroups = useMemo(() => groupByDate(unpinned), [unpinned]);
  // 默认模式(none)= 不分组的单组(无标题);按日期模式 = 上面的日期分组。
  const renderGroups =
    recentsGroupBy === "date" ? recentGroups : [{ label: "", items: unpinned }];

  // 单条会话行。置顶组和日期分组共用同一渲染,避免两处重复。
  const renderConvRow = (c: Conversation) => {
    const active = c.id === activeConversationId;
    const isRenaming = renamingId === c.id;
    // 这条会话是否正在生成/续发/批量跑 → 头像挂呼吸标志、标题转强调色。
    const running = runningConversationIds.has(c.id);
    // 这条对话「跟谁聊的」:取最近一条带 profile 的消息;空对话回退到当前选中的 Agent。
    const convProfileId =
      (c.messages ?? []).reduce<string | undefined>(
        (acc, m) => m.agentProfileId ?? acc,
        undefined,
      ) ?? activeProfileId;
    return (
      <li key={c.id}>
        {isRenaming ? (
          // 与会话行同结构:左头像占位对齐 + 输入框占标题位,内嵌紧凑(不再是一个撑大列表的独立大框)。
          <div className="flex items-center gap-1.5 rounded-md bg-secondary px-1.5 py-1.5">
            <span className="shrink-0">
              <AgentAvatar profileId={convProfileId} size={18} className="rounded" />
            </span>
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => {
                renameConversation(c.id, renameDraft);
                setRenamingId(null);
              }}
              onKeyDown={(e) => {
                // 输入法组字中(选候选词)按 Enter/Esc 是给 IME 用的(选词/关候选窗),
                // 不能当成「确认/取消重命名」—— 否则中文选第一个候选词就直接把名字定死了。
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  renameConversation(c.id, renameDraft);
                  setRenamingId(null);
                } else if (e.key === "Escape") {
                  setRenamingId(null);
                }
              }}
              className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-[12.5px] leading-tight focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        ) : (
          <div
            className={cn(
              "group flex items-center gap-1.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-secondary",
              active && "bg-secondary text-foreground",
            )}
          >
            <span className="relative shrink-0">
              <AgentAvatar profileId={convProfileId} size={18} className="rounded" />
              {/* 呼吸标志:仅正在进行的会话。头像右下角小圆点 + 向外扩散的呼吸光环
                  (经典「活跃」徽标)。绝对定位不挤占布局;ring 与侧栏底色分隔。 */}
              {running && (
                <span
                  className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-2 w-2"
                  aria-hidden
                >
                  <span className="absolute inline-flex h-full w-full rounded-full bg-accent animate-breathe" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent ring-2 ring-surface" />
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                switchConversation(c.id);
                onNavigate?.();
              }}
              className="min-w-0 flex-1 text-left focus:outline-none"
              title={`${c.title} · ${formatRelativeTime(c.updatedAt)}${running ? " · 正在进行" : ""}`}
            >
              <span
                className={cn(
                  "block truncate text-[12.5px]",
                  running
                    ? "font-medium text-accent"
                    : active
                      ? "font-medium text-foreground"
                      : "text-foreground/80",
                )}
              >
                {c.title}
              </span>
            </button>
            {/* 星标置顶:已置顶=常亮金色实心星;未置顶=hover 才显空心星(与右侧「…」同款
                显隐,active 行常显半透明)。点击切换,不打断当前选中/切换会话。 */}
            <button
              type="button"
              onClick={() => togglePinConversation(c.id)}
              aria-label={c.pinned ? "取消置顶" : "置顶"}
              title={c.pinned ? "取消置顶" : "置顶"}
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-secondary/80",
                c.pinned
                  ? "opacity-100"
                  : cn(
                      "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                      active && "opacity-60",
                    ),
              )}
            >
              <Star
                className={cn(
                  "h-3.5 w-3.5",
                  c.pinned
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground",
                )}
              />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100",
                    active && "opacity-60",
                  )}
                  aria-label="对话操作"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => togglePinConversation(c.id)}>
                  <Star /> {c.pinned ? "取消置顶" : "置顶"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setRenameDraft(c.title);
                    setRenamingId(c.id);
                  }}
                >
                  <Pencil /> 重命名
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportConversation(c.id)}>
                  <Download /> 导出会话(JSON)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setPendingDelete({ id: c.id, title: c.title })}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 /> 删除对话
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </li>
    );
  };

  /* ----- collapsed mode ------------------------------------------------- */

  if (collapsed) {
    const railItem =
      "inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground";
    return (
      <aside
        className="flex h-full w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-surface/40 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ flexShrink: 0 }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={onToggleCollapse} aria-label="展开会话列表" className={railItem}>
              <ChevronsRight className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">展开</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => newConversation()} aria-label="新对话" className={railItem}>
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">新对话</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              aria-label="导入会话"
              className={railItem}
            >
              <Upload className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">导入会话(JSON)</TooltipContent>
        </Tooltip>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onPickImportFile}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => setSearchOpen(true)} aria-label="搜索对话" className={railItem}>
              <Search className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">搜索 ⌘K</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              className={railItem}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{theme === "dark" ? "浅色模式" : "深色模式"}</TooltipContent>
        </Tooltip>

        <div className="my-1 h-px w-6 bg-border" />

        {NAV_ITEMS.map((item) =>
          item.kind === "route" ? (
            <CollapsedNavLink key={item.to} route={item} />
          ) : (
            <CollapsedNavButton
              key={item.key}
              label={item.label}
              icon={item.icon}
              onClick={() => setModalKey(item.key)}
              active={modalKey === item.key}
            />
          ),
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => setAgentManageOpen(true)} aria-label="Agent 管理" className={railItem}>
              <Bot className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Agent 管理（被测员工）</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => setLlmManageOpen(true)} aria-label="LLM 模型管理" className={railItem}>
              <BrainCircuit className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">LLM 模型（裁判 / AI 助手）</TooltipContent>
        </Tooltip>

        <div className="my-1 h-px w-6 bg-border" />
        <SidebarUserButton collapsed />

        {/* shared modals */}
        <ProfileManageDialog open={agentManageOpen} onOpenChange={setAgentManageOpen} kind="agent" />
        <ProfileManageDialog open={llmManageOpen} onOpenChange={setLlmManageOpen} kind="llm" />
        <ConversationSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
        <NavModal modalKey={modalKey} onOpenChange={(o) => !o && setModalKey(null)} />
      </aside>
    );
  }

  /* ----- expanded mode -------------------------------------------------- */

  return (
    <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-surface/40">
      {/* Brand —— 点击图案/文字 = 刷新首页(回 / 并整页重载)。无 tooltip / 无灰框 / 无动画。 */}
      <div className="flex select-none items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => window.location.assign("/")}
          aria-label="刷新首页"
          className="-mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left focus:outline-none"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-foreground text-background shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-foreground">
            QA Platform
          </span>
        </button>
        {/* 深色 / 浅色模式切换 */}
        <ThemeToggle />
        {/* 搜索对话 = 放大镜,放在折叠按钮左边(打开命令面板,⌘K 仍可用) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSearchOpen(true)}
              aria-label="搜索对话"
            >
              <Search className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">搜索对话 ⌘K</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleCollapse}
              aria-label="折叠会话列表"
              className="-mr-1"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">折叠</TooltipContent>
        </Tooltip>
      </div>

      {/* New chat + 导入会话 */}
      <div className="flex items-center gap-1.5 px-2 pb-2">
        <Button
          variant="outline"
          size="sm"
          className="min-w-0 flex-1 justify-start gap-2 text-[12.5px] font-medium"
          onClick={() => {
            newConversation();
            onNavigate?.();
          }}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          新对话
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="shrink-0"
              aria-label="导入会话"
              onClick={() => importInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">导入会话(JSON)</TooltipContent>
        </Tooltip>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onPickImportFile}
        />
      </div>

      {/* Nav */}
      <div className="px-1 pb-1">
        <SectionLabel>导航</SectionLabel>
        <ul className="space-y-0.5 px-1">
          {NAV_ITEMS.map((item) =>
            item.kind === "route" ? (
              <NavRouteItem key={item.to} route={item} onNavigate={onNavigate} />
            ) : (
              // 弹窗型项:宿主弹窗渲染在本 ChatSidebar 内,手机抽屉里**不**调 onNavigate
              // 关抽屉(否则会连宿主一起卸载 → 弹窗闪现即消)。弹窗自带遮罩盖住抽屉,
              // 与「搜索」按钮同款(它也不关抽屉)。
              <NavModalItem
                key={item.key}
                item={item}
                active={modalKey === item.key}
                onClick={() => setModalKey(item.key)}
              />
            ),
          )}
          <li>
            <button
              type="button"
              onClick={() => setAgentManageOpen(true)}
              className={navItemCls(false)}
            >
              <NavItemInner icon={Bot} label="Agent 管理" active={false} />
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setLlmManageOpen(true)}
              className={navItemCls(false)}
            >
              <NavItemInner icon={BrainCircuit} label="LLM 模型" active={false} />
            </button>
          </li>
        </ul>
      </div>

      {/* Recents + 分组方式选择(参考 claude.ai 的 Group by 图标) */}
      <div className="flex items-center justify-between pr-1.5">
        <SectionLabel>Recents</SectionLabel>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              aria-label="对话分组方式"
              title="对话分组方式"
            >
              <ListFilter className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[140px]">
            <DropdownMenuLabel>分组方式</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => chooseGroupBy("none")}>
              <Check
                className={cn(
                  "h-3.5 w-3.5",
                  recentsGroupBy === "none" ? "opacity-100" : "opacity-0",
                )}
              />
              默认
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => chooseGroupBy("date")}>
              <Check
                className={cn(
                  "h-3.5 w-3.5",
                  recentsGroupBy === "date" ? "opacity-100" : "opacity-0",
                )}
              />
              按日期
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ScrollArea className="-mx-1 min-h-0 flex-1">
        <div className="px-1 pb-2">
          {sorted.length === 0 && (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              暂无对话
            </p>
          )}
          {/* 置顶分组:固定在列表最上方,不参与下面的日期分组。 */}
          {pinned.length > 0 && (
            <div className="mb-0.5">
              <div className="flex items-center gap-1 px-2 pb-1 pt-2.5 text-[10.5px] font-medium text-muted-foreground/60">
                <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                置顶
              </div>
              <ul className="space-y-0.5">{pinned.map(renderConvRow)}</ul>
            </div>
          )}
          {renderGroups.map((group) => (
            <div key={group.label || "_all"} className="mb-0.5">
              {/* 日期分组标题(参考 claude.ai);默认模式无标题 */}
              {group.label && (
                <div className="px-2 pb-1 pt-2.5 text-[10.5px] font-medium text-muted-foreground/60">
                  {group.label}
                </div>
              )}
              <ul className="space-y-0.5">{group.items.map(renderConvRow)}</ul>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* 跨设备同步:下行是"拉一次"式的,切回前台会自动拉;这里给个手动入口 ——
          两个窗口都在前台时(切焦点不触发 visibilitychange)靠它。 */}
      <SidebarSyncRow />

      {/* 登录账号 —— 固定在侧栏底部(参考 claude.ai 的用户区) */}
      <SidebarUserButton />

      {/* Shared modals */}
      <ConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`删除对话「${pendingDelete?.title ?? ""}」？`}
        description="该对话的所有消息将永久删除。已提交的评测记录不受影响。"
        onConfirm={() => pendingDelete && deleteConversation(pendingDelete.id)}
      />
      <ProfileManageDialog
        open={agentManageOpen}
        onOpenChange={setAgentManageOpen}
        kind="agent"
      />
      <ProfileManageDialog
        open={llmManageOpen}
        onOpenChange={setLlmManageOpen}
        kind="llm"
      />
      <ConversationSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <NavModal modalKey={modalKey} onOpenChange={(o) => !o && setModalKey(null)} />
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

const RECENTS_GROUPBY_KEY = "eval-platform:recents-groupby";

/**
 * 侧栏底部「同步」行 —— 手动触发下行拉取(跨设备同步的补充入口,自动触发见
 * use-qa-store 的 visibilitychange/focus)。手机上这一行就在左侧抽屉里,两端同一个入口,
 * 不需要为手机单独做一份。
 *
 * 时间文案只在 store 变化时算一次、不挂定时器 —— 这一行不值得为了让"N 分钟前"跳字
 * 每分钟唤醒一次整个侧栏重渲染。
 */
function SidebarSyncRow() {
  const { refetchFromServer, lastSyncedAt, isRefetching, refetchTimedOut } =
    useQAStore();
  return (
    <button
      type="button"
      onClick={() => void refetchFromServer({ force: true })}
      // m-3:isRefetching 卡 true 时(挂死的旧世代没有清掉标志)不能连按钮都点不动——
      // refetchTimedOut(见 use-qa-store.tsx)为真时说明这一发大概率已经挂死,放开按钮,
      // 让用户能用手动「同步」当逃生口自愈,而不是只能刷新页面。
      disabled={isRefetching && !refetchTimedOut}
      // 点了没反应时用户容易怀疑按钮坏了,所以把已知的闸门限制写进 title:本机有未上传的
      // 改动(outbox 没排空)或正在流式输出时,这次点击会被拦截、静默无效果,过一会再点即可。
      title="从服务器重新拉取会话与题目(跨设备同步)。若本机还有未上传完的改动,或正在流式输出回复,这次点击会被拦截、没有反应,等改动传完或输出结束后再点一次即可。"
      className="flex w-full shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60"
    >
      <RefreshCw className={cn("h-3 w-3 shrink-0", isRefetching && "animate-spin")} />
      <span className="min-w-0 flex-1 truncate">
        {isRefetching ? "同步中…" : `同步 · ${formatSyncedAgo(lastSyncedAt, Date.now())}`}
      </span>
    </button>
  );
}

/**
 * 侧栏底部「登录账号」区(参考 claude.ai):圆角方块头像 + 粗体名字 + 灰色邮箱。
 * 点击打开「个人信息」弹窗(内含登出)。折叠态只显示一个头像按钮。
 *
 * 名字优先取本地「评估人」资料 user.name(首登已用账号回填、且可在弹窗里改),
 * 回退到账号 me.name / 邮箱前缀;副行固定显示登录邮箱 me.email,标明「我是谁」。
 */
function SidebarUserButton({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useQAStore();
  const { me } = useAuth();
  const [open, setOpen] = useState(false);

  const name =
    user.name?.trim() || me?.name || me?.email?.split("@")[0] || "未命名";
  const email = me?.email ?? user.email ?? "";
  const initial = (name[0] ?? "?").toUpperCase();

  // 头像加载失败(如 Google lh3 头像被 referrer 拦截 / URL 失效)→ 回退到首字母,
  // **绝不**直接 display:none(那会只剩名字邮箱、没有头像)。erroredUrl 按 URL 记错,
  // 换了新头像 URL 会自动重试。
  const [erroredUrl, setErroredUrl] = useState<string | null>(null);
  const showImg = !!user.avatarUrl && erroredUrl !== user.avatarUrl;
  const avatar = showImg ? (
    <img
      src={user.avatarUrl}
      alt={name}
      referrerPolicy="no-referrer"
      className="h-8 w-8 shrink-0 rounded-md border border-border object-cover"
      onError={() => setErroredUrl(user.avatarUrl ?? null)}
    />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/15 text-[13px] font-semibold text-accent">
      {initial}
    </span>
  );

  if (collapsed) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="账号设置"
              className="rounded-md transition-shadow hover:ring-2 hover:ring-ring/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {avatar}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {name}
            {email ? ` · ${email}` : ""}
          </TooltipContent>
        </Tooltip>
        <UserProfileDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface/40 p-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="账号设置"
        className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-foreground">
            {name}
          </span>
          {email && (
            <span className="block truncate text-[11px] text-muted-foreground">
              {email}
            </span>
          )}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
      </button>
      <UserProfileDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

/** 会话时间 → 日期分组标签(参考 claude.ai):今天 / 昨天 / 同年「M月D日」/ 跨年「YYYY年M月D日」。 */
function dateGroupLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "更早";
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays <= 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 把已按时间倒序的会话切成连续的日期分组,保持原顺序。 */
function groupByDate<T extends { updatedAt: string }>(
  items: T[],
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const it of items) {
    const label = dateGroupLabel(it.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }
  return groups;
}

/** 导航项统一样式:hover 时强调淡底 + 轻微右移;选中=实底加粗。配 NavItemInner 用。 */
function navItemCls(active: boolean): string {
  return cn(
    "group relative flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
    active
      ? "bg-secondary font-medium text-foreground"
      : "text-foreground/70 hover:translate-x-0.5 hover:bg-accent/10 hover:text-foreground",
  );
}

/** 导航项内容:左侧强调竖条(选中常显 / hover 滑入)+ 图标(hover 转强调色)+ 文案。 */
function NavItemInner({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof Library;
  label: string;
  active: boolean;
}) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-all duration-150",
          active
            ? "opacity-100"
            : "scale-y-50 opacity-0 group-hover:scale-y-100 group-hover:opacity-100",
        )}
      />
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-colors",
          active
            ? "animate-twinkle text-accent"
            : "text-muted-foreground group-hover:text-accent",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </>
  );
}

function NavRouteItem({ route, onNavigate }: { route: RouteItem; onNavigate?: () => void }) {
  return (
    <li>
      <NavLink
        to={route.to}
        end={route.end}
        onClick={onNavigate}
        className={({ isActive }) => navItemCls(isActive)}
      >
        {({ isActive }) => (
          <NavItemInner icon={route.icon} label={route.label} active={isActive} />
        )}
      </NavLink>
    </li>
  );
}

function NavModalItem({
  item,
  active,
  onClick,
}: {
  item: ModalItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button type="button" onClick={onClick} className={navItemCls(active)}>
        <NavItemInner icon={item.icon} label={item.label} active={active} />
      </button>
    </li>
  );
}

function CollapsedNavLink({ route }: { route: RouteItem }) {
  const Icon = route.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={route.to}
          end={route.end}
          className={({ isActive }) =>
            cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md",
              isActive
                ? "bg-secondary text-foreground"
                : "text-foreground/70 hover:bg-secondary/60 hover:text-foreground",
            )
          }
          aria-label={route.label}
        >
          {({ isActive }) => <Icon className={cn("h-4 w-4", isActive && "animate-twinkle text-accent")} />}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{route.label}</TooltipContent>
    </Tooltip>
  );
}

function CollapsedNavButton({
  label,
  icon: Icon,
  onClick,
  active,
}: {
  label: string;
  icon: typeof Library;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md",
            active
              ? "bg-secondary text-foreground"
              : "text-foreground/70 hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          <Icon className={cn("h-4 w-4", active && "animate-twinkle text-accent")} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function NavModal({
  modalKey,
  onOpenChange,
}: {
  modalKey: ModalKey | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = modalKey !== null;
  const cfg = modalKey ? MODAL_CONFIG[modalKey] : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[min(96vw,1200px)] max-w-none flex-col gap-0 p-0">
        {cfg && (
          <>
            <DialogHeader className="shrink-0 space-y-1 border-b border-border px-5 py-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <HeaderIconBadge icon={cfg.icon} />
                {cfg.title}
              </DialogTitle>
              <DialogDescription className="text-[11.5px]">
                {cfg.subtitle}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-hidden p-4">
              {cfg.render()}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
