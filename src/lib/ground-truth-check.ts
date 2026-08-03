import type { GroundTruthCheck, GroundTruthCheckKind } from "@/types";

/* -------------------------------------------------------------------------- */
/* Public interfaces                                                           */
/* -------------------------------------------------------------------------- */

export interface CheckResult {
  kind: GroundTruthCheckKind;
  passed: boolean;
  /** 0..1 部分通过比例(按通过比例给分用);缺省按 passed → 1 / 0 处理。 */
  soft?: number;
  note: string;
}

export interface GroundTruthGrade {
  verdict: "passed" | "failed";
  score: number;
  notes: string;
  perCheck: CheckResult[];
}

export interface CheckContext {
  answerText: string;
  userMessageText: string;
  toolEvents: { name: string; calls: number; errors: number }[] | null;
}

/* -------------------------------------------------------------------------- */
/* Default parameters per kind                                                 */
/* -------------------------------------------------------------------------- */

export const DEFAULT_PARAMS = {
  "no-leak": {
    blocklist: [
      "SIGNAL",
      "<thinking",
      "thinking:",
      "面板ID",
      "panel_id",
      "internal_id",
    ],
  },
  "tool-succeeded": {
    toolNamePatterns: ["post", "publish", "send", "tweet", "mail", "share", "schedule"],
  },
  "no-placeholder": {
    placeholderPatterns: [
      "\\{\\{?[^}]+\\}?\\}",
      "\\[(?:first[ _]?name|name|company|company[ _]?name|product|产品|公司)\\]",
      "<(?:name|company)>",
    ],
  },
  // must-include 没有"全局默认约束":约束是逐题的(在 case.params.include / exclude)。
  // 空 include + 空 exclude → 真空通过(soft=1),不会误杀没带约束的题。
  "must-include": {
    include: [] as string[],
    exclude: [] as string[],
  },
} as const;

/* -------------------------------------------------------------------------- */
/* detectScript                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Heuristic Unicode-range script detector.
 * Check order: kana → hangul → han → latin → unknown.
 */
export function detectScript(
  text: string
): "ja" | "ko" | "zh" | "en" | "unknown" {
  // Kana (Hiragana + Katakana): ぀-ヿ  U+3040-U+30FF
  if (/[぀-ヿ]/.test(text)) return "ja";
  // Hangul: 가-힯  U+AC00-U+D7AF
  if (/[가-힯]/.test(text)) return "ko";
  // CJK Unified Ideographs: 一-鿿  U+4E00-U+9FFF
  if (/[一-鿿]/.test(text)) return "zh";
  // Latin letter
  if (/[A-Za-z]/.test(text)) return "en";
  return "unknown";
}

/* -------------------------------------------------------------------------- */
/* Per-kind check functions                                                    */
/* -------------------------------------------------------------------------- */

function checkLangMatch(
  _check: GroundTruthCheck,
  ctx: CheckContext
): CheckResult {
  const ul = detectScript(ctx.userMessageText);
  const al = detectScript(ctx.answerText);

  if (ul === "unknown" || al === "unknown") {
    return {
      kind: "lang-match",
      passed: false,
      note: `语言不可判定(用户=${ul}/回复=${al})`,
    };
  }

  // 汉字为中日共用,纯汉字文本无法可靠区分 zh/ja(无假名的日语会被判成 zh)→
  // 把 zh↔ja 视为兼容,避免把正确的日/中答案误判挂(en/ko 仍严格)。
  const CJK = new Set(["zh", "ja"]);
  const passed = al === ul || (CJK.has(ul) && CJK.has(al));
  return {
    kind: "lang-match",
    passed,
    note: passed
      ? `语言一致(${al})`
      : `语言不一致:用户=${ul},回复=${al}`,
  };
}

function checkNoLeak(check: GroundTruthCheck, ctx: CheckContext): CheckResult {
  const blocklist =
    check.params?.blocklist ?? DEFAULT_PARAMS["no-leak"].blocklist;

  const answerLower = ctx.answerText.toLowerCase();
  const userLower = ctx.userMessageText.toLowerCase();
  // 回声豁免:用户 prompt 自带的词,回答复述不构成外泄;只判答案里冒出、prompt 没有的词
  const hits = blocklist.filter((b) => {
    const needle = b.toLowerCase();
    return answerLower.includes(needle) && !userLower.includes(needle);
  });

  const passed = hits.length === 0;
  return {
    kind: "no-leak",
    passed,
    note: passed ? "无泄漏" : `命中泄漏词:${hits.join("、")}`,
  };
}

