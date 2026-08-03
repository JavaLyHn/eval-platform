import type { Question } from "@/types";
import type { SkillOptCaseSets } from "./skillopt-client";
import { hashUnit } from "./audit-queue";

/** 保证 train/val/test 都非空的最小合格题数。 */
export const MIN_ELIGIBLE_CASES = 9;

/** standard(意图分类)题的固定受控意图词表。
 * scorer 对 intentType 做严格相等 → 必须把这个闭集**注入被测 agent 的输出指令**(见 target_io.py),
 * 让黑盒 agent 从同一闭集里分类,exact-match 才公平。两侧(此处 / target_io.py)须保持一致。 */
export const STANDARD_INTENT_LABELS = [
  "pricing_inquiry",
  "product_info",
  "how_to",
  "troubleshooting",
  "content_request",
  "data_report",
  "scheduling",
  "other",
] as const;

export type SkillOptCaseType = "interception" | "acceptAny" | "standard";

export interface SkillOptExpected {
  intercepted?: boolean;
  language?: string;
  /** must-include 约束载荷(任务能力题的方差来源);Python scorer 从 expected 读。 */
  mustInclude?: string[];
  mustExclude?: string[];
  /** standard:意图分类金标(取自 STANDARD_INTENT_LABELS 闭集)。 */
  intentType?: string;
  /** standard:期望是否先追问(信息自足题恒 false)。 */
  requiresClarification?: boolean;
}

export interface SkillOptCase {
  id: string;
  task_type: string;
  caseType: SkillOptCaseType;
  prompt: string;
  expected: SkillOptExpected;
  groundTruthChecks: string[];
}
export interface CaseSplits {
  train: SkillOptCase[];
  val: SkillOptCase[];
  test: SkillOptCase[];
}
export interface CaseBuildResult {
  splits: CaseSplits;
  eligibleCount: number;
  skippedCount: number;
  canRun: boolean;
  shortfall: number;
}

/** 脚本推断语言:kana→ja / hangul→ko / han→zh / 其余→en。
 * // 注:无假名的纯汉字日语会误判为 zh,属脚本启发法已知局限。
 */
export function detectLang(text: string): string {
  if (/[぀-ヿ]/.test(text)) return "ja";
  if (/[가-힯]/.test(text)) return "ko";
  if (/[一-鿿]/.test(text)) return "zh";
  return "en";
}

/** A+B 确定性可判子集:有 groundTruthChecks 或 outOfScope 或 floorElementIds,或带 skilloptCase 载体(AI 出题)。 */
export function eligibleForSkillOpt(q: Question): boolean {
  return (
    q.skilloptCase != null ||
    (q.groundTruthChecks?.length ?? 0) > 0 ||
    q.outOfScope === true ||
    (q.floorElementIds?.length ?? 0) > 0
  );
}

/** 合格题 → SkillOpt case;prompt 空 → null(计入 skipped)。
 * AI 出题的题带 q.skilloptCase 载体(caseType + expected + checks)→ 直接还原,三类全保真;
 * 旧题 / 人工题无载体 → 走 legacy 推断(outOfScope→interception,否则 acceptAny)。 */
export function questionToCase(q: Question): SkillOptCase | null {
  const prompt = (q.prompt ?? "").trim();
  if (!prompt) return null;

  // —— AI 出题载体:caseType / expected / checks 原样还原(must-include、standard intentType 等全在 expected)。
  if (q.skilloptCase) {
    return {
      id: q.id,
      task_type: q.skilloptCase.caseType,
      caseType: q.skilloptCase.caseType,
      prompt,
      expected: { ...q.skilloptCase.expected },
      groundTruthChecks: [...(q.skilloptCase.groundTruthChecks ?? [])],
    };
  }

  // —— legacy 推断(无载体的旧题 / 人工题)
  const checkKinds = (q.groundTruthChecks ?? []).map((c) => c.kind);
  const isInterception = q.outOfScope === true || (q.floorElementIds?.length ?? 0) > 0;
  if (isInterception) {
    return {
      id: q.id,
      task_type: "interception",
      caseType: "interception",
      prompt,
      expected: { intercepted: true },
      groundTruthChecks: Array.from(new Set([...checkKinds, "no-leak"])),
    };
  }
  const expected: SkillOptExpected = { language: detectLang(prompt) };
  const mustCheck = (q.groundTruthChecks ?? []).find((c) => c.kind === "must-include");
  if (mustCheck) {
    expected.mustInclude = mustCheck.params?.include ?? [];
    expected.mustExclude = mustCheck.params?.exclude ?? [];
  }
  return {
    id: q.id,
    task_type: "acceptAny",
    caseType: "acceptAny",
    prompt,
    expected,
    groundTruthChecks: checkKinds,
  };
}

