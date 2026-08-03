/**
 * Prompt 管理(/prompts)— 对齐 Langfuse / LangSmith / Phoenix 的最小正统集:
 * 左侧 prompt 目录,右侧详情 = 版本时间线(不可变) + 模板编辑器 + 变量参考 + 预览。
 * 编辑 = 保存为新版本并生效;回滚 = 把生效指针移回旧版本;恢复默认 = 指回最高内置版本
 * (通常是 v1;若该 prompt 有内置额外版本 builtinVersions,则指回最高内置版,如 v2)。
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileCode2,
  GitCompare,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { HomeButton } from "@/components/home-button";
import { HeaderIconBadge } from "@/components/header-icon-badge";
import { MasterDetailShell, useCloseMasterList } from "@/components/layout/master-detail-shell";
import { cn, formatRelativeTime } from "@/lib/utils";
import { diffSkill } from "@/lib/skillopt-diff";
import { buildJudgeVars } from "@/lib/judge";
import { buildGeneratorVars } from "@/lib/question-generator";
import { buildCaseGenVars } from "@/lib/skillopt-case-gen";
import { buildAdaptiveAnchor, buildAdaptiveFollowupVars } from "@/lib/adaptive-followup";
import { isSkillQuestion } from "@/lib/skill-question";
import { useQAStore } from "@/hooks/use-qa-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deletePromptVersion,
  findMissingVars,
  findUnknownVars,
  getPromptDefaultMeta,
  getPromptView,
  isValidVarName,
  listPrompts,
  renderTemplate,
  savePromptMeta,
  savePromptVersion,
  saveVarCustomization,
  setActivePromptVersion,
  type ManagedPromptView,
  type PromptCustomVar,
} from "@/lib/prompt-registry";

export function PromptsPage() {
  // 注册表是模块级状态(非 react state):用一个计数器驱动重读。
  const [rev, setRev] = useState(0);
  const prompts = useMemo(() => listPrompts(), [rev]);
  // 支持从「在 Prompt 管理查看/编辑」带 ?key=xxx 直达对应 prompt;非法/缺省回退第一条。
  const [searchParams] = useSearchParams();
  const requestedKey = searchParams.get("key");
  const [selectedKey, setSelectedKey] = useState<string>(
    () =>
      (requestedKey && prompts.some((p) => p.def.key === requestedKey)
        ? requestedKey
        : prompts[0]?.def.key) ?? "",
  );
  // URL 的 key 变化(已在本页时再点别处的 chip)→ 跟随切换。
  useEffect(() => {
    if (requestedKey && prompts.some((p) => p.def.key === requestedKey)) {
      setSelectedKey(requestedKey);
    }
  }, [requestedKey, prompts]);
  const view = useMemo(
    () => (selectedKey ? getPromptView(selectedKey) : null),
    [selectedKey, rev],
  );
  const refresh = () => setRev((v) => v + 1);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border bg-card px-5 py-3">
        <div className="flex items-center gap-2">
          <HomeButton />
          <HeaderIconBadge icon={FileCode2} />
          <h1 className="text-[15px] font-semibold text-foreground">
            Prompt 管理
          </h1>
          <span className="hidden text-[11.5px] text-muted-foreground md:inline">
            平台所有 LLM prompt 的版本化管理 —— 编辑=新建不可变版本并生效;回滚=指针移回旧版本;改坏自动回退内置默认
          </span>
        </div>
      </header>

      <MasterDetailShell
        listWidthClass="w-72"
        listClassName="overflow-y-auto border-r border-border bg-surface/40 p-3"
        listLabel="选择 Prompt"
        list={
          <PromptDirList
            prompts={prompts}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        }
      >
        {view ? (
          <PromptDetail key={view.def.key} view={view} onChanged={refresh} />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            选择左侧一个 prompt
          </div>
        )}
      </MasterDetailShell>
    </div>
  );
}

/**
 * 左侧 prompt 目录(list 插槽内容)。抽成独立组件是为了能在其内部调用
 * `useCloseMasterList()`——手机上点选目录项后关抽屉;桌面为 no-op。
 */
