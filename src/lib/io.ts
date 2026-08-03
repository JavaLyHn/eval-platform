import { DEFAULT_SCORE_DIMENSIONS } from "@/lib/mock-data";
import { shortId } from "@/lib/utils";
import type {
  Category,
  Difficulty,
  Question,
  QuestionSeverity,
  QuestionStatus,
  SampleIntent,
  ScoringMode,
} from "@/types";

const VALID_DIFF: Difficulty[] = ["easy", "medium", "hard"];
const VALID_STATUS: QuestionStatus[] = [
  "untested",
  "tested",
  "passed",
  "failed",
];

function parseSeverity(raw: unknown): QuestionSeverity | undefined {
  const m = String(raw ?? "").trim().match(/^p\s*([0-4])/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const folded = n >= 3 ? 2 : n; // P3/P4 → P2;P0/P1/P2 原样
  return `P${folded}` as QuestionSeverity;
}

const VALID_INTENT: SampleIntent[] = ["typical", "boundary", "anomaly"];

function toBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "是", "红线"].includes(s)) return true;
  if (["false", "0", "no", "n", "否"].includes(s)) return false;
  return undefined;
}

const EXPECT_SPLIT_RE = /^([\s\S]*?)\s*禁\s*(?:[（(]\s*硬负\s*[)）])?\s*[:：]\s*([\s\S]*)$/;

/** 从已 alias 映射的 raw 派生标准化字段(缺则派生、有则不覆盖、仅当源含信号)。 */
function deriveImportedFields(raw: Record<string, unknown>): void {
  const ref = typeof raw.referenceAnswer === "string" ? raw.referenceAnswer : "";
  if (ref && raw.passForm == null) {
    const m = ref.match(EXPECT_SPLIT_RE);
    if (m) {
      const pass = m[1].replace(/^【红线】\s*/, "").replace(/[。.\s]+$/, "").trim();
      const fail = m[2].trim();
      if (pass) raw.passForm = pass;
      if (fail && raw.failForm == null) raw.failForm = fail;
    }
  }
  if (raw.isRedLine == null) {
    const p0 = parseSeverity(raw.severity) === "P0";
    const marker = /【红线】|禁\s*[（(]\s*硬负\s*[)）]/.test(ref);
    if (p0 || marker) raw.isRedLine = true;
  }
  if (raw.intent == null) {
    const id = String(raw.number ?? "").toLowerCase();
    const title = String(raw.title ?? "").trim();
    const pos = /-p\d|-p\b|_pos\b|_pos_/.test(id) || title.startsWith("正例");
    const neg = /-n\d|-n\b|_neg\b|_neg_/.test(id) || title.startsWith("反例");
    if (pos && !neg) raw.intent = "typical";
    else if (neg) raw.intent = "anomaly";
  }
}