/** 已是 SkillOptCase 的题 → 按 caseType 分桶、seed 确定性切 train/val/test(约 5:2:3)。
 *  分桶后做兜底:题数够时保证 val/test 各至少 1 题(见下),否则就没有「选择集择优 / 留出集验收」。 */
export function splitCases(cases: SkillOptCase[], seed: number): CaseSplits {
  const splits: CaseSplits = { train: [], val: [], test: [] };
  const buckets: Record<string, SkillOptCase[]> = { interception: [], acceptAny: [], standard: [] };
  for (const c of cases) (buckets[c.caseType] ??= []).push(c);

  for (const key of Object.keys(buckets)) {
    const arr = buckets[key]
      .slice()
      .sort((a, b) => hashUnit(`${seed}:${a.id}`) - hashUnit(`${seed}:${b.id}`));
    const n = arr.length;
    // floor 确保 nTrain 恒 >= 0,总数守恒(nTrain + nVal + nTest === n)
    const nTest = Math.floor(n * 0.3);
    const nVal = Math.floor(n * 0.2);
    const nTrain = n - nTest - nVal;
    splits.train.push(...arr.slice(0, nTrain));
    splits.val.push(...arr.slice(nTrain, nTrain + nVal));
    splits.test.push(...arr.slice(nTrain + nVal));
  }

  // 兜底:每个桶各取 floor(30%)/floor(20%),小桶会被取整成 0;若所有桶都小(例:3+3+3),
  // val / test 会整体为空 → 没有「选择集择优」也没有「留出集验收」。题数够时从 train 末尾借
  // (train 按桶序拼接、桶内按 seed 排序 → 借到的是确定的题,保持确定性),保证三份都非空;
  // train 至少保留 1 题。留出集优先补(发版判定靠它),其次选择集。
  const fillFromTrain = (dest: SkillOptCase[]) => {
    if (dest.length === 0 && splits.train.length > 1) {
      dest.push(splits.train.pop()!);
    }
  };
  fillFromTrain(splits.test);
  fillFromTrain(splits.val);

  return splits;
}

/** 合格题 → 分层、seed 确定性切 train/val/test(约 5:2:3;题数够 ≥MIN 时 splitCases 兜底保证 val/test 非空)。 */
export function buildCaseSplits(questions: Question[], seed: number): CaseBuildResult {
  const eligible = questions.filter(eligibleForSkillOpt);
  const eligibleCount = eligible.length;
  const cases: SkillOptCase[] = [];
  let skippedCount = 0;
  for (const q of eligible) {
    const c = questionToCase(q);
    if (c) cases.push(c);
    else skippedCount += 1;
  }

  const empty: CaseSplits = { train: [], val: [], test: [] };
  const canRun = eligibleCount >= MIN_ELIGIBLE_CASES;
  if (!canRun) {
    return { splits: empty, eligibleCount, skippedCount, canRun, shortfall: MIN_ELIGIBLE_CASES - eligibleCount };
  }

  return { splits: splitCases(cases, seed), eligibleCount, skippedCount, canRun, shortfall: 0 };
}

const SPLIT_VIEW_META = [
  { split: "train" as const, label: "训练集", role: "优化器直接练:rollout 产生轨迹 → 反思出 patch" },
  { split: "val" as const, label: "选择集", role: "gate 据此择优:每个 patch 在它上面涨了才收" },
  { split: "test" as const, label: "留出集", role: "验收,不参与优化:发版决策 / pass^k 用" },
];

/** 把员工题集的 CaseSplits 转成 CaseSetsCard 用的视图(与服务端 read_case_sets 同结构)。 */
export function caseSplitsToView(splits: CaseSplits): SkillOptCaseSets {
  const groups = SPLIT_VIEW_META.map((m) => {
    const cases = splits[m.split].map((c) => ({
      id: c.id,
      prompt: c.prompt,
      caseType: c.caseType,
      taskType: c.task_type,
      language: typeof c.expected.language === "string" ? c.expected.language : "",
      expected: c.expected as Record<string, unknown>,
      checks: c.groundTruthChecks,
    }));
    return { split: m.split, label: m.label, role: m.role, count: cases.length, cases };
  });
  return { caseSet: "该员工题集", groups };
}
