import type { StandardEmployee } from "@/types";
import type { SkillOptCase, SkillOptCaseType, SkillOptExpected } from "./question-to-skillopt-case";
import { detectLang, MIN_ELIGIBLE_CASES, STANDARD_INTENT_LABELS } from "./question-to-skillopt-case";
import { hashUnit } from "./audit-queue";
import { compilePrompt } from "./prompt-registry";
import { DEFAULT_PARAMS } from "./ground-truth-check";

/** 红线 / 正常 两个主力类各自最少题数,贴合「正反都测」(standard 为可选第三类,不设硬下限)。 */
export const MIN_PER_TYPE = 2;

/** scorer 认得的确定性 check;其余一律剔除(否则 scorer 抛 unknown check kind)。 */
export const ALLOWED_CHECKS = ["no-leak", "lang-match", "no-placeholder", "tool-succeeded", "must-include"] as const;

/** makeCase 的可选载荷:acceptAny 用 include/exclude(must-include);standard 用 intentType/requiresClarification。 */
export interface MakeCaseOpts {
  include?: string[];
  exclude?: string[];
  intentType?: string;
  requiresClarification?: boolean;
}

/** no-leak 内部标识词(与确定性判分器同源):interception 题面写了这些词 → 回声豁免会让 no-leak 失效 → 白出。 */
const LEAK_WORDS = DEFAULT_PARAMS["no-leak"].blocklist;
type CaseType = SkillOptCaseType;

const DEFAULT_CHECKS: Record<CaseType, string[]> = {
  interception: ["no-leak"],
  acceptAny: ["no-leak", "no-placeholder"],
  standard: [], // 核心判据是 intentType(在 expected,非 GT check);语言也由 expected.language 判
};

/** 规范化题面用于去重:trim + 小写 + 折叠空白。 */
function normalize(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, " ");
}

/** 由 (caseType, prompt, checks, constraints) 造一个合法 SkillOptCase:语言/拦截标签确定性派生,check 过滤白名单。
 * acceptAny 带可机检约束(constraints)→ 挂 must-include,约束载荷进 expected(Python scorer 读)。 */
export function makeCase(
  id: string,
  caseType: CaseType,
  prompt: string,
  checks: string[],
  opts: MakeCaseOpts = {},
): SkillOptCase {
  // 剔除非白名单 + tool-succeeded(单轮文本出题无工具轨迹 → 永远判挂,prompt 也已要求别选)。
  // must-include 由 opts.include/exclude 决定挂不挂,先从入参 checks 里剥掉,后面按约束有无重挂。
  const kept = checks.filter(
    (c) => (ALLOWED_CHECKS as readonly string[]).includes(c) && c !== "tool-succeeded" && c !== "must-include",
  );
  if (caseType === "interception") {
    // 拦截题不带任务约束。
    return {
      id, task_type: "interception", caseType, prompt,
      expected: { intercepted: true },
      groundTruthChecks: Array.from(new Set([...kept, "no-leak"])),
    };
  }
  if (caseType === "standard") {
    // 意图分类题:intentType 限定固定闭集(越界 / 缺省 → other),slots 不判(避免 exact-dict 假判挂)。
    const intentType = (STANDARD_INTENT_LABELS as readonly string[]).includes(opts.intentType ?? "")
      ? (opts.intentType as string)
      : "other";
    return {
      id, task_type: "standard", caseType, prompt,
      expected: { language: detectLang(prompt), intentType, requiresClarification: !!opts.requiresClarification },
      groundTruthChecks: kept,
    };
  }
  // acceptAny:有可机检约束才挂 must-include(空约束=真空通过,没意义 → 不挂)。
  const include = (opts.include ?? []).map((s) => s.trim()).filter(Boolean);
  const exclude = (opts.exclude ?? []).map((s) => s.trim()).filter(Boolean);
  const hasConstraints = include.length > 0 || exclude.length > 0;
  const expected: SkillOptExpected = { language: detectLang(prompt) };
  if (hasConstraints) {
    expected.mustInclude = include;
    expected.mustExclude = exclude;
  }
  return {
    id, task_type: "acceptAny", caseType, prompt,
    expected,
    groundTruthChecks: hasConstraints ? Array.from(new Set([...kept, "must-include"])) : kept,
  };
}

export interface CaseSummary {
  counts: { interception: number; acceptAny: number; standard: number; total: number };
  canConfirm: boolean;
  shortfall: number;
  balanceWarning: string | null;
  /** 非阻断的质量提示(如 lang-match 配中文题面,区分度低);不影响 canConfirm。 */
  qualityNote: string | null;
}

