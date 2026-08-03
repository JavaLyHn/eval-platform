/**
 * 自适应追问(MVP · 半自动):某题答过后,据 agent 真实回答生成下一句追问并发出。
 * - 模式:固定轮数(到上限自动停)/ 自动判停(生成器自己判够了);
 * - 跑出好追问 → 「保存到题库」把各轮写成 subPrompts 入库(默认困难题),便于确定性复跑。
 * 探索/红队用;不直接进回归(保存后才进)。
 *
 * 注:生成的那句追问已显示在左侧对话面板,这里不重复;只展示「本轮追问意图」(生成器
 * 返回的 reason —— 这轮在考点上挖什么 / 停因),补上对话里看不到的那层信息。
 * 「这次想试探什么」输入暂隐藏(全程由 prompt/考点锚控制),下方常驻展示「下一轮追问 Prompt」预览填充版面。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, FileText, Loader2, Minus, Plus, Save, Sparkles, Square, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { cn } from "@/lib/utils";
import type { AdaptiveMode } from "@/lib/adaptive-followup";
import type { Question } from "@/types";

type AskResult =
  | { action: "asked"; reason?: string }
  | { action: "stopped"; reason?: string }
  | { action: "error"; reason: string };

export function AdaptiveFollowupPanel({ question }: { question: Question }) {
  const navigate = useNavigate();
  const {
    generateFollowup,
    stopFollowup,
    buildFollowupPromptPreview,
    freezeAdaptiveAsQuestion,
    isStreaming,
    isQuestionInProgressHere,
    selectedMessages,
    profiles,
    lastGeneratorProfileId,
    setLastGeneratorProfileId,
  } = useQAStore();

  // 生成器候选 = 所有 LLM 模型(裁判/出题/反思同源)。
  const llmProfiles = useMemo(
    () => profiles.filter((p) => getProfileKind(p.providerId) === "llm"),
    [profiles],
  );
  const [genProfileId, setGenProfileId] = useState<string>(
    () =>
      (lastGeneratorProfileId &&
      profiles.some(
        (p) => p.id === lastGeneratorProfileId && getProfileKind(p.providerId) === "llm",
      )
        ? lastGeneratorProfileId
        : llmProfiles[0]?.id) ?? "",
  );

  // 探测侧重:输入暂隐藏(功能保留),固定为空 —— 全程由考点锚/prompt 控制。
  // 要恢复"用户指定侧重":把下方注释的输入重新渲染,并改回 useState 带 setter 即可。
  const [goal] = useState("");
  const [mode, setMode] = useState<AdaptiveMode>("auto");
  const [maxTurns, setMaxTurns] = useState(4);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  // 本轮追问结果(意图条展示用)与保存结果(单独一行 + 去题库链接)。
  const [ask, setAsk] = useState<AskResult | null>(null);
  const [freezeMsg, setFreezeMsg] = useState<string | null>(null);
  const [freezeDone, setFreezeDone] = useState(false);

  const answeredRounds = selectedMessages.length;
  // 上限不能低于"已答轮数"(已答的没法撤销);上界至少 8,但若历史已答更多则放宽到那个数。
  const minTurns = Math.max(2, answeredRounds);
  const maxCap = Math.max(8, answeredRounds);
  // 修复「已 5 / 4 轮」:上一轮可能已答超过当前上限(如重置回默认 4 但实际答了 5 轮),
  // 把上限顶到已答轮数,避免出现"已答 > 上限"的错误显示。
  useEffect(() => {
    if (maxTurns < answeredRounds) setMaxTurns(answeredRounds);
  }, [answeredRounds, maxTurns]);

  // 「下一轮追问」会发给 LLM 的 prompt 预览 —— 与实跑同源,随对话/设置变化常驻展示。
  const nextPrompt = useMemo(
    () =>
      buildFollowupPromptPreview({
        questionId: question.id,
        goal: goal.trim(),
        mode,
        maxTurns,
      }),
    // selectedMessages 变化 = 对话推进,需重算下一轮 prompt。
    [buildFollowupPromptPreview, question.id, goal, mode, maxTurns, selectedMessages],
  );
  const reachedCap = answeredRounds >= maxTurns;
  const canAsk =
    !isStreaming &&
    !isQuestionInProgressHere &&
    !busy &&
    !reachedCap &&
    !!genProfileId;

  const handleAsk = async () => {
    setBusy(true);
    setAsk(null);
    setFreezeMsg(null);
    try {
      if (genProfileId) setLastGeneratorProfileId(genProfileId);
      const r = await generateFollowup({
        questionId: question.id,
        goal: goal.trim(),
        mode,
        maxTurns,
        generatorProfileId: genProfileId || undefined,
      });
      setAsk(
        r.action === "asked"
          ? { action: "asked", reason: r.reason }
          : { action: "stopped", reason: r.reason },
      );
    } catch (e) {
      setAsk({ action: "error", reason: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // 追问流程进行中:出题中(busy)或被测 agent 正在回答(streaming / pending)。
  const flowRunning = busy || isStreaming || isQuestionInProgressHere;

  // 终止:中断出题 + 停掉 agent 回答,确保整条追问流程干净结束。
  const handleStop = () => {
    stopFollowup();
    setAsk({ action: "stopped", reason: "已手动终止,追问流程已结束" });
  };

  const handleFreeze = async () => {
    setSaving(true);
    setFreezeDone(false);
    setFreezeMsg(null);
    try {
      const r = await freezeAdaptiveAsQuestion({
        questionId: question.id,
        generatorProfileId: genProfileId || undefined,
      });
      if (!r.ok) {
        setFreezeDone(false);
        setFreezeMsg(`保存失败:${r.reason}`);
        return;
      }
      const { question: q, created } = r;
      const rounds = (q.subPrompts?.length ?? 0) + 1;
      setFreezeDone(true);
      setFreezeMsg(
        created
          ? `已保存到题库「${q.title}」(${rounds} 轮),判据已按多轮对话补全。`
          : `题库已有同内容的「${q.title}」,未重复入库。`,
      );
    } catch (e) {
      setFreezeDone(false);
      setFreezeMsg(`保存失败:${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const askBtnLabel = busy
    ? "生成中…"
    : isStreaming
      ? "回答中…"
      : reachedCap
        ? "已达上限"
        : "据回答追问";

  return (
    <section className="space-y-3 rounded-xl border border-accent/30 bg-accent/[0.04] p-3.5">
      {/* 头部:标题 + 进度 chip */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-accent" />
          <span className="text-[13px] font-semibold text-foreground">自适应追问</span>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10.5px] font-medium tabular-nums",
            reachedCap
              ? "bg-warning/15 text-warning"
              : "bg-accent/10 text-accent",
          )}
        >
          已 {answeredRounds} / {maxTurns} 轮
        </span>
      </div>
      <p className="-mt-1.5 text-[10.5px] text-muted-foreground">
        顺着回答自动追下一问 · 锚定原题考点(探索 / 红队)
      </p>

      {/* 「这次想试探什么」输入暂隐藏 —— 全程由考点锚/prompt 控制(功能保留,见上方注释)。 */}

      {/* 设置:模式 + 轮数 + 模型,收成一行 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/70 bg-card/50 px-2.5 py-2 text-[11px]">
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(["fixed", "auto"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                mode === m
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "fixed" ? "固定轮数" : "自动判停"}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1 text-muted-foreground">
          <span>{mode === "fixed" ? "目标轮数" : "最多轮数"}</span>
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-card px-0.5 py-0.5">
            <button
              type="button"
              onClick={() => setMaxTurns((k) => Math.max(minTurns, k - 1))}
              disabled={maxTurns <= minTurns}
              title={
                maxTurns <= minTurns && answeredRounds >= maxTurns
                  ? `已答 ${answeredRounds} 轮,上限不能再低`
                  : undefined
              }
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="min-w-[1.5ch] text-center font-mono text-[12px] tabular-nums text-foreground">
              {maxTurns}
            </span>
            <button
              type="button"
              onClick={() => setMaxTurns((k) => Math.min(maxCap, k + 1))}
              disabled={maxTurns >= maxCap}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground">
          <span>模型</span>
          {llmProfiles.length === 0 ? (
            <span className="text-warning">先去左侧「LLM 模型」添加</span>
          ) : (
            <select
              value={genProfileId}
              onChange={(e) => setGenProfileId(e.target.value)}
              className="h-7 max-w-44 rounded border border-border bg-card px-1.5 text-[11.5px] text-foreground"
            >
              {llmProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* 动作:主(据回答追问)+ 次(保存到题库) */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-8 gap-1.5 px-3 text-[12px]"
          disabled={!canAsk}
          onClick={handleAsk}
          title={reachedCap ? "已达最多轮数" : undefined}
        >
          {busy || isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Bot className="h-3.5 w-3.5" />
          )}
          {askBtnLabel}
        </Button>
        {/* 终止:仅在追问流程进行中出现;中断出题 + 停掉 agent 回答 */}
        {flowRunning && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-3 text-[12px] text-destructive hover:text-destructive"
            onClick={handleStop}
            title="终止本轮追问(中断出题 / 停掉 agent 回答),流程立即结束"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            终止
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-3 text-[12px]"
          disabled={answeredRounds < 2 || saving || !genProfileId}
          onClick={handleFreeze}
          title={
            answeredRounds < 2
              ? "至少 2 轮才能保存"
              : !genProfileId
                ? "需要一个 LLM 模型来补全多轮判据"
                : "把这段多轮对话保存为题库里的一道题(判据按多轮补全)"
          }
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saving ? "保存中…" : "保存到题库"}
        </Button>
      </div>

      {/* 本轮追问意图(reason / 停因)—— 对话里看不到的那层 */}
      {ask && (
        <div
          className={cn(
            "rounded-lg border px-2.5 py-2 text-[11.5px]",
            ask.action === "asked"
              ? "border-accent/30 bg-accent/[0.06]"
              : ask.action === "stopped"
                ? "border-border bg-muted/40"
                : "border-destructive/30 bg-destructive/[0.06]",
          )}
        >
          {ask.action === "asked" ? (
            <>
              <div className="flex items-start gap-1.5 font-medium text-foreground">
                <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <span>
                  本轮在挖:{ask.reason?.trim() || "(生成器未给说明)"}
                </span>
              </div>
              <p className="mt-1 pl-5 text-[10.5px] text-muted-foreground">
                ↳ 已发出 —— 追问原文见左侧对话,等 agent 回答…
              </p>
            </>
          ) : ask.action === "stopped" ? (
            <span className="text-muted-foreground">
              🛑 已停止追问{ask.reason ? `:${ask.reason}` : ""}
            </span>
          ) : (
            <span className="text-destructive">⚠️ 出错:{ask.reason}</span>
          )}
        </div>
      )}

      {/* 保存结果 + 去题库 */}
      {freezeMsg && (
        <div className="text-[10.5px] text-muted-foreground">
          {freezeMsg}
          {freezeDone && (
            <button
              type="button"
              onClick={() => navigate("/library")}
              className="ml-1.5 text-accent hover:underline"
            >
              去题库查看 →
            </button>
          )}
        </div>
      )}

      {/* 下一轮追问 Prompt —— 常驻预览,填充版面;与实跑同源(点「据回答追问」时发的就是它) */}
      {nextPrompt && (
        <div className="overflow-hidden rounded-lg border border-border bg-card/50">
          <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-2.5 py-1.5">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11.5px] font-medium text-foreground">下一轮追问 Prompt</span>
            <span className="text-[10.5px] text-muted-foreground">
              · 发给生成模型(第 {answeredRounds + 1} 轮)
            </span>
            <span className="ml-auto rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              预览
            </span>
          </div>
          <div className="max-h-[22rem] overflow-auto px-2.5 py-2 text-[11px] leading-relaxed">
            <Markdown>{nextPrompt}</Markdown>
          </div>
        </div>
      )}
    </section>
  );
}
