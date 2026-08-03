import { Cpu, FileCode2, Play, RotateCcw, SlidersHorizontal, Square } from "lucide-react";

import { CaseGenerator } from "@/components/skillopt/case-generator";
import type { SkillOptCase } from "@/lib/question-to-skillopt-case";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InfoHint } from "@/components/skillopt/info-hint";
import { SkillBrowser } from "@/components/skillopt/skill-browser";
import type { AgentProfile } from "@/agents/types";
import type { StandardEmployee } from "@/types";
import type { SeedSkillSelection } from "@/components/skillopt/skill-browser";

export function RunConfigCard({
  status,
  epochs,
  setEpochs,
  profileId,
  setProfileId,
  llmProfiles,
  setSeedContent,
  canRun,
  errMsg,
  onStart,
  onStop,
  skillName,
  skillBody,
  employee,
  setSeedSkill,
  skillCaseCount,
  caseBuildCanRun,
  caseShortfall,
  onSaveCases,
  targetModel,
  setTargetModel,
  optimizerModel,
  setOptimizerModel,
  gateMetric,
  setGateMetric,
  skillUpdateMode,
  setSkillUpdateMode,
  useSlowUpdate,
  setUseSlowUpdate,
  useMetaSkill,
  setUseMetaSkill,
  editBudget,
  setEditBudget,
  lrScheduler,
  setLrScheduler,
  reasoningEffort,
  setReasoningEffort,
  batchSize,
  setBatchSize,
  analystWorkers,
  setAnalystWorkers,
  useGate,
  setUseGate,
}: {
  status: "idle" | "running" | "done" | "error";
  epochs: number;
  setEpochs: (n: number) => void;
  profileId: string;
  setProfileId: (id: string) => void;
  llmProfiles: AgentProfile[];
  setSeedContent: (v: string) => void;
  canRun: boolean;
  errMsg: string;
  onStart: () => void;
  onStop: () => void;
  skillName: string;
  skillBody: string;
  employee: StandardEmployee | null;
  setSeedSkill: (s: SeedSkillSelection | null) => void;
  skillCaseCount: number;
  caseBuildCanRun: boolean;
  caseShortfall: number;
  onSaveCases: (cases: SkillOptCase[]) => void;
  targetModel: string;
  setTargetModel: (v: string) => void;
  optimizerModel: string;
  setOptimizerModel: (v: string) => void;
  gateMetric: "" | "hard" | "soft" | "mixed";
  setGateMetric: (v: "" | "hard" | "soft" | "mixed") => void;
  skillUpdateMode: "" | "patch" | "rewrite_from_suggestions";
  setSkillUpdateMode: (v: "" | "patch" | "rewrite_from_suggestions") => void;
  useSlowUpdate: boolean | null;
  setUseSlowUpdate: (v: boolean | null) => void;
  useMetaSkill: boolean | null;
  setUseMetaSkill: (v: boolean | null) => void;
  editBudget: number;
  setEditBudget: (v: number) => void;
  lrScheduler: "" | "constant" | "linear" | "cosine";
  setLrScheduler: (v: "" | "constant" | "linear" | "cosine") => void;
  reasoningEffort: "" | "low" | "medium" | "high";
  setReasoningEffort: (v: "" | "low" | "medium" | "high") => void;
  batchSize: number;
  setBatchSize: (v: number) => void;
  analystWorkers: number;
  setAnalystWorkers: (v: number) => void;
  useGate: boolean | null;
  setUseGate: (v: boolean | null) => void;
}) {
  // 被测/优化器只换"模型名",一律沿用上面「连接」的端点 + 密钥。
  // 故选项只列模型名(不带 profile 名),避免误以为在选另一条完整 profile/端点。
  const modelOpts: { model: string; label: string }[] = [];
  const seenModels = new Set<string>();
  for (const p of llmProfiles) {
    const m = String((p.config as Record<string, unknown>)?.model ?? "").trim();
    if (!m || seenModels.has(m)) continue;
    seenModels.add(m);
    modelOpts.push({ model: m, label: m });
  }

  return (
    <TooltipProvider delayDuration={150}>
    <Card className="space-y-5 p-5">
      {/* ── 模型 ── */}
      <Section icon={Cpu} title="模型">
        <Grid>
          <Field className="sm:col-span-2" label="连接(端点 / 凭据 / 默认模型)" hint="提供 base_url + api_key + 默认模型 的 LLM profile。整个 run 的端点与密钥只来自这里;下面「被测/优化器」只在这条连接上换模型名。">
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger className="h-8 w-full"><SelectValue placeholder="选择 LLM profile" /></SelectTrigger>
              <SelectContent>
                {llmProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {(p.config as Record<string, unknown>)?.model ? ` · ${String((p.config as Record<string, unknown>).model)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {llmProfiles.length === 0 && (
              <span className="mt-1 block text-[11px] text-warning">还没配 LLM —— 去「Agent 管理」加一个。</span>
            )}
          </Field>
          <Field label="被测模型 (target)" hint="被优化的 skill 实际驱动、并被打分的模型。只换模型名,沿用上面「连接」的端点与密钥;留空=用上面连接的默认模型。">
            <Select value={targetModel || "default"} onValueChange={(v) => setTargetModel(v === "default" ? "" : v)}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认(同上面连接的模型)</SelectItem>
                {modelOpts.map((m) => (<SelectItem key={m.model} value={m.model}>{m.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="优化器模型 (optimizer)" hint="反思失败轨迹、产出 skill 改写建议的模型。同样沿用上面「连接」的端点与密钥,只换模型名;留空=同被测模型。">
            <Select value={optimizerModel || "default"} onValueChange={(v) => setOptimizerModel(v === "default" ? "" : v)}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认(同被测模型)</SelectItem>
                {modelOpts.map((m) => (<SelectItem key={m.model} value={m.model}>{m.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </Field>
        </Grid>
      </Section>

      {/* ── 种子技能 ── */}
      <Section icon={FileCode2} title="种子技能">
        <SkillBrowser onSeedChange={setSeedContent} onSkillChange={setSeedSkill} />
        <div className="space-y-2 rounded-lg border border-border bg-surface/40 p-3">
          <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            该技能题集
            {skillName && (
              <span className={cn(caseBuildCanRun ? "text-muted-foreground" : "text-warning")}>
                · 已存 {skillCaseCount} 题{caseBuildCanRun ? "" : `,还差 ${caseShortfall} 到下限 9`}
              </span>
            )}
          </div>
          {!skillName ? (
            <div className="text-[11px] text-muted-foreground/80">先在上方选技能。</div>
          ) : (
            <CaseGenerator
              profileId={profileId}
              skillName={skillName}
              skillBody={skillBody}
              employee={employee}
              onSaveCases={onSaveCases}
            />
          )}
        </div>
      </Section>

      {/* ── 优化参数 ── */}
      <Section icon={SlidersHorizontal} title="优化参数">
        <Grid>
          {/* 数量类参数:滑块 + 数值 + 重置(全宽堆叠) */}
          <SliderField label="轮次 epochs" hint="一个 epoch = 在训练集上完整跑一遍 rollout(试跑)→ 反思 → 择优。越多优化越充分、越慢;想看「注入经验」至少设 2。" value={epochs} onChange={setEpochs} min={1} max={8} defaultValue={2} unit="epoch" />
          <SliderField label="学习率 (edit_budget)" hint="SkillOpt 的「学习率」= 每步最多允许改几条编辑。越大每步改得越多(更激进、可能不稳),越小越保守。" value={editBudget} onChange={setEditBudget} min={1} max={12} defaultValue={3} unit="条 / 步" />
          <SliderField label="批大小 (batch_size)" hint="每个优化步从训练集取多少题做 rollout + 反思。越大每步信号越稳、越慢越贵;越小越快但更抖。" value={batchSize} onChange={setBatchSize} min={1} max={16} defaultValue={8} unit="题 / 步" />
          <SliderField label="并发反思 (analyst workers)" hint="反思阶段并发调 analyst 的线程数。越大越快,但受单 LLM 限流约束(eval-platform 默认 2,共用一个端点时别开太高)。" value={analystWorkers} onChange={setAnalystWorkers} min={1} max={16} defaultValue={2} unit="并发" />

          {/* 选项类参数:两列下拉 */}
          <Field label="择优门 (gate)" hint="是否启用择优门:开=候选改动要在选择集上「分数变高」才被收下,否则回滚;关=每步改动无条件接受(force-accept,不做择优)。默认=随配置。">
            <Select
              value={useGate === null ? "default" : useGate ? "on" : "off"}
              onValueChange={(v) => setUseGate(v === "default" ? null : v === "on")}
            >
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认(开)</SelectItem>
                <SelectItem value="on">开(择优)</SelectItem>
                <SelectItem value="off">关(无条件接受)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="接受准则 (gate metric)" hint="择优门开启时,用哪种分决定是否收下改动:hard=严格全过(0/1);soft=部分给分(通过项占比);mixed=两者加权。择优门关时本项不生效。">
            <Select value={gateMetric || "default"} onValueChange={(v) => setGateMetric(v === "default" ? "" : (v as "hard" | "soft" | "mixed"))}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认(hard)</SelectItem>
                <SelectItem value="hard">hard(严格全过)</SelectItem>
                <SelectItem value="soft">soft(部分给分)</SelectItem>
                <SelectItem value="mixed">mixed(加权)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="更新模式" hint="如何把改动落到 skill:patch=做增量编辑(只改局部);rewrite=按建议整篇重写。">
            <Select value={skillUpdateMode || "default"} onValueChange={(v) => setSkillUpdateMode(v === "default" ? "" : (v as "patch" | "rewrite_from_suggestions"))}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认(patch)</SelectItem>
                <SelectItem value="patch">patch(增量编辑)</SelectItem>
                <SelectItem value="rewrite_from_suggestions">rewrite(整篇重写)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="lr 调度 (scheduler)" hint="学习率(edit_budget)随训练步衰减的方式:constant=恒定;linear=线性降到下限;cosine=余弦退火。默认=用配置里的设定。">
            <Select value={lrScheduler || "default"} onValueChange={(v) => setLrScheduler(v === "default" ? "" : (v as "constant" | "linear" | "cosine"))}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认</SelectItem>
                <SelectItem value="constant">constant(恒定)</SelectItem>
                <SelectItem value="linear">linear(线性衰减)</SelectItem>
                <SelectItem value="cosine">cosine(余弦退火)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="推理强度 (reasoning)" hint="传给模型的推理强度(reasoning_effort),仅对支持的模型生效:low / medium / high。越高思考越多、越慢越贵。默认=不指定。">
            <Select value={reasoningEffort || "default"} onValueChange={(v) => setReasoningEffort(v === "default" ? "" : (v as "low" | "medium" | "high"))}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认(不指定)</SelectItem>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="high">high</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="慢更新 (slow update)" hint="把多轮里反复被验证有效的经验,沉淀进 skill 的稳定区(锚点之间),抗单轮抖动。默认=随所选配置(真跑配置默认开);可强制开 / 关。">
            <Select
              value={useSlowUpdate === null ? "default" : useSlowUpdate ? "on" : "off"}
              onValueChange={(v) => setUseSlowUpdate(v === "default" ? null : v === "on")}
            >
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认(随配置)</SelectItem>
                <SelectItem value="on">开</SelectItem>
                <SelectItem value="off">关</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="元技能 (meta skill)" hint="跨题归纳出的通用策略层,叠加在具体 skill 之上,可跨任务复用。默认=随所选配置(真跑配置默认开);可强制开 / 关。">
            <Select
              value={useMetaSkill === null ? "default" : useMetaSkill ? "on" : "off"}
              onValueChange={(v) => setUseMetaSkill(v === "default" ? null : v === "on")}
            >
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认(随配置)</SelectItem>
                <SelectItem value="on">开</SelectItem>
                <SelectItem value="off">关</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Grid>
      </Section>

      <div className="flex gap-2 border-t border-border pt-4">
        <Button className="gap-1.5" disabled={!canRun} onClick={onStart}>
          <Play className="h-4 w-4" /> 启动评测
        </Button>
        {status === "running" && (
          <Button variant="outline" className="gap-1.5" onClick={onStop}>
            <Square className="h-4 w-4" /> 中止
          </Button>
        )}
      </div>

      {errMsg && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{errMsg}</div>
      )}
    </Card>
    </TooltipProvider>
  );
}

/** 参数分区:小标题(图标 + 名称 + 分割线)+ 内容。 */
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Cpu;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Icon className="h-3 w-3" />
        </span>
        <span className="text-[12px] font-semibold tracking-tight text-foreground">{title}</span>
        <div className="h-px flex-1 bg-border/70" />
      </div>
      {children}
    </div>
  );
}

/** 两列自适应网格(窄屏单列)。 */
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">{children}</div>;
}

/** 字段:标签(可带 InfoHint)在上、控件在下。 */
function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        {label}
        {hint && <InfoHint text={hint} />}
      </span>
      {children}
    </div>
  );
}

/** 数量参数滑块:标签 + 数值框 + 重置 ↺,下方轨道带 min/max(全宽,占两列)。 */
function SliderField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
  defaultValue,
  unit,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  unit?: string;
}) {
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          {label}
          {hint && <InfoHint text={hint} />}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="min-w-[2.5ch] rounded-md border border-border bg-card px-2 py-0.5 text-center font-mono text-[12px] tabular-nums text-foreground">
            {value}
          </span>
          {unit && <span className="text-[10px] text-muted-foreground">{unit}</span>}
          <button
            type="button"
            onClick={() => onChange(defaultValue)}
            disabled={value === defaultValue}
            aria-label={`重置 ${label} 为默认 ${defaultValue}`}
            title={`重置默认(${defaultValue})`}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/60">{min}</span>
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={step}
          onValueChange={([v]) => onChange(v)}
          aria-label={label}
          className="flex-1"
        />
        <span className="w-6 shrink-0 text-[10px] tabular-nums text-muted-foreground/60">{max}</span>
      </div>
    </div>
  );
}