function PromptDirList({
  prompts,
  selectedKey,
  onSelect,
}: {
  prompts: ManagedPromptView[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const closeList = useCloseMasterList();
  return (
    <ul className="space-y-1.5">
      {prompts.map((p) => {
        const active = p.def.key === selectedKey;
        return (
          <li key={p.def.key}>
            <button
              type="button"
              onClick={() => {
                onSelect(p.def.key);
                closeList();
              }}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                active
                  ? "border-accent/50 bg-accent/10"
                  : "border-border bg-card hover:border-accent/30",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-foreground">
                  {p.def.name}
                </span>
                <Badge
                  variant={p.isCustomActive ? "accent" : "muted"}
                  className="ml-auto text-[9.5px]"
                >
                  {p.isCustomActive
                    ? `自定义 v${p.activeVersion}`
                    : "内置默认"}
                </Badge>
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {p.def.key} · {p.versions.length} 个版本
              </div>
              <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
                {p.def.description}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 页内浮层版 Prompt 管理:盖在当前界面上(**不跳路由** → 原界面与其选择 / 弹窗状态全保留),
 * 聚焦展示所点 prompt 的详情(版本 / 编辑 / 预览 / 对比)。关掉浮层即回到原样。
 * 供 PromptSourceChip 的「在 Prompt 管理查看 / 编辑」使用。
 */
export function PromptManagerDialog({
  promptKey,
  open,
  onOpenChange,
}: {
  promptKey: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [rev, setRev] = useState(0);
  const view = useMemo(
    () => (open ? getPromptView(promptKey) : null),
    [promptKey, open, rev],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[min(1200px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <FileCode2 className="h-4 w-4 text-accent" />
            Prompt 管理 · {view?.def.name ?? promptKey}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {view ? (
            <PromptDetail key={view.def.key} view={view} onChanged={() => setRev((v) => v + 1)} />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
              未找到该 prompt:{promptKey}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PromptDetail({
  view,
  onChanged,
}: {
  view: ManagedPromptView;
  onChanged: () => void;
}) {
  const { def } = view;
  // 内置版本(v1 及内置额外版):不可删、且是「恢复内置默认」的落点(取最高内置号)。
  const isBuiltinVersion = (n: number) => view.builtinVersionNumbers.includes(n);
  const defaultBuiltinVersion = Math.max(...view.builtinVersionNumbers);
  // 正在查看的版本(默认 = 生效版本);编辑器内容跟随所看版本初始化。
  const [viewVersion, setViewVersion] = useState(view.activeVersion);
  const shown =
    view.versions.find((v) => v.version === viewVersion) ?? view.versions[0];
  const [draft, setDraft] = useState(shown.content);
  const [note, setNote] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRaw, setPreviewRaw] = useState(false);
  const [varsOpen, setVarsOpen] = useState(false);
  // 版本对比:基准版本号;对比对象 = 版本号 或 "draft"(当前编辑内容)。
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffBase, setDiffBase] = useState<number>(1);
  const [diffTarget, setDiffTarget] = useState<number | "draft">("draft");
  const [metaOpen, setMetaOpen] = useState(false);

  const knownVars = [
    ...view.builtinVars.map((v) => v.name),
    ...view.customVars.map((v) => v.name),
  ];
  const unknown = findUnknownVars(draft, knownVars);
  // 「未使用」只提示内置变量(数据块);自定义变量本来就是可选的。
  const missing = findMissingVars(
    draft,
    view.builtinVars.map((v) => v.name),
  );
  const dirty = draft !== shown.content;

  // ---- 预览数据源:内置示例 或 平台真实数据(题库题 / 标准员工) ----
  const { questions, conversations, standardEmployees, configuredEmployeeIds, floorElements } = useQAStore();
  const [previewSource, setPreviewSource] = useState("sample");

  const configuredEmployees = useMemo(
    () => standardEmployees.filter((e) => configuredEmployeeIds.includes(e.id)),
    [standardEmployees, configuredEmployeeIds],
  );

  const sourceOptions = useMemo(() => {
    if (def.key === "llm-judge" || def.key === "adaptive-followup") {
      return questions
        .filter((q) => !isSkillQuestion(q))
        .map((q) => ({ value: q.id, label: `${q.number} ${q.title}` }));
    }
    if (def.key === "ai-question-gen" || def.key === "skillopt-case-gen") {
      return configuredEmployees.map((e) => ({
        value: e.id,
        label: `${e.name} · ${e.title}`,
      }));
    }
    return [];
  }, [def.key, questions, configuredEmployees]);

  const previewVars = useMemo(() => {
    const customValues = Object.fromEntries(
      view.customVars.map((v) => [v.name, v.value]),
    );
    // 还原某题最近作答会话的多轮对话(judge / 自适应预览共用)。
    const dialogueOf = (qid: string): { user: string; assistant: string }[] => {
      let pairs: { user: string; assistant: string }[] = [];
      let latestAt = "";
      for (const conv of conversations) {
        const msgs = conv.messages.filter(
          (m) => m.questionId === qid && !m.isStreaming,
        );
        const lastAssistant = [...msgs]
          .reverse()
          .find((m) => m.role === "assistant" && !m.interrupted);
        if (!lastAssistant) continue;
        if (lastAssistant.createdAt <= latestAt) continue;
        latestAt = lastAssistant.createdAt;
        const p: { user: string; assistant: string }[] = [];
        for (const m of msgs) {
          if (m.role === "user") p.push({ user: m.content, assistant: "" });
          else if (m.role === "assistant" && p.length > 0 && !p[p.length - 1].assistant) {
            p[p.length - 1].assistant = m.content;
          }
        }
        pairs = p.filter((x) => x.assistant);
      }
      return pairs;
    };
    let real: Record<string, string> | null = null;
    if (previewSource !== "sample") {
      if (def.key === "llm-judge") {
        const q = questions.find((x) => x.id === previewSource);
        if (q) {
          const pairs = dialogueOf(q.id);
          const answer =
            pairs.length > 0
              ? pairs[pairs.length - 1].assistant
              : "(该题在平台里还没有真实回答 —— 此处为占位,运行时会注入 Agent 的实际回答。)";
          real = buildJudgeVars({
            question: q,
            userPrompt: q.prompt,
            agentAnswer: answer,
            dialogue: pairs.length > 1 ? pairs : undefined,
            toolEvents: null,
          });
        }
      } else if (def.key === "adaptive-followup") {
        const q = questions.find((x) => x.id === previewSource);
        if (q) {
          // 随对话变化:用这道题**最近一段真实对话**渲染,选不同题/对话越长 → 预览不同。
          // 考点锚从这道题派生(与 store 实跑、判分侧同源);goal 留空 → 走「本次侧重未指定」兜底。
          const pairs = dialogueOf(q.id);
          real = buildAdaptiveFollowupVars({
            anchor: buildAdaptiveAnchor(q, floorElements),
            goal: "",
            dialogue:
              pairs.length > 0
                ? pairs
                : [
                    {
                      user: q.prompt,
                      assistant: "(该题还没真实回答,运行时这里是 Agent 的实际回答)",
                    },
                  ],
            answeredTurns: Math.max(1, pairs.length),
            maxTurns: 4,
            mode: "auto",
          });
        }
      } else if (def.key === "ai-question-gen") {
        const se = standardEmployees.find((e) => e.id === previewSource);
        if (se) {
          real = buildGeneratorVars({
            employee: se,
            counts: { easy: 1, medium: 1, hard: 1 },
            mode: "standard",
          });
        }
      } else if (def.key === "skillopt-case-gen") {
        const se = standardEmployees.find((e) => e.id === previewSource);
        if (se) {
          // 技能正文需异步取 platform/repo,预览暂用示例正文,员工画像用真实数据。
          real = buildCaseGenVars({
            skillName: def.sampleVars.skillName,
            skillBody: def.sampleVars.skillBody,
            employee: se,
          });
        }
      }
    }
    return { ...customValues, ...(real ?? def.sampleVars) };
  }, [previewSource, view.customVars, def, questions, conversations, standardEmployees, floorElements]);

  const switchVersion = (v: number) => {
    const target = view.versions.find((x) => x.version === v);
    if (!target) return;
    setViewVersion(v);
    setDraft(target.content);
  };

  // 删除自定义版本(v≥2);内置默认 v1 不可删。删的若是正在看的版本,跳到删后生效版本。
  const handleDeleteVersion = (v: number) => {
    if (v === 1) return;
    if (!window.confirm(`确定删除 v${v}?该版本将被移除,不可恢复。`)) return;
    const nextActive = deletePromptVersion(def.key, v);
    if (viewVersion === v) switchVersion(nextActive);
    onChanged();
  };

  const handleSave = () => {
    if (!draft.trim() || unknown.length > 0) return;
    const nv = savePromptVersion(def.key, draft, note);
    setNote("");
    setViewVersion(nv);
    onChanged();
  };

  // 选中版本的统计:字数 / 行数 / 上一版 / 相比上一版的增删行(喂版本详情面板)。
  const shownStats = useMemo(() => {
    const chars = shown.content.length;
    const lines = shown.content.split("\n").length;
    const prev = view.versions
      .filter((v) => v.version < shown.version)
      .sort((a, b) => b.version - a.version)[0];
    let adds = 0;
    let dels = 0;
    if (prev) {
      const d = diffSkill(prev.content, shown.content);
      adds = d.filter((l) => l.type === "add").length;
      dels = d.filter((l) => l.type === "del").length;
    }
    return { chars, lines, prev, adds, dels };
  }, [shown, view.versions]);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* 版本列:统计头 + 竖向时间线 + 选中版本详情面板(常驻底部) */}
      {/* 手机上下堆叠时给版本列限高(否则版本多了它把右侧编辑区连底部保存条一起挤出屏幕,
          且这条链上没有滚动容器 → 被 Shell 的 overflow-hidden 裁掉、保存按钮点不到)。
          桌面是左右分栏、有自己的滚动,md: 起取消限高。 */}
      <div className="flex max-h-[38vh] w-full shrink-0 flex-col overflow-hidden border-b border-border md:max-h-none md:w-60 md:border-b-0 md:border-r">
        {/* 头:标题 + 汇总 */}
        <div className="shrink-0 border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <History className="h-3 w-3" /> 版本(不可变)
          </div>
          <div className="mt-1 text-[11px] text-foreground">
            共 <strong>{view.versions.length}</strong> 版 · 生效{" "}
            <span className="font-mono text-success">v{view.activeVersion}</span>
          </div>
        </div>

        {/* 竖向时间线(点 + 连线;可滚动) */}
        <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {[...view.versions].reverse().map((v, idx, arr) => {
            const isActive = v.version === view.activeVersion;
            const isShown = v.version === viewVersion;
            const isLast = idx === arr.length - 1;
            return (
              <li key={v.version} className="relative flex gap-2">
                {/* 轨道:节点圆点 + 向下连线 */}
                <div className="relative flex w-3 shrink-0 flex-col items-center">
                  <span
                    className={cn(
                      "z-10 mt-2 h-2.5 w-2.5 rounded-full border-2 bg-card",
                      isShown ? "border-accent bg-accent" : isActive ? "border-success" : "border-border",
                    )}
                  />
                  {!isLast && <span className="w-px flex-1 bg-border" />}
                </div>
                {/* 版本卡 */}
                <button
                  type="button"
                  onClick={() => switchVersion(v.version)}
                  className={cn(
                    "mb-1.5 min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left transition-colors",
                    isShown ? "border-accent/50 bg-accent/10" : "border-transparent hover:bg-secondary/50",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[11.5px]">
                    <span className="font-mono font-medium">v{v.version}</span>
                    {isBuiltinVersion(v.version) && (
                      <span className="text-[10px] text-muted-foreground">
                        {v.version === 1 ? "内置默认" : "内置"}
                      </span>
                    )}
                    {isActive ? (
                      <Badge variant="success" className="ml-auto h-4 px-1 text-[9px]">生效中</Badge>
                    ) : isShown ? (
                      <span className="ml-auto text-[9.5px] text-accent">查看中</span>
                    ) : null}
                  </div>
                  {v.createdAt && (
                    <div className="mt-0.5 text-[9.5px] text-muted-foreground">
                      {formatRelativeTime(v.createdAt)}
                    </div>
                  )}
                  {v.note && v.version !== 1 && (
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{v.note}</div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* 选中版本详情面板 */}
        <div className="shrink-0 space-y-1.5 border-t border-border bg-surface/40 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">选中</span>
            <span className="font-mono font-semibold text-foreground">v{shown.version}</span>
            {shown.version === view.activeVersion ? (
              <Badge variant="success" className="h-4 px-1 text-[9px]">生效中</Badge>
            ) : (
              <span className="text-[9.5px] text-accent">查看中</span>
            )}
            {shown.createdAt && (
              <span className="ml-auto text-[9.5px] text-muted-foreground">
                {formatRelativeTime(shown.createdAt)} 创建
              </span>
            )}
          </div>
          {shown.version === 1 ? (
            <div className="text-[10.5px] text-muted-foreground">平台内置基线版本。</div>
          ) : shown.note ? (
            <div className="text-[10.5px] leading-relaxed text-foreground/80">备注:{shown.note}</div>
          ) : (
            <div className="text-[10.5px] text-muted-foreground/70">(无备注)</div>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>{shownStats.chars} 字</span>
            <span>·</span>
            <span>{shownStats.lines} 行</span>
            {shownStats.prev && (
              <>
                <span>·</span>
                <span>
                  比 v{shownStats.prev.version}:
                  <span className="text-success"> +{shownStats.adds}</span>
                  <span className="text-destructive"> -{shownStats.dels}</span> 行
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {shown.version !== view.activeVersion && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 flex-1 gap-1 text-[10.5px]"
                onClick={() => {
                  setActivePromptVersion(def.key, shown.version);
                  onChanged();
                }}
              >
                <CheckCircle2 className="h-3 w-3" /> 设为生效
              </Button>
            )}
            {shownStats.prev && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 flex-1 gap-1 text-[10.5px]"
                onClick={() => {
                  setDiffBase(shownStats.prev!.version);
                  setDiffTarget(shown.version);
                  setDiffOpen(true);
                }}
              >
                <GitCompare className="h-3 w-3" /> 对比上版
              </Button>
            )}
          </div>
          {!isBuiltinVersion(shown.version) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-full gap-1 text-[10.5px] text-destructive hover:text-destructive"
              onClick={() => handleDeleteVersion(shown.version)}
            >
              <Trash2 className="h-3 w-3" /> 删除此版本
            </Button>
          )}
          {view.isCustomActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-full gap-1 text-[10.5px] text-muted-foreground"
              onClick={() => {
                setActivePromptVersion(def.key, defaultBuiltinVersion);
                switchVersion(defaultBuiltinVersion);
                onChanged();
              }}
            >
              <RotateCcw className="h-3 w-3" /> 恢复内置默认
            </Button>
          )}
        </div>
      </div>

      {/* 右主区:固定布局 —— 元信息(顶) + 模板框(中·内部滚动) + 动作按钮(底·常驻)
          min-h-0 必须有:Tailwind 的 flex-1 不含 min-height:0,列向 flex 下该项不肯缩到
          min-content 以下 → 手机堆叠时把底部动作条挤出可视区、内部也滚不动。 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 顶:元信息 + 变量(shrink-0;变量多则自身滚动,不挤压编辑器/按钮)*/}
        <div className="shrink-0 space-y-3 border-b border-border p-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold text-foreground">
                {def.name}
              </h2>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {def.key}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-6 gap-1 px-2 text-[10.5px]"
                onClick={() => setMetaOpen(true)}
              >
                <Pencil className="h-3 w-3" /> 编辑信息
              </Button>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {def.description}
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground/80">
              调用点:{def.usage}
            </p>
          </div>

          {/* 变量参考(说明可改;另可增删自定义固定值变量) */}
          <section className="rounded-lg border border-border bg-card p-3">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <span>
                变量(内置=运行时由代码注入;在模板里用 {"{{变量名}}"} 引用)
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-6 gap-1 px-2 text-[10.5px]"
                onClick={() => setVarsOpen(true)}
              >
                <Pencil className="h-3 w-3" /> 管理变量
              </Button>
            </div>
            <ul className="max-h-28 space-y-1 overflow-y-auto pr-1">
              {view.builtinVars.map((v) => (
                <li key={v.name} className="flex items-baseline gap-2 text-[11px]">
                  <code className="shrink-0 rounded bg-secondary px-1 py-px font-mono text-[10px]">
                    {`{{${v.name}}}`}
                  </code>
                  <span className="text-muted-foreground">{v.description}</span>
                </li>
              ))}
              {view.customVars.map((v) => (
                <li key={v.name} className="flex items-baseline gap-2 text-[11px]">
                  <code className="shrink-0 rounded bg-accent/15 px-1 py-px font-mono text-[10px] text-accent">
                    {`{{${v.name}}}`}
                  </code>
                  <span className="text-muted-foreground">
                    {v.description || "自定义变量"}
                    <span className="ml-1 text-muted-foreground/70">
                      = {v.value.length > 40 ? v.value.slice(0, 40) + "…" : v.value || "(空)"}
                    </span>
                  </span>
                  <Badge variant="accent" className="ml-auto h-4 shrink-0 px-1 text-[9px]">
                    自定义
                  </Badge>
                </li>
              ))}
            </ul>
          </section>

          <VariableManagerDialog
            open={varsOpen}
            onOpenChange={setVarsOpen}
            view={view}
            onSaved={onChanged}
          />
          <PromptMetaDialog
            open={metaOpen}
            onOpenChange={setMetaOpen}
            view={view}
            onSaved={onChanged}
          />
        </div>

        {/* 中:模板编辑器 —— 占满剩余高度,内容长则在框内上下滚动 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-3">
          <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              模板内容(正在看 v{viewVersion}
              {viewVersion === view.activeVersion ? " · 生效中" : ""})
            </span>
            {dirty && <Badge variant="accent" className="h-4 px-1 text-[9px]">已修改</Badge>}
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none font-mono text-[12px] leading-relaxed"
          />
        </div>

        {/* 底:校验提示 + 动作按钮 —— shrink-0 常驻,绝不被长内容挤出视野 */}
        <div className="shrink-0 space-y-2 border-t border-border p-4 pt-3">
            {unknown.length > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                未知占位符:{unknown.map((n) => `{{${n}}}`).join("、")} —— 不在变量表里(拼写错误?)。带未知占位符无法保存;即使绕过,运行时也会自动回退内置默认。
              </p>
            )}
            {missing.length > 0 && unknown.length === 0 && (
              <p className="flex items-start gap-1.5 text-[11px] text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                未使用的变量:{missing.map((n) => `{{${n}}}`).join("、")} —— 对应数据块不会出现在最终 prompt 里(确认是有意删除再保存)。
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 gap-y-2">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="版本备注(可选,如:收紧判分口径)"
                className="h-8 max-w-xs text-[12px]"
              />
              <Button
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                disabled={!dirty || !draft.trim() || unknown.length > 0}
                onClick={handleSave}
              >
                <Save className="h-3.5 w-3.5" /> 保存为新版本并生效
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => setPreviewOpen(true)}
              >
                <Eye className="h-3.5 w-3.5" /> 预览(示例变量)
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                disabled={view.versions.length < 2 && !dirty}
                title={
                  view.versions.length < 2 && !dirty
                    ? "还没有可对比的版本(先保存一个自定义版本或修改编辑器内容)"
                    : undefined
                }
                onClick={() => {
                  // 默认:基准 = 当前查看版本的上一版(没有就 v1),对比 = 当前编辑内容。
                  const nums = view.versions.map((v) => v.version);
                  const prev = [...nums].filter((n) => n < viewVersion).pop();
                  setDiffBase(prev ?? 1);
                  setDiffTarget("draft");
                  setDiffOpen(true);
                }}
              >
                <GitCompare className="h-3.5 w-3.5" /> 版本对比
              </Button>
            </div>
        </div>
      </div>

      {/* 预览弹窗:MD 渲染(可切原文) */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[85vh] w-[min(880px,95vw)] max-w-none flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[14px]">
              <Eye className="h-3.5 w-3.5 text-foreground/70" />
              编译预览 · {def.name}
              <button
                type="button"
                onClick={() => setPreviewRaw((v) => !v)}
                className="ml-auto mr-4 rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {previewRaw ? "MD 渲染" : "查看原文"}
              </button>
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>数据源:</span>
            <select
              value={previewSource}
              onChange={(e) => setPreviewSource(e.target.value)}
              className="h-7 max-w-72 rounded border border-border bg-card px-1.5 text-[11.5px] text-foreground"
            >
              <option value="sample">内置示例数据</option>
              {sourceOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span>
              {def.key === "llm-judge"
                ? "选题库真题 → 变量按真实运行同一套代码计算(自动带该题最近的真实回答/多轮对话)"
                : def.key === "adaptive-followup"
                  ? "选一道题 → 按它**最近一段真实对话**渲染(对话/轮次是 {{变量}},随对话变化;模板本身固定可版本化)"
                  : def.key === "skillopt-case-gen"
                    ? "选标准员工 → 员工画像用真实数据(技能正文暂用示例)"
                    : "选标准员工 → 变量按真实运行同一套代码计算"}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card p-3">
            {previewRaw ? (
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/90">
                {renderTemplate(draft, previewVars)}
              </pre>
            ) : (
              <Markdown>{renderTemplate(draft, previewVars)}</Markdown>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 版本对比弹窗:左右两列 split diff(红删绿增) */}
      <DiffDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        view={view}
        draft={draft}
        dirty={dirty}
        base={diffBase}
        target={diffTarget}
        onBaseChange={setDiffBase}
        onTargetChange={setDiffTarget}
      />
    </div>
  );
}

/**
 * 编辑信息弹窗:改 prompt 的名称 / 描述 / 调用点(元信息覆盖,落本地 + 同步)。
 * key(主键)不可改;留空或与内置默认相同即恢复默认。
 */
function PromptMetaDialog({
  open,
  onOpenChange,
  view,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  view: ManagedPromptView;
  onSaved: () => void;
}) {
  const { def } = view;
  const [name, setName] = useState(def.name);
  const [description, setDescription] = useState(def.description);
  const [usage, setUsage] = useState(def.usage);

  // 每次打开按当前(已套覆盖的)值初始化。
  useEffect(() => {
    if (!open) return;
    setName(def.name);
    setDescription(def.description);
    setUsage(def.usage);
  }, [open, def]);

  const defaults = getPromptDefaultMeta(def.key);
  const isDefault =
    name.trim() === defaults.name &&
    description.trim() === defaults.description &&
    usage.trim() === defaults.usage;

  const handleSave = () => {
    if (!name.trim()) return; // 名称不能空
    savePromptMeta(def.key, { name, description, usage });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            编辑信息 ·{" "}
            <span className="font-mono text-[12px] text-muted-foreground">{def.key}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
            名称
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-[12.5px]"
            />
          </label>
          <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
            描述
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="text-[12px]"
            />
          </label>
          <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
            调用点
            <Input
              value={usage}
              onChange={(e) => setUsage(e.target.value)}
              className="h-8 text-[12.5px]"
            />
          </label>
          <p className="text-[10px] text-muted-foreground/80">
            留空或与默认一致即恢复内置默认。key(主键)不可改。
          </p>
        </div>
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-[11.5px] text-muted-foreground"
            disabled={isDefault}
            onClick={() => {
              setName(defaults.name);
              setDescription(defaults.description);
              setUsage(defaults.usage);
            }}
          >
            <RotateCcw className="h-3 w-3" /> 恢复默认
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" disabled={!name.trim()} onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 变量管理弹窗:
 *   - 内置变量(代码注入):只能改「说明」,不能删 / 改名(删了代码照样注入);
 *   - 自定义变量:增删改查,name + 说明 + 固定值,编译时注入,可在模板里 {{引用}}。
 */
function VariableManagerDialog({
  open,
  onOpenChange,
  view,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  view: ManagedPromptView;
  onSaved: () => void;
}) {
  const { def } = view;
  const [descs, setDescs] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<PromptCustomVar[]>([]);

  // 每次打开按当前视图初始化草稿。
  useEffect(() => {
    if (!open) return;
    setDescs(
      Object.fromEntries(view.builtinVars.map((v) => [v.name, v.description])),
    );
    setCustom(view.customVars.map((v) => ({ ...v })));
  }, [open, view]);

  const builtinNames = new Set(def.variables.map((v) => v.name));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const v of custom) {
    const name = v.name.trim();
    if (!name) problems.push("有自定义变量没填名字");
    else if (!isValidVarName(name))
      problems.push(`变量名「${name}」非法(只能用字母 / 数字 / _ . -)`);
    else if (builtinNames.has(name))
      problems.push(`「${name}」与内置变量重名`);
    else if (seen.has(name)) problems.push(`「${name}」重复`);
    seen.add(name);
  }

  const handleSave = () => {
    if (problems.length > 0) return;
    saveVarCustomization(def.key, { descOverrides: descs, customVars: custom });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>管理变量 · {def.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {/* 内置变量:改说明 */}
          <section className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">
              内置变量(代码注入,只能改说明)
            </div>
            {view.builtinVars.map((v) => (
              <div key={v.name} className="flex items-center gap-2">
                <code className="w-36 shrink-0 truncate rounded bg-secondary px-1.5 py-1 font-mono text-[10.5px]">
                  {`{{${v.name}}}`}
                </code>
                <Input
                  value={descs[v.name] ?? ""}
                  onChange={(e) =>
                    setDescs((d) => ({ ...d, [v.name]: e.target.value }))
                  }
                  className="h-7 flex-1 text-[11.5px]"
                />
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground/80">
              说明只是文档;清空或与默认一致即恢复默认说明。
            </p>
          </section>

          {/* 自定义变量:增删改 */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <span>自定义变量(固定值,编译时注入;模板里用 {"{{名字}}"} 引用)</span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-6 gap-1 px-2 text-[10.5px]"
                onClick={() =>
                  setCustom((c) => [...c, { name: "", description: "", value: "" }])
                }
              >
                <Plus className="h-3 w-3" /> 新增变量
              </Button>
            </div>
            {custom.length === 0 && (
              <p className="rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                还没有自定义变量。「新增变量」后,把公共片段(如统一的语气要求 / 公司背景)抽成变量,在模板里复用。
              </p>
            )}
            {custom.map((v, i) => (
              <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={v.name}
                    onChange={(e) =>
                      setCustom((c) =>
                        c.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      )
                    }
                    placeholder="变量名(字母/数字/_.-)"
                    className="h-7 w-44 font-mono text-[11px]"
                  />
                  <Input
                    value={v.description}
                    onChange={(e) =>
                      setCustom((c) =>
                        c.map((x, j) =>
                          j === i ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="说明(可选)"
                    className="h-7 flex-1 text-[11.5px]"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setCustom((c) => c.filter((_, j) => j !== i))}
                    aria-label="删除变量"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Textarea
                  value={v.value}
                  onChange={(e) =>
                    setCustom((c) =>
                      c.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                  placeholder="变量值(固定文本,编译时替换进模板)"
                  rows={2}
                  className="font-mono text-[11px]"
                />
              </div>
            ))}
            {problems.length > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {problems.join(";")}
              </p>
            )}
          </section>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={problems.length > 0} onClick={handleSave}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** split 视图的一行:左 = 基准侧(same/del),右 = 对比侧(same/add),null = 该侧空位。 */
interface SplitRow {
  left: { text: string; type: "same" | "del" } | null;
  right: { text: string; type: "same" | "add" } | null;
}

/** 把行级 diff 折成左右对齐的 split 行(改动块内删除行与新增行逐行配对)。 */
function toSplitRows(lines: ReturnType<typeof diffSkill>): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === "same") {
      rows.push({
        left: { text: lines[i].text, type: "same" },
        right: { text: lines[i].text, type: "same" },
      });
      i++;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < lines.length && lines[i].type !== "same") {
      if (lines[i].type === "del") dels.push(lines[i].text);
      else adds.push(lines[i].text);
      i++;
    }
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      rows.push({
        left: k < dels.length ? { text: dels[k], type: "del" } : null,
        right: k < adds.length ? { text: adds[k], type: "add" } : null,
      });
    }
  }
  return rows;
}

/**
 * 版本对比弹窗:基准版本 → 对比对象(某版本 / 当前编辑内容),
 * 左右两列 split diff —— 左列红 = 基准里被删的行,右列绿 = 对比侧新增的行。
 */
function DiffDialog({
  open,
  onOpenChange,
  view,
  draft,
  dirty,
  base,
  target,
  onBaseChange,
  onTargetChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  view: ManagedPromptView;
  draft: string;
  dirty: boolean;
  base: number;
  target: number | "draft";
  onBaseChange: (v: number) => void;
  onTargetChange: (v: number | "draft") => void;
}) {
  const contentOf = (v: number | "draft"): string =>
    v === "draft"
      ? draft
      : view.versions.find((x) => x.version === v)?.content ?? "";
  const labelOf = (v: number | "draft"): string =>
    v === "draft"
      ? dirty
        ? "当前编辑内容(未保存)"
        : "当前编辑内容"
      : `v${v}${v === 1 ? " 内置默认" : ""}${v === view.activeVersion ? "(生效中)" : ""}`;

  const lines = useMemo(
    () => diffSkill(contentOf(base), contentOf(target)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, target, draft, view],
  );
  const rows = useMemo(() => toSplitRows(lines), [lines]);
  const adds = lines.filter((l) => l.type === "add").length;
  const dels = lines.filter((l) => l.type === "del").length;

  const VersionSelect = ({
    value,
    onChange,
    allowDraft,
  }: {
    value: number | "draft";
    onChange: (v: number | "draft") => void;
    allowDraft: boolean;
  }) => (
    <select
      value={String(value)}
      onChange={(e) =>
        onChange(e.target.value === "draft" ? "draft" : Number(e.target.value))
      }
      className="h-7 rounded border border-border bg-card px-1.5 text-[11.5px] text-foreground"
    >
      {view.versions.map((v) => (
        <option key={v.version} value={v.version}>
          {labelOf(v.version)}
        </option>
      ))}
      {allowDraft && <option value="draft">{labelOf("draft")}</option>}
    </select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(1200px,96vw)] max-w-none flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <GitCompare className="h-3.5 w-3.5 text-foreground/70" />
            版本对比 · {view.def.name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
          <VersionSelect
            value={base}
            onChange={(v) => onBaseChange(v as number)}
            allowDraft={false}
          />
          <span>→</span>
          <VersionSelect value={target} onChange={onTargetChange} allowDraft />
          <span className="ml-auto font-mono text-[12px] tabular-nums">
            <span className="text-success">+{adds}</span>{" "}
            <span className="text-destructive">−{dels}</span>
          </span>
        </div>
        {adds === 0 && dels === 0 ? (
          <p className="p-8 text-center text-[12px] text-muted-foreground">
            两个版本内容完全一致。
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
            {/* 列头 */}
            <div className="sticky top-0 z-10 grid grid-cols-1 divide-y divide-border border-b border-border bg-card text-[11px] font-medium text-muted-foreground md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="px-3 py-1.5">{labelOf(base)}</div>
              <div className="px-3 py-1.5">{labelOf(target)}</div>
            </div>
            <div className="font-mono text-[11px] leading-relaxed">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-1 divide-y divide-border/60 md:grid-cols-2 md:divide-x md:divide-y-0">
                  <div
                    className={cn(
                      "whitespace-pre-wrap break-words px-3",
                      r.left?.type === "del" &&
                        "bg-destructive/10 text-destructive",
                      r.left?.type === "same" && "text-foreground/70",
                      r.left === null && "bg-muted/30",
                    )}
                  >
                    {r.left
                      ? `${r.left.type === "del" ? "- " : "  "}${r.left.text || " "}`
                      : " "}
                  </div>
                  <div
                    className={cn(
                      "whitespace-pre-wrap break-words px-3",
                      r.right?.type === "add" && "bg-success/15 text-success",
                      r.right?.type === "same" && "text-foreground/70",
                      r.right === null && "bg-muted/30",
                    )}
                  >
                    {r.right
                      ? `${r.right.type === "add" ? "+ " : "  "}${r.right.text || " "}`
                      : " "}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
