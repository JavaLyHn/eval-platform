export type StageKey = "baseline" | "train" | "enrich" | "heldout" | "done";

export const STAGES: { key: StageKey; label: string }[] = [
  { key: "baseline", label: "基线评估" },
  { key: "train", label: "逐步优化" },
  { key: "enrich", label: "注入经验" },
  { key: "heldout", label: "留出集评测" },
  { key: "done", label: "完成" },
];

/** SkillOpt 每个训练步内部的 6 阶段循环(对齐官方 UI)。 */
export type InnerStageKey =
  | "rollout"
  | "reflect"
  | "aggregate"
  | "select"
  | "update"
  | "gate";

export const INNER_STAGES: { key: InnerStageKey; icon: string; label: string; zh: string; desc: string }[] = [
  {
    key: "rollout",
    icon: "🎯",
    label: "Rollout",
    zh: "试跑",
    desc: "戴上当前 skill 当系统提示,让被测模型在训练集的一小批题上实跑作答,记录每题判分(hard/soft)与完整轨迹。",
  },
  {
    key: "reflect",
    icon: "🔍",
    label: "Reflect",
    zh: "反思",
    desc: "分析器(optimizer)读这批的失败与成功轨迹,定位 skill 哪里不足,产出对 skill 的具体文字修改建议(edits)。",
  },
  {
    key: "aggregate",
    icon: "🔗",
    label: "Aggregate",
    zh: "合并",
    desc: "把多个小批各自产出的修改建议,用 optimizer 分层合并成一份统一的 patch。",
  },
  {
    key: "select",
    icon: "✂️",
    label: "Select",
    zh: "择条",
    desc: "按「学习率」(edit_budget = 每步允许改几条)对合并后的编辑排序、裁剪,选出最该改的 top-K 条。",
  },
  {
    key: "update",
    icon: "📝",
    label: "Update",
    zh: "更新",
    desc: "把选中的编辑落到 skill 文档,得到候选版本(patch 增量编辑 / rewrite 整篇重写)。",
  },
  {
    key: "gate",
    icon: "🚦",
    label: "Gate",
    zh: "择优门",
    desc: "候选在选择集上重跑;分数严格变高才收下并刷新最优版,否则回滚丢弃(爬山式择优)。",
  },
];

// 训练步日志里的 `[N/6 STAGE]` 标记:数字/6 + 大写阶段名(首字母大写即可,
// 兼容 `[2/6 REFLECT minibatch]` 这类带后缀的;避开 `[1/6 done]` 这类小写收尾行)。
const INNER_RE = /\[([1-6])\/6\s+[A-Z]/;

/** 从一行解析当前内循环阶段(1→rollout … 6→gate);无标记返回 undefined。 */
export function parseInnerStage(line: string): InnerStageKey | undefined {
  const m = line.match(INNER_RE);
  if (!m) return undefined;
  return INNER_STAGES[Number(m[1]) - 1]?.key;
}

export interface StageInfo {
  stage?: StageKey;
  currentStep?: number;
  totalSteps?: number;
  lastHard?: number;
  lastSoft?: number;
}

/** 把一行 train.py stdout 映射成粗粒度阶段(只驱动进度条;结构化数据来自 done 帧)。 */
export function parseStage(line: string): StageInfo {
  let m: RegExpMatchArray | null;
  if (/BASELINE — evaluate initial skill on Selection/.test(line)) return { stage: "baseline" };
  if ((m = line.match(/\[STEP (\d+)\/(\d+)\]/))) {
    return { stage: "train", currentStep: Number(m[1]), totalSteps: Number(m[2]) };
  }
  if ((m = line.match(/\[1\/6 done\] hard=([\d.]+) soft=([\d.]+)/))) {
    return { stage: "train", lastHard: Number(m[1]), lastSoft: Number(m[2]) };
  }
  if (/\[slow update\]|\[META SKILL/.test(line)) return { stage: "enrich" };
  if (/BASELINE TEST —|BEST SKILL TEST —/.test(line)) return { stage: "heldout" };
  if (/Final Summary/.test(line)) return { stage: "done" };
  return {};
}

export interface CaseResult {
  hard: number;
  reason?: string;
}

export interface RunStatus {
  stage?: StageKey;
  /** 训练步内部当前 6 阶段(rollout…gate);驱动官方式 6 阶段管线。 */
  innerStage?: InnerStageKey;
  currentStep?: number;
  totalSteps?: number;
  lastHard?: number;
  lastSoft?: number;
  currentCaseId?: string;
  caseDone?: number;
  caseTotal?: number;
  caseResults: CaseResult[];
}

export const INITIAL_RUN_STATUS: RunStatus = { caseResults: [] };

export interface CaseTally {
  pass: number;
  fail: number;
  pending: number;
  total: number;
  done: number;
}

/** 从 RunStatus 的逐题结果算通过/失败/待测计数(纯函数)。 */
export function caseTally(s: Pick<RunStatus, "caseResults" | "caseTotal">): CaseTally {
  const pass = s.caseResults.filter((c) => c.hard === 1).length;
  const fail = s.caseResults.length - pass;
  const done = pass + fail;
  const total = s.caseTotal ?? done;
  const pending = Math.max(0, total - done);
  return { pass, fail, pending, total, done };
}

/** 阶段相对当前阶段的状态:done(已过)/ active(当前)/ pending(未到)。 */
export function stageStatus(key: StageKey, active?: StageKey): "done" | "active" | "pending" {
  const activeIdx = active ? STAGES.findIndex((s) => s.key === active) : -1;
  const idx = STAGES.findIndex((s) => s.key === key);
  if (activeIdx < 0) return "pending";
  if (idx < activeIdx) return "done";
  if (idx === activeIdx) return active === "done" ? "done" : "active";
  return "pending";
}

const CASE_RE = /\[case (\d+)\/(\d+)\] id=(\S+) hard=([01]) soft=([\d.]+)(?: reason=(.*))?$/;

/** 在 parseStage 之上做累积归并:逐题进度 + 同阶段换组重置(i===1)+ 阶段切换清零(纯函数)。 */
export function reduceStage(prev: RunStatus, line: string): RunStatus {
  const cm = line.match(CASE_RE);
  if (cm) {
    const i = Number(cm[1]);
    const result: CaseResult = { hard: Number(cm[4]), ...(cm[6] ? { reason: cm[6] } : {}) };
    return {
      ...prev,
      currentCaseId: cm[3],
      caseDone: i,
      caseTotal: Number(cm[2]),
      caseResults: i === 1 ? [result] : [...prev.caseResults, result],
    };
  }
  const inner = parseInnerStage(line);
  const info = parseStage(line);
  if (!inner && !Object.keys(info).length) return prev;
  const next: RunStatus = { ...prev, ...info };
  if (inner) next.innerStage = inner;
  if (info.stage && info.stage !== prev.stage) {
    next.caseDone = undefined;
    next.caseTotal = undefined;
    next.caseResults = [];
    next.currentCaseId = undefined;
  }
  return next;
}