function normalizeQuestion(raw: Record<string, unknown>): Question | null {
  const title = String(raw.title ?? "").trim();
  const prompt = String(raw.prompt ?? "").trim();
  if (!title || !prompt) return null;

  const diff = String(raw.difficulty ?? "medium").toLowerCase() as Difficulty;
  // Accept either `categories: [...]` (new) or legacy `category: string`.
  const rawCats = raw.categories;
  const legacyCat = raw.category;
  const categories: Category[] = Array.isArray(rawCats)
    ? (rawCats as unknown[])
        .map((c) => String(c).trim())
        .filter(Boolean)
    : typeof legacyCat === "string" && legacyCat.trim()
      ? [legacyCat.trim()]
      : ["营销策略"];
  const status = String(raw.status ?? "untested") as QuestionStatus;

  const tagsRaw = raw.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => String(t)).filter(Boolean)
    : typeof tagsRaw === "string"
      ? tagsRaw
          .split(/[;,，、]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const subPromptsRaw = raw.subPrompts;
  const subPrompts = Array.isArray(subPromptsRaw)
    ? subPromptsRaw
        .map((p) => String(p).trim())
        .filter((p) => p.length > 0)
    : undefined;
  const scoringRaw = String(raw.scoringMode ?? "combined") as ScoringMode;
  const scoringMode: ScoringMode =
    scoringRaw === "per-sub" ? "per-sub" : "combined";

  const agentIdsRaw = raw.agentIds;
  const agentIds = Array.isArray(agentIdsRaw)
    ? agentIdsRaw.map((x) => String(x)).filter(Boolean)
    : typeof agentIdsRaw === "string" && agentIdsRaw
      ? String(agentIdsRaw)
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : shortId("q"),
    number: typeof raw.number === "string" && raw.number ? raw.number : `Q-${Math.floor(Math.random() * 9000 + 1000)}`,
    title,
    prompt,
    subPrompts: subPrompts && subPrompts.length > 0 ? subPrompts : undefined,
    scoringMode,
    agentIds: agentIds && agentIds.length > 0 ? agentIds : undefined,
    kind:
      raw.kind === "skill" || raw.kind === "agent"
        ? (raw.kind as "agent" | "skill")
        : undefined,
    severity: parseSeverity(raw.severity),
    passForm:
      typeof raw.passForm === "string" && raw.passForm.trim()
        ? raw.passForm.trim()
        : undefined,
    failForm:
      typeof raw.failForm === "string" && raw.failForm.trim()
        ? raw.failForm.trim()
        : undefined,
    intent: VALID_INTENT.includes(String(raw.intent) as SampleIntent)
      ? (String(raw.intent) as SampleIntent)
      : undefined,
    isRedLine: toBool(raw.isRedLine),
    outOfScope: toBool(raw.outOfScope),
    categories,
    difficulty: VALID_DIFF.includes(diff) ? diff : "medium",
    tags,
    status: VALID_STATUS.includes(status) ? status : "untested",
    referenceAnswer:
      typeof raw.referenceAnswer === "string"
        ? raw.referenceAnswer
        : undefined,
    criteria:
      Array.isArray(raw.criteria) && raw.criteria.length > 0
        ? (raw.criteria as Question["criteria"])
        : DEFAULT_SCORE_DIMENSIONS.map((d) => ({
            key: d.key,
            label: d.label,
            weight: 1 / DEFAULT_SCORE_DIMENSIONS.length,
          })),
    expectedTokens:
      raw.expectedTokens &&
      typeof raw.expectedTokens === "object" &&
      "min" in raw.expectedTokens &&
      "max" in raw.expectedTokens
        ? (raw.expectedTokens as { min: number; max: number })
        : undefined,
    timeoutMs:
      typeof raw.timeoutMs === "number" ? raw.timeoutMs : undefined,
    lastScore:
      typeof raw.lastScore === "number" ? raw.lastScore : undefined,
    createdAt:
      typeof raw.createdAt === "string"
        ? raw.createdAt
        : new Date().toISOString(),
    // ↓ 无损回灌:导出的题再导入时保留这些字段(存在且合法才带,否则 undefined)。
    industry:
      typeof raw.industry === "string" && raw.industry ? raw.industry : undefined,
    targetEmployeeId:
      typeof raw.targetEmployeeId === "string" && raw.targetEmployeeId
        ? raw.targetEmployeeId
        : undefined,
    targetSkill:
      typeof raw.targetSkill === "string" && raw.targetSkill ? raw.targetSkill : undefined,
    judgeFocus:
      typeof raw.judgeFocus === "string" && raw.judgeFocus.trim()
        ? raw.judgeFocus
        : undefined,
    hasGroundTruth: toBool(raw.hasGroundTruth),
    groundTruthChecks: Array.isArray(raw.groundTruthChecks)
      ? (raw.groundTruthChecks as Question["groundTruthChecks"])
      : undefined,
    attachments: Array.isArray(raw.attachments)
      ? (raw.attachments as Question["attachments"])
      : undefined,
    floorElementIds: Array.isArray(raw.floorElementIds)
      ? (raw.floorElementIds.filter((x) => typeof x === "string") as string[])
      : undefined,
    judgeProfileIds: Array.isArray(raw.judgeProfileIds)
      ? (raw.judgeProfileIds.filter((x) => typeof x === "string") as string[])
      : undefined,
    skilloptCase:
      raw.skilloptCase && typeof raw.skilloptCase === "object"
        ? (raw.skilloptCase as Question["skilloptCase"])
        : undefined,
    author:
      raw.author && typeof raw.author === "object"
        ? (raw.author as Question["author"])
        : undefined,
    variableDefaults:
      raw.variableDefaults && typeof raw.variableDefaults === "object"
        ? (raw.variableDefaults as Record<string, string>)
        : undefined,
    evaluationMode:
      raw.evaluationMode === "manual" || raw.evaluationMode === "llm"
        ? raw.evaluationMode
        : undefined,
  };
}

export function jsonQuestionArray(text: string): unknown[] {
  const data = JSON.parse(text);
  return Array.isArray(data)
    ? data
    : Array.isArray((data as { questions?: unknown[] }).questions)
      ? (data as { questions: unknown[] }).questions
      : [];
}

export function parseQuestionsFromJSON(text: string): Question[] {
  return jsonQuestionArray(text)
    .map((r) => normalizeQuestion(r as Record<string, unknown>))
    .filter((q): q is Question => q !== null);
}