/** 从一组 case 算配比 + 确认闸门(编辑后也用它实时驱动「确认采用」是否可点)。 */
export function summarizeCases(cases: SkillOptCase[]): CaseSummary {
  const interception = cases.filter((c) => c.caseType === "interception").length;
  const acceptAny = cases.filter((c) => c.caseType === "acceptAny").length;
  const standard = cases.filter((c) => c.caseType === "standard").length;
  const total = cases.length;
  const shortfall = Math.max(0, MIN_ELIGIBLE_CASES - total);
  const lacks: string[] = [];
  // 硬下限只卡两个主力类(红线 / 正常);standard 为可选第三类。
  if (interception < MIN_PER_TYPE) lacks.push(`红线/越界题(interception)至少 ${MIN_PER_TYPE} 条`);
  if (acceptAny < MIN_PER_TYPE) lacks.push(`正常题(acceptAny)至少 ${MIN_PER_TYPE} 条`);
  const balanceWarning = lacks.length ? `正反不均衡:${lacks.join(";")}` : null;
  // 软提示(不阻断保存),按训练级关注点排序:
  const notes: string[] = [];
  // ① 训练级关键:任务题没有可机检约束 → 对 SkillOpt 反思无方差信号(全过/全挂),白练。
  const noConstraint = cases.filter(
    (c) => c.caseType === "acceptAny" && !(c.expected.mustInclude?.length || c.expected.mustExclude?.length),
  ).length;
  if (noConstraint > 0)
    notes.push(`${noConstraint} 条任务题无可机检约束(mustInclude)→ 对 SkillOpt 训练无方差信号,建议补约束`);
  // ② standard(意图)题为 0 → 三类不齐(非阻断,standard 本就是脆弱的可选类)。
  if (standard === 0)
    notes.push("未产出 standard(意图分类)题 —— 三类不齐(standard 为可选类,exact-match 较脆)");
  // ③ lang-match 配中文题面 —— 被测模型默认中文、区分度低。
  const langMatchZh = cases.filter(
    (c) => c.groundTruthChecks.includes("lang-match") && c.expected.language === "zh",
  ).length;
  if (langMatchZh > 0)
    notes.push(`${langMatchZh} 条用了 lang-match 但题面是中文 —— 模型默认中文、区分度低,建议改非中文(英 / 日 / 韩)`);
  const qualityNote = notes.length ? notes.join(" · ") : null;
  const canConfirm = total >= MIN_ELIGIBLE_CASES && !balanceWarning;
  return { counts: { interception, acceptAny, standard, total }, canConfirm, shortfall, balanceWarning, qualityNote };
}

export interface GenCaseResult extends CaseSummary {
  cases: SkillOptCase[];
  dropped: { reason: string; raw: unknown }[];
  parseError: string | null;
}

/** 出题提示词:要求 LLM 返回纯 JSON 数组,只产 interception / acceptAny 两类。
 * 黑盒:只喂技能的 SKILL.md 正文(不含 scripts/references),外加员工画像作越界题依据。 */
/** 计算 Skill 出题 prompt 的全部数据块变量(供 compilePrompt / 预览复用)。 */
export function buildCaseGenVars(input: {
  skillName: string;
  skillBody: string;
  employee: StandardEmployee;
}): Record<string, string> {
  const { skillName, skillBody, employee } = input;
  return {
    skillName,
    skillBody,
    employeeName: employee.name,
    employeeTitle: employee.title,
    servesAudience: employee.servesAudience,
    coreTasks: employee.coreTasks.join(";"),
    outOfScope: employee.outOfScope,
    // standard 题 intentType 的固定受控闭集(prompt 列给 LLM;target_io 注入同一集给被测 agent)。
    intentLabels: (STANDARD_INTENT_LABELS as readonly string[]).join(", "),
  };
}

export function buildCaseGenPrompt(input: {
  skillName: string;
  skillBody: string;
  employee: StandardEmployee;
}): string {
  // 指令性文字在「Prompt 管理」的 skillopt-case-gen 模板里(可编辑/可版本化)。
  return compilePrompt("skillopt-case-gen", buildCaseGenVars(input));
}

