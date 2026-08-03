export type RunEventTone = "ok" | "bad" | "info" | "accent";
export type RunEventKind =
  | "step" | "rollout" | "accept" | "accept-best" | "reject"
  | "skip" | "slow" | "meta" | "baseline" | "heldout" | "done";

export interface RunEvent {
  kind: RunEventKind;
  text: string;
  detail?: string;
  tone: RunEventTone;
}

export interface RunMetrics {
  step: number;
  totalSteps: number;
  accepts: number;
  rejects: number;
  skips: number;
  selectionSeries: number[];
  bestScore: number | null;
  lastRolloutHard: number | null;
  lastRolloutSoft: number | null;
}

export const INITIAL_METRICS: RunMetrics = {
  step: 0, totalSteps: 0, accepts: 0, rejects: 0, skips: 0,
  selectionSeries: [], bestScore: null, lastRolloutHard: null, lastRolloutSoft: null,
};

// gate 决策行的候选分:ACCEPT/REJECT 后第一个 hard=/soft=/mixed[..]= 的数值
const GATE_RE = /\[6\/6 EVALUATE\] (ACCEPT \(new best\)|ACCEPT|REJECT) (?:hard|soft|mixed\[[^\]]*\])=([\d.]+)/;
const BASELINE_RE = /\[baseline result\].*?gate\[(?:[^[\]]|\[[^\]]*\])*\]=([\d.]+)/;

/** 一行 stdout → 一条人话事件(无则 null)。逐题 [case] 行交给题块网格,返回 null。 */
export function parseEvent(line: string): RunEvent | null {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/\[STEP (\d+)\/(\d+)\]/))) {
    return { kind: "step", text: `第 ${m[1]}/${m[2]} 步 · 优化中`, tone: "accent" };
  }
  if ((m = line.match(/\[1\/6 done\] hard=([\d.]+) soft=([\d.]+)/))) {
    return {
      kind: "rollout",
      text: `本步试跑通过率 ${Math.round(Number(m[1]) * 100)}%`,
      detail: `soft ${Number(m[2]).toFixed(2)}`,
      tone: "info",
    };
  }
  if ((m = line.match(GATE_RE))) {
    const action = m[1];
    const score = Number(m[2]).toFixed(2);
    if (action === "REJECT") {
      return { kind: "reject", text: "改动没提分,丢弃", detail: `候选 ${score}`, tone: "info" };
    }
    const prev = line.match(/(?:> current=|> prev best )([\d.]+)/);
    const detail = prev ? `选择集 ${Number(prev[1]).toFixed(2)}→${score}` : `选择集 ${score}`;
    return action.includes("new best")
      ? { kind: "accept-best", text: "收下改动 · 新最优", detail, tone: "ok" }
      : { kind: "accept", text: "收下改动", detail, tone: "ok" };
  }
  if (/\[skip\] no usable (?:patches|rewrite)/.test(line)) {
    return { kind: "skip", text: "本步没产出可用改动,跳过", tone: "info" };
  }
  if (/\[slow update\] sampled/.test(line)) {
    return { kind: "slow", text: "注入跨轮经验(慢更新)…", tone: "accent" };
  }
  if (/\[META SKILL/.test(line)) {
    return { kind: "meta", text: "元技能归纳…", tone: "accent" };
  }
  if ((m = line.match(BASELINE_RE))) {
    return { kind: "baseline", text: `基线分 ${Number(m[1]).toFixed(2)}`, tone: "info" };
  }
  if (/BASELINE — evaluate initial skill on Selection/.test(line)) {
    return { kind: "baseline", text: "基线评估(种子 skill)…", tone: "info" };
  }
  if (/BASELINE TEST —/.test(line)) return { kind: "heldout", text: "留出集评测:种子 skill…", tone: "info" };
  if (/BEST SKILL TEST —/.test(line)) return { kind: "heldout", text: "留出集评测:最优 skill…", tone: "info" };
  if ((m = line.match(/pass\^k: ([\d.]+) -> ([\d.]+)/))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { kind: "heldout", text: `留出集 pass^k ${a.toFixed(2)}→${b.toFixed(2)}`, tone: b >= a ? "ok" : "bad" };
  }
  if (/Final Summary/.test(line)) return { kind: "done", text: "完成", tone: "ok" };
  return null;
}

/** 把一行 stdout 折叠进指标累加器(认不出 → 原样返回)。 */
export function reduceMetrics(prev: RunMetrics, line: string): RunMetrics {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/\[STEP (\d+)\/(\d+)\]/))) {
    return { ...prev, step: Number(m[1]), totalSteps: Number(m[2]) };
  }
  if ((m = line.match(/\[1\/6 done\] hard=([\d.]+) soft=([\d.]+)/))) {
    return { ...prev, lastRolloutHard: Number(m[1]), lastRolloutSoft: Number(m[2]) };
  }
  if ((m = line.match(BASELINE_RE))) {
    const z = Number(m[1]);
    return { ...prev, bestScore: z, selectionSeries: prev.selectionSeries.length ? prev.selectionSeries : [z] };
  }
  if ((m = line.match(GATE_RE))) {
    const action = m[1];
    const score = Number(m[2]);
    const selectionSeries = [...prev.selectionSeries, score];
    if (action === "REJECT") return { ...prev, rejects: prev.rejects + 1, selectionSeries };
    const isBest = action.includes("new best");
    return {
      ...prev,
      accepts: prev.accepts + 1,
      selectionSeries,
      bestScore: isBest ? score : prev.bestScore != null ? Math.max(prev.bestScore, score) : score,
    };
  }
  if (/\[skip\] no usable (?:patches|rewrite)/.test(line)) {
    return { ...prev, skips: prev.skips + 1 };
  }
  return prev;
}