// CSV helpers ---------------------------------------------------------------

function csvEscape(v: string) {
  if (v == null) return "";
  const needsQuote = /[",\n\r]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function csvSplitLine(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          buf += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        buf += c;
      }
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ",") {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out;
}

export function csvSplitRecords(text: string): string[][] {
  // Split into logical records honoring quoted newlines.
  const records: string[][] = [];
  let buf = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          buf += '""';
          i++;
        } else {
          buf += c;
          inQuote = false;
        }
      } else {
        buf += c;
      }
    } else if (c === '"') {
      buf += c;
      inQuote = true;
    } else if (c === "\n" || c === "\r") {
      if (buf.length > 0 || records.length === 0) {
        records.push(csvSplitLine(buf));
        buf = "";
      }
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else {
      buf += c;
    }
  }
  if (buf.length > 0) records.push(csvSplitLine(buf));
  return records.filter((r) => r.some((cell) => cell.length > 0));
}

const CSV_COLUMNS = [
  "number",
  "title",
  "categories",
  "difficulty",
  "status",
  "tags",
  "prompt",
  "subPrompts",
  "scoringMode",
  "agentIds",
  "referenceAnswer",
] as const;

const SUB_PROMPT_DELIM = "\n---\n";

/** 表头别名:字段 → 可接受表头(按优先序)。原英文列名为各字段首选,向后兼容。 */
export const HEADER_ALIASES: Record<string, string[]> = {
  title: ["title", "用例标题", "标题", "题目", "名称", "用例名称", "name"],
  prompt: ["prompt", "测试数据", "题面", "输入", "用户输入", "问题", "测试步骤"],
  number: ["number", "用例id", "用例编号", "编号", "题号", "id"],
  categories: ["categories", "category", "模块", "分类", "维度", "能力点", "类别"],
  referenceAnswer: ["referenceanswer", "reference", "预期结果", "期望结果", "期望", "参考答案", "判据", "预期"],
  severity: ["severity", "priority", "优先级", "p级", "p 级"],
  difficulty: ["difficulty", "难度"],
  tags: ["tags", "标签"],
  status: ["status", "状态"],
  scoringMode: ["scoringmode", "评分模式"],
  agentIds: ["agentids", "员工", "agents"],
  subPrompts: ["subprompts", "追问", "子问题"],
  kind: ["kind", "库"],
  passForm: ["passform", "pass形态", "pass 形态", "期望形态"],
  failForm: ["failform", "fail形态", "fail 形态"],
  intent: ["intent", "意图", "样本意图"],
  isRedLine: ["isredline", "红线", "是否红线"],
  outOfScope: ["outofscope", "超范围", "超范围任务"],
};

const REQUIRED_IMPORT_FIELDS = ["title", "prompt"] as const;

/** 表头(原样)→ {字段: 列 index}。拉丁不分大小写,中文精确;别名按序取首个命中。 */
export function resolveHeaderMap(header: string[]): Record<string, number> {
  const norm = header.map((h) => String(h ?? "").trim());
  const lower = norm.map((h) => h.toLowerCase());
  const out: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const a of aliases) {
      let idx = norm.indexOf(a);
      if (idx < 0) idx = lower.indexOf(a.toLowerCase());
      if (idx >= 0) {
        out[field] = idx;
        break;
      }
    }
  }
  return out;
}

/** 必要列(标题 + 题面)是否都命中。 */
export function hasRequiredColumns(header: string[]): boolean {
  const map = resolveHeaderMap(header);
  return REQUIRED_IMPORT_FIELDS.every((f) => f in map);
}

export function questionsToCSV(qs: Question[]): string {
  const rows: string[] = [CSV_COLUMNS.join(",")];
  for (const q of qs) {
    rows.push(
      [
        q.number,
        q.title,
        (Array.isArray(q.categories) ? q.categories : []).join(";"),
        q.difficulty,
        q.status,
        q.tags.join(";"),
        q.prompt,
        (q.subPrompts ?? []).join(SUB_PROMPT_DELIM),
        q.scoringMode ?? "combined",
        (q.agentIds ?? []).join(";"),
        q.referenceAnswer ?? "",
      ]
        .map((v) => csvEscape(String(v)))
        .join(","),
    );
  }
  return rows.join("\n");
}

export interface RowWithRaw {
  question: Question;
  /** 该行的原始全列(表头→单元格),供 LLM 规范化看全字段(含未映射列)。 */
  raw: Record<string, string>;
}