/** 从可能带围栏/前后噪声的文本里取出第一个 JSON 数组并解析,失败返回 null。 */
function extractJsonArray(raw: string): unknown[] | null {
  let t = raw.trim();
  const fence = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 把一条原始 item 校验成合法 case,或给出剔除原因(供整体解析与流式增量复用,口径一致)。
 * id 由规范化题面哈希派生 → 同题面恒同 id,调用方据 id 即可去重。 */
function buildCaseFromItem(item: unknown, seed: number): { case: SkillOptCase } | { drop: string } {
  const o = (item ?? {}) as Record<string, unknown>;
  const caseType = o.caseType;
  const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
  if (caseType !== "interception" && caseType !== "acceptAny" && caseType !== "standard") {
    return { drop: `未知 caseType(${String(caseType)})` };
  }
  if (!prompt) return { drop: "缺 prompt" };
  if (caseType === "interception") {
    const lower = prompt.toLowerCase();
    const hit = LEAK_WORDS.find((w) => lower.includes(w.toLowerCase()));
    if (hit) return { drop: `红线题面含标识词「${hit}」—— 回声豁免会让 no-leak 失效(白出)` };
  }
  const rawChecks = Array.isArray(o.checks) ? (o.checks as unknown[]).map(String) : [];
  const checks = rawChecks.length ? rawChecks : DEFAULT_CHECKS[caseType];
  // acceptAny:可机检约束(mustInclude/mustExclude);standard:意图金标(intentType/requiresClarification)。
  const toStrArr = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);
  const opts: MakeCaseOpts =
    caseType === "acceptAny"
      ? { include: toStrArr(o.mustInclude), exclude: toStrArr(o.mustExclude) }
      : caseType === "standard"
        ? { intentType: typeof o.intentType === "string" ? o.intentType : undefined, requiresClarification: !!o.requiresClarification }
        : {};
  const id = `gen_${seed}_${Math.round(hashUnit(normalize(prompt)) * 0xffffffff).toString(36)}`;
  return { case: makeCase(id, caseType, prompt, checks, opts) };
}

/** 解析 LLM 出题结果 → 自检 → 合格 case + 被剔除项 + 配比 + 闸门。绝不抛。 */
export function parseAndValidateCases(raw: string, seed: number): GenCaseResult {
  // 先按严格 JSON 数组解析;失败(常见:题太多 → 输出被截断、数组未闭合)则退回容错的
  // "逐个完整对象"扫描 —— 把已生成好的完整题救回来,而不是整批丢弃后报错。
  const arr = extractJsonArray(raw) ?? extractObjectItems(raw);
  if (!arr.length) {
    return {
      cases: [], dropped: [], parseError: "生成结果无法解析为 JSON 数组,请重试。",
      counts: { interception: 0, acceptAny: 0, standard: 0, total: 0 }, canConfirm: false, shortfall: MIN_ELIGIBLE_CASES, balanceWarning: null, qualityNote: null,
    };
  }
  const cases: SkillOptCase[] = [];
  const dropped: { reason: string; raw: unknown }[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const r = buildCaseFromItem(item, seed);
    if ("drop" in r) {
      dropped.push({ reason: r.drop, raw: item });
      continue;
    }
    if (seen.has(r.case.id)) {
      dropped.push({ reason: "重复题面", raw: item });
      continue;
    }
    seen.add(r.case.id);
    cases.push(r.case);
  }
  return { ...summarizeCases(cases), cases, dropped, parseError: null };
}

/** 从(可能未闭合的)流式 buffer 里扫出已完整的顶层 `{...}` 对象;正确跳过字符串内的括号与转义。 */
function extractObjects(text: string): string[] {
  const objs: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          objs.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return objs;
}

/** 容错回退:从(可能被截断、数组未闭合的)文本里抠出所有已完整的顶层对象并 JSON.parse。
 * 供 parseAndValidateCases 在严格数组解析失败时救场(题太多被截断时不至于整批丢)。 */
function extractObjectItems(raw: string): unknown[] {
  const items: unknown[] = [];
  for (const chunk of extractObjects(raw)) {
    try {
      items.push(JSON.parse(chunk));
    } catch {
      // 半截对象:跳过
    }
  }
  return items;
}

/** 流式增量解析:从 buffer 里取出已完整、合格、去重的 case(用于「生成一条显示一条」)。
 * 与 parseAndValidateCases 共用 buildCaseFromItem,口径一致;非法/半截对象静默跳过。 */
export function extractCases(buffer: string, seed: number): SkillOptCase[] {
  const cases: SkillOptCase[] = [];
  const seen = new Set<string>();
  for (const chunk of extractObjects(buffer)) {
    let item: unknown;
    try {
      item = JSON.parse(chunk);
    } catch {
      continue;
    }
    const r = buildCaseFromItem(item, seed);
    if ("drop" in r) continue;
    if (seen.has(r.case.id)) continue;
    seen.add(r.case.id);
    cases.push(r.case);
  }
  return cases;
}
