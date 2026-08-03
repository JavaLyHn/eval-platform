import { useMemo, useRef, useState } from "react";
import { Sparkles, Square, Trash2, ShieldAlert, RotateCw, CheckCircle2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PromptSourceChip } from "@/components/prompt-source-chip";
import { cn } from "@/lib/utils";
import { useQAStore } from "@/hooks/use-qa-store";
import type { StandardEmployee } from "@/types";
import {
  buildCaseGenPrompt, parseAndValidateCases, extractCases, summarizeCases, makeCase,
} from "@/lib/skillopt-case-gen";
import { type SkillOptCase } from "@/lib/question-to-skillopt-case";

const GEN_SEED = 42; // 生成 case id 的确定性种子(同题面恒同 id)——跨批共用同一 seed 才能跨批去重
const TARGET_CASES = 40; // 训练级目标量:够切出 val ~10-15
const MAX_BATCHES = 3; // 自动分批上限(到目标量提前停)

/** 生成 + 人审可编辑题集草稿;「保存到题库」把草稿作为 skill 题上抛(onSaveCases)落库。
 * 生成结果在单独 Dialog 里展示(避免内联把页面撑长);员工/技能由父组件传入。 */
export function CaseGenerator({
  profileId,
  skillName,
  skillBody,
  employee,
  onSaveCases,
}: {
  profileId: string;
  skillName: string;
  skillBody: string;
  employee: StandardEmployee | null;
  onSaveCases: (cases: SkillOptCase[]) => void;
}) {
  const { runOneShot } = useQAStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [genErr, setGenErr] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [cases, setCases] = useState<SkillOptCase[]>([]);
  const [dropped, setDropped] = useState<{ reason: string; raw: unknown }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const summary = useMemo(() => summarizeCases(cases), [cases]);
  const canGen = !!skillName && !!skillBody && !!employee && !!profileId;

  // 出题 prompt 不在此处预览/编辑:直接用 Prompt 管理里「skillopt-case-gen」的生效版本。
  const genPrompt = useMemo(
    () =>
      skillName && skillBody && employee
        ? buildCaseGenPrompt({ skillName, skillBody, employee })
        : "",
    [skillName, skillBody, employee],
  );

  // 分批生成:多次调用累积 + 跨批按 id(题面哈希)去重,直到到目标量或批次上限。
  // append=true → 在现有草稿上再补一批(手动提量),不清空。
  const generate = async (promptText: string, opts: { append?: boolean } = {}) => {
    if (!canGen || !employee || !promptText.trim()) return;
    setBusy(true);
    setGenErr("");
    if (!opts.append) {
      setDropped([]);
      setParseError(null);
      setCases([]); // 全新生成:先清空,边流边长
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // 跨批累积(按 id 去重);append 时以现有草稿为起点。
    const acc = new Map<string, SkillOptCase>();
    if (opts.append) for (const c of cases) acc.set(c.id, c);
    const allDropped: { reason: string; raw: unknown }[] = opts.append ? [...dropped] : [];
    let lastParseError: string | null = null;
    const maxBatches = opts.append ? 1 : MAX_BATCHES;
    try {
      for (let batch = 0; batch < maxBatches; batch++) {
        if (ctrl.signal.aborted || acc.size >= TARGET_CASES) break;
        // 第 2 批起加多样性提示(并告知已出数),避免不同批produce重复角度。
        const batchPrompt =
          batch === 0 && !opts.append
            ? promptText
            : `${promptText}\n\n(补充批:已有 ${acc.size} 条,请产出与之前不同角度的新题 —— 换不同核心任务 / 平台 / 语言 / 长度,别重复已有的。)`;
        let buffer = "";
        const raw = await runOneShot(profileId, batchPrompt, {
          signal: ctrl.signal,
          onChunk: (delta) => {
            buffer += delta;
            // 实时:已累积 + 本批流式解析,合并去重显示
            const live = new Map(acc);
            for (const c of extractCases(buffer, GEN_SEED)) live.set(c.id, c);
            setCases(Array.from(live.values()));
          },
        });
        const r = parseAndValidateCases(raw, GEN_SEED); // 本批权威解析
        for (const c of r.cases) acc.set(c.id, c);
        allDropped.push(...r.dropped);
        lastParseError = r.parseError;
        setCases(Array.from(acc.values()));
        if (r.cases.length === 0 && r.parseError) break; // 本批全废且解析失败 → 别再无谓重试
      }
      setCases(Array.from(acc.values()));
      setDropped(allDropped);
      setParseError(acc.size === 0 ? lastParseError : null); // 一条没出才暴露解析错
    } catch (e) {
      if (!(ctrl.signal.aborted || (e as Error).name === "AbortError" || (e as Error).message === "已中止")) {
        setGenErr((e as Error).message);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const editPrompt = (id: string, prompt: string) => {
    // 改题面时保住已生成的约束 / 意图金标(都在 expected 里),不被 makeCase 重建抹掉。
    setCases((cs) =>
      cs.map((c) =>
        c.id === id
          ? makeCase(c.id, c.caseType, prompt, c.groundTruthChecks, {
              include: c.expected.mustInclude,
              exclude: c.expected.mustExclude,
              intentType: c.expected.intentType,
              requiresClarification: c.expected.requiresClarification,
            })
          : c,
      ),
    );
  };
  // 三态循环:正常 → 红线 → 意图 → 正常(切到意图默认 other 意图,可后续改题面 / 删)。
  const toggleType = (id: string) => {
    setCases((cs) =>
      cs.map((c) => {
        if (c.id !== id) return c;
        const next =
          c.caseType === "acceptAny" ? "interception" : c.caseType === "interception" ? "standard" : "acceptAny";
        return makeCase(c.id, next, c.prompt, [], { intentType: "other" });
      }),
    );
  };
  const removeCase = (id: string) => {
    setCases((cs) => cs.filter((c) => c.id !== id));
  };

  const save = () => {
    onSaveCases(cases);
    setCases([]); // 存完清空草稿;已落库的题由父组件从题库读出展示
    setOpen(false);
  };

  // 入口按钮文案:生成中 / 有草稿可查看 / 首次生成。
  const triggerLabel = busy
    ? `生成中… 已 ${cases.length} 条`
    : cases.length
      ? `查看草稿 · ${cases.length} 题`
      : "生成题集";

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="gap-1"
          disabled={!canGen || !genPrompt.trim()}
          onClick={() => {
            setOpen(true);
            if (!busy && cases.length === 0) void generate(genPrompt);
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
        {cases.length > 0 && !busy && (
          <span className="text-[11px] text-muted-foreground">
            共 {summary.counts.total} · 正常 {summary.counts.acceptAny} · 红线 {summary.counts.interception} · 意图 {summary.counts.standard}
            {summary.shortfall > 0 ? ` · 还差 ${summary.shortfall}` : ""}
          </span>
        )}
        {!profileId && <span className="text-[11px] text-warning">先在上方选 LLM</span>}
        {profileId && !skillName && <span className="text-[11px] text-muted-foreground">先在上方选技能后可生成</span>}
      </div>

      {/* 用哪个出题 prompt + 生效版本(查看 / 编辑去 Prompt 管理) */}
      <PromptSourceChip promptKey="skillopt-case-gen" />

      {/* 弹窗关闭时才内联提示错误,避免与弹窗内重复 */}
      {!open && genErr && <div className="text-[11px] text-warning">生成失败:{genErr}</div>}
      {!open && parseError && <div className="text-[11px] text-warning">{parseError}</div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              生成题集{skillName ? ` · ${skillName}` : ""}
            </DialogTitle>
            <DialogDescription>
              AI 按出题 prompt 生成的题集草稿,可逐条编辑 / 循环切换 正常·红线·意图 / 删除;满足下限后保存到题库。
            </DialogDescription>
          </DialogHeader>

          {/* 工具栏 + 配比 */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px]">
            <Button size="sm" variant="outline" className="gap-1" disabled={busy || !genPrompt.trim()} onClick={() => void generate(genPrompt)}>
              <RotateCw className="h-3.5 w-3.5" /> {cases.length ? "重新生成" : "生成"}
            </Button>
            {cases.length > 0 && !busy && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={!genPrompt.trim()}
                title="在现有草稿上再生成一批并累积去重(用于补到训练级量)"
                onClick={() => void generate(genPrompt, { append: true })}
              >
                <Sparkles className="h-3.5 w-3.5" /> 再补一批
              </Button>
            )}
            {busy && (
              <Button size="sm" variant="outline" className="gap-1" onClick={stop}>
                <Square className="h-3.5 w-3.5" /> 终止
              </Button>
            )}
            <span className="ml-auto text-muted-foreground">
              共 {summary.counts.total} 题 · 正常 {summary.counts.acceptAny} · 红线 {summary.counts.interception} · 意图 {summary.counts.standard}
            </span>
            {summary.counts.total < TARGET_CASES && !busy && (
              <span className="text-muted-foreground">训练级建议 ~{TARGET_CASES}(可「再补一批」)</span>
            )}
            {summary.shortfall > 0 && <span className="text-warning">还差 {summary.shortfall} 到下限 9</span>}
            {summary.balanceWarning && (
              <span className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle className="h-3 w-3" />{summary.balanceWarning}
              </span>
            )}
            {summary.qualityNote && (
              <span className="inline-flex items-center gap-1 text-muted-foreground" title="质量提示(不阻断保存)">
                <AlertTriangle className="h-3 w-3" />{summary.qualityNote}
              </span>
            )}
          </div>

          {genErr && <div className="shrink-0 text-[11px] text-warning">生成失败:{genErr}</div>}
          {parseError && <div className="shrink-0 text-[11px] text-warning">{parseError}</div>}

          {/* 题面列表(滚动) */}
          <div className="min-h-0 flex-1 space-y-1 overflow-auto">
            {cases.length === 0 ? (
              <div className="flex h-full items-center justify-center py-10 text-[12px] text-muted-foreground">
                {busy ? "生成中…" : "点「生成」开始出题"}
              </div>
            ) : (
              cases.map((c) => (
                <div key={c.id} className="rounded border border-border bg-background/40 p-2">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px]">
                    <button
                      type="button"
                      onClick={() => toggleType(c.id)}
                      title="点按循环 正常 → 红线 → 意图"
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-1 py-0.5",
                        c.caseType === "interception"
                          ? "border-destructive/40 text-destructive"
                          : c.caseType === "standard"
                            ? "border-accent/40 text-accent"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {c.caseType === "interception" && <ShieldAlert className="h-3 w-3" />}
                      {c.caseType === "interception" ? "红线/越界" : c.caseType === "standard" ? "意图" : "正常"}
                    </button>
                    {(c.caseType === "acceptAny" || c.caseType === "standard") && c.expected.language && (
                      <span className="rounded border border-border px-1 py-0.5 text-muted-foreground">{c.expected.language}</span>
                    )}
                    {c.caseType === "standard" && c.expected.intentType && (
                      <span
                        className="rounded border border-accent/40 px-1 py-0.5 text-accent"
                        title="意图金标(被测 agent 会被告知同一固定闭集,公平 exact-match)"
                      >
                        意图:{c.expected.intentType}
                      </span>
                    )}
                    {c.caseType === "acceptAny" &&
                      (() => {
                        const n = (c.expected.mustInclude?.length ?? 0) + (c.expected.mustExclude?.length ?? 0);
                        return n > 0 ? (
                          <span
                            className="rounded border border-accent/40 px-1 py-0.5 text-accent"
                            title={[
                              c.expected.mustInclude?.length ? `必含:${c.expected.mustInclude.join("、")}` : "",
                              c.expected.mustExclude?.length ? `禁现:${c.expected.mustExclude.join("、")}` : "",
                            ]
                              .filter(Boolean)
                              .join(" / ")}
                          >
                            约束 {n}
                          </span>
                        ) : null;
                      })()}
                    <button
                      type="button"
                      onClick={() => removeCase(c.id)}
                      className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" /> 删除
                    </button>
                  </div>
                  <Textarea
                    value={c.prompt}
                    onChange={(e) => editPrompt(c.id, e.target.value)}
                    className="min-h-[2.25rem] text-[12px] leading-relaxed"
                  />
                </div>
              ))
            )}
          </div>

          {/* 底部:剔除明细 + 提示 + 保存 */}
          <div className="shrink-0 space-y-2 border-t border-border pt-2">
            {dropped.length > 0 && (
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer select-none">已自动剔除 {dropped.length} 条(自检不通过)</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {dropped.map((d, i) => (
                    <li key={i}>{d.reason}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] text-warning">
              留出集为 LLM 生成,需人审通过后才作发版依据(demo / 原型,非生产可用)。
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="gap-1" disabled={!summary.canConfirm || busy} onClick={save}>
                <CheckCircle2 className="h-3.5 w-3.5" /> 保存到题库
              </Button>
              {!summary.canConfirm && (
                <span className="text-[11px] text-muted-foreground">需 ≥9 题且红线/正常各 ≥2 才能保存</span>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