/** 逐行:映射出 Question(缺 title/prompt 丢弃)+ 保留该行原始全列;两者对齐。 */
export function rowsToQuestionsWithRaw(records: string[][]): RowWithRaw[] {
  if (records.length < 2) return [];
  const header = records[0];
  const map = resolveHeaderMap(header);
  const out: RowWithRaw[] = [];
  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    // 原始全列(表头→单元格),键=原表头文字;供规范化 LLM 看全(含未映射列)。
    const rawRecord: Record<string, string> = {};
    header.forEach((h, j) => {
      const key = String(h ?? "").trim();
      if (key) rawRecord[key] = j < row.length ? String(row[j] ?? "") : "";
    });
    const raw: Record<string, unknown> = {};
    for (const [field, idx] of Object.entries(map)) {
      if (idx >= 0 && idx < row.length) raw[field] = row[idx];
    }
    if (typeof raw.categories === "string" && raw.categories) {
      raw.categories = String(raw.categories)
        .split(/[;,，、]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (typeof raw.subPrompts === "string" && raw.subPrompts) {
      raw.subPrompts = String(raw.subPrompts)
        .split(SUB_PROMPT_DELIM)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    deriveImportedFields(raw);
    const q = normalizeQuestion(raw);
    if (q) out.push({ question: q, raw: rawRecord });
  }
  return out;
}

export function rowsToQuestions(records: string[][]): Question[] {
  return rowsToQuestionsWithRaw(records).map((x) => x.question);
}

/** 把一个 Question 的非空字段序列化成「字段名→值」(json 源无原始行时的原始记录兜底)。 */
export function questionToRawRecord(q: Question): Record<string, string> {
  const rec: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v == null) return;
    const s = Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).join("、") : String(v);
    if (s.trim()) rec[k] = s;
  };
  put("number", q.number);
  put("title", q.title);
  put("prompt", q.prompt);
  put("subPrompts", q.subPrompts);
  put("categories", q.categories);
  put("difficulty", q.difficulty);
  put("tags", q.tags);
  put("referenceAnswer", q.referenceAnswer);
  put("passForm", q.passForm);
  put("failForm", q.failForm);
  put("severity", q.severity);
  put("intent", q.intent);
  return rec;
}

export function parseQuestionsFromCSV(text: string): Question[] {
  return rowsToQuestions(csvSplitRecords(text));
}

export function questionsToJSON(qs: Question[]): string {
  return JSON.stringify({ version: 1, questions: qs }, null, 2);
}

// Evaluation export ---------------------------------------------------------

export interface EvaluationExportRow {
  evaluationId: string;
  questionNumber: string;
  questionTitle: string;
  category: string;
  difficulty: string;
  verdict: string;
  autoScore: number | undefined;
  modelVersion: string | undefined;
  submittedAt: string;
  evaluator: string;
  notes: string;
  scores: string; // "accuracy=9; completeness=8; ..."
  annotationCount: number;
}

const EVAL_CSV_COLS = [
  "evaluationId",
  "questionNumber",
  "questionTitle",
  "category",
  "difficulty",
  "verdict",
  "autoScore",
  "modelVersion",
  "submittedAt",
  "evaluator",
  "scores",
  "annotationCount",
  "notes",
] as const;

export function evaluationsToCSV(rows: EvaluationExportRow[]): string {
  const out: string[] = [EVAL_CSV_COLS.join(",")];
  for (const r of rows) {
    out.push(
      EVAL_CSV_COLS.map((col) => {
        const v = r[col];
        return csvEscape(v == null ? "" : String(v));
      }).join(","),
    );
  }
  return out.join("\n");
}

export function evaluationsToJSON(rows: EvaluationExportRow[]): string {
  return JSON.stringify({ version: 1, evaluations: rows }, null, 2);
}

// ---------------------------------------------------------------------------

export function importTemplateCSV(): string {
  const example: Record<string, string> = {
    number: "Q-0001",
    title: "示例:退款政策问答",
    categories: "客服支持;合规",
    difficulty: "medium",
    status: "untested",
    tags: "退款;政策",
    prompt: "用户问:超过 7 天还能退款吗?请依据平台政策回答。",
    subPrompts: "追问一:那 15 天呢?\n---\n追问二:给我政策原文链接。",
    scoringMode: "combined",
    agentIds: "",
    referenceAnswer: "7 天无理由退款;超过 7 天按具体商品政策处理。",
  };
  return [
    CSV_COLUMNS.join(","),
    CSV_COLUMNS.map((c) => csvEscape(String(example[c] ?? ""))).join(","),
  ].join("\n");
}

export function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