function checkToolSucceeded(
  check: GroundTruthCheck,
  ctx: CheckContext
): CheckResult {
  if (ctx.toolEvents === null) {
    return {
      kind: "tool-succeeded",
      passed: false,
      note: "无轨迹,无法确认发布",
    };
  }

  const patterns =
    check.params?.toolNamePatterns ??
    DEFAULT_PARAMS["tool-succeeded"].toolNamePatterns;

  const matched = ctx.toolEvents.filter((t) => {
    const nameLower = t.name.toLowerCase();
    return patterns.some((p) => nameLower.includes(p.toLowerCase()));
  });

  if (matched.length === 0) {
    return {
      kind: "tool-succeeded",
      passed: false,
      note: "未调用发布工具(只写不发)",
    };
  }

  const ok = matched.some((t) => t.errors === 0);
  return {
    kind: "tool-succeeded",
    passed: ok,
    note: ok
      ? `发布工具成功:${matched.map((m) => m.name).join("、")}`
      : "发布工具报错",
  };
}

function checkNoPlaceholder(
  check: GroundTruthCheck,
  ctx: CheckContext
): CheckResult {
  const patterns =
    check.params?.placeholderPatterns ??
    DEFAULT_PARAMS["no-placeholder"].placeholderPatterns;

  const hits = patterns.filter((src) =>
    new RegExp(src, "i").test(ctx.answerText)
  );

  const passed = hits.length === 0;
  return {
    kind: "no-placeholder",
    passed,
    note: passed ? "无占位符" : "命中占位符模式",
  };
}

/**
 * must-include:逐题的可机检成功约束(任务能力题的方差来源)。
 * include 里每条子串都得在答案出现、exclude 里每条都不得出现(均大小写不敏感)。
 * soft = 满足条数 / 总条数 → 平庸 skill 漏一两条得部分分,好 skill 全中得满分,喂出训练梯度。
 * passed(硬判)= 全满足。
 */
function checkMustInclude(
  check: GroundTruthCheck,
  ctx: CheckContext
): CheckResult {
  const include = check.params?.include ?? DEFAULT_PARAMS["must-include"].include;
  const exclude = check.params?.exclude ?? DEFAULT_PARAMS["must-include"].exclude;
  const total = include.length + exclude.length;
  if (total === 0) {
    return { kind: "must-include", passed: true, soft: 1, note: "无约束(真空通过)" };
  }

  const answerLower = ctx.answerText.toLowerCase();
  const missing = include.filter((s) => !answerLower.includes(s.toLowerCase()));
  const leaked = exclude.filter((s) => answerLower.includes(s.toLowerCase()));
  const met = total - missing.length - leaked.length;
  const passed = missing.length === 0 && leaked.length === 0;

  const parts: string[] = [];
  if (missing.length) parts.push(`缺:${missing.join("、")}`);
  if (leaked.length) parts.push(`禁现:${leaked.join("、")}`);
  return {
    kind: "must-include",
    passed,
    soft: met / total,
    note: passed ? `约束全满足(${total})` : `约束 ${met}/${total}(${parts.join(";")})`,
  };
}

/* -------------------------------------------------------------------------- */
/* runGroundTruthChecks                                                        */
/* -------------------------------------------------------------------------- */

export function runGroundTruthChecks(
  checks: GroundTruthCheck[],
  ctx: CheckContext
): GroundTruthGrade {
  if (checks.length === 0) {
    return { verdict: "passed", score: 1, notes: "全部通过", perCheck: [] };
  }

  const perCheck: CheckResult[] = checks.map((c) => {
    switch (c.kind) {
      case "lang-match":
        return checkLangMatch(c, ctx);
      case "no-leak":
        return checkNoLeak(c, ctx);
      case "tool-succeeded":
        return checkToolSucceeded(c, ctx);
      case "no-placeholder":
        return checkNoPlaceholder(c, ctx);
      case "must-include":
        return checkMustInclude(c, ctx);
    }
  });

  // 分数按每条 soft 的均值(布尔检查 soft 缺省 → 通过 1 / 挂 0,向后兼容);verdict 仍要求全通过。
  const score =
    perCheck.reduce((sum, r) => sum + (r.soft ?? (r.passed ? 1 : 0)), 0) /
    perCheck.length;
  const verdict: "passed" | "failed" =
    perCheck.every((r) => r.passed) ? "passed" : "failed";

  const notes =
    verdict === "passed"
      ? "全部通过"
      : perCheck
          .filter((r) => !r.passed)
          .map((r) => `${r.kind}: ${r.note}`)
          .join("; ");

  return { verdict, score, notes, perCheck };
}
