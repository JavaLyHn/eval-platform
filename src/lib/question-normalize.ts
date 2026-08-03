/** LLM 规范化导入:把一道原始行(可能不规范)整理成与 AI 出题同构的标准题。保原意。 */
import type { Attachment, Question } from "@/types";
import type {
  EmployeeAnchor,
  GeneratedAttachment,
  GeneratedQuestion,
} from "./question-generator";
import { parseGeneratedQuestions } from "./question-generator";
import { compilePrompt } from "./prompt-registry";
import { shortId } from "./utils";

export interface NormalizeRequest {
  /** 一道原始题目的全部原始列(表头→值)。 */
  rawRecord: Record<string, string>;
  /** 目标员工画像(可选);给 LLM 当写判据的上下文。 */
  employee?: EmployeeAnchor;
}

const SCHEMA = [
  "{",
  '  "questions": [',
  "    {",
  '      "title": "string",',
  '      "prompt": "string(=原始题面,最小清理,保原意)",',
  '      "subPrompts": ["string"],',
  '      "difficulty": "easy" | "medium" | "hard",',
  '      "tags": ["string"],',
  '      "referenceAnswer": "string",',
  '      "passForm": "string",',
  '      "failForm": "string",',
  '      "severity": "P0" | "P1" | "P2",',
  '      "intent": "typical" | "boundary" | "anomaly",',
  '      "outOfScope": true | false,',
  '      "attachments": [{ "name": "string(带扩展名,如 周报.md)", "type": "text/markdown | text/plain | text/csv", "text": "string(自拟正文,仅当题面引用了缺失文件时;否则整个数组留空)" }]',
  "    }",
  "  ]",
  "}",
].join("\n");

/** 计算规范化 prompt 的数据块变量(供 compilePrompt / 预览复用)。 */
export function buildNormalizeVars(req: NormalizeRequest): Record<string, string> {
  const emp = req.employee;
  const employeeBlock = emp
    ? [
        `- 角色: ${emp.name} — ${emp.title}`,
        emp.coreTasks.length ? `- 核心任务: ${emp.coreTasks.join("；")}` : "",
        emp.outOfScope ? `- 不做范围: ${emp.outOfScope}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "(未指定具体员工,按通用业务员工理解)";

  const rawBlock =
    Object.entries(req.rawRecord)
      .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n") || "(空)";

  return { employeeBlock, rawBlock, schema: SCHEMA };
}

export function buildNormalizePrompt(req: NormalizeRequest): string {
  return compilePrompt("ai-question-import-normalize", buildNormalizeVars(req));
}

/** 解析规范化 LLM 产出 → 取第 1 道(复用容错解析器);无则 null。 */
export function parseNormalizedQuestion(raw: string): GeneratedQuestion | null {
  return parseGeneratedQuestions(raw)[0] ?? null;
}

// 「轮N:」/「第N轮:」多轮标号(必须带冒号,强信号 —— 避免误伤正文里「第一轮面试」这类无冒号用法)。
const TURN_MARKER = /(?:第\s*[0-9一二三四五六七八九十]+\s*轮|轮\s*[0-9一二三四五六七八九十]+)\s*[:：]/g;
const LEADING_TURN_MARKER = /^\s*(?:第\s*[0-9一二三四五六七八九十]+\s*轮|轮\s*[0-9一二三四五六七八九十]+)\s*[:：]\s*/;
const EDGE_SEP = /^[\s｜|/、,，;；]+|[\s｜|/、,，;；]+$/g;

/**
 * 确定性兜底:LLM 规范化偶尔没按模板把多轮拆干净 —— 把整段「轮1:… 轮2:…」原文留在
 * prompt 里(甚至又把每轮重复塞进 subPrompts,平白多一步)。这里在 prompt 里检出 **≥2 个**
 * 「轮N:/第N轮:」标号时,确定性地按标号拆成 prompt=第1轮 + subPrompts=[第2轮…]、剥掉标号,
 * 总步数正好=轮数(覆盖 LLM 给的 subPrompts)。<2 个标号则不拆,仅剥掉可能残留的单个前导标号。
 */
export function splitInlineTurns(
  prompt: string,
  subPrompts?: string[],
): { prompt: string; subPrompts: string[] } {
  const src = prompt ?? "";
  const markers = src.match(TURN_MARKER) ?? [];
  if (markers.length >= 2) {
    const parts = src
      .split(TURN_MARKER)
      .map((s) => s.replace(EDGE_SEP, "").trim())
      .filter((s) => s.length > 0);
    if (parts.length >= 2) {
      return { prompt: parts[0], subPrompts: parts.slice(1) };
    }
  }
  return { prompt: src.replace(LEADING_TURN_MARKER, "").trim(), subPrompts: subPrompts ?? [] };
}

/** GeneratedAttachment(AI 自拟文本)→ 平台 Attachment:补 id、按正文 UTF-8 字节算 size。 */
function draftedToAttachment(g: GeneratedAttachment): Attachment {
  return {
    id: shortId("att"),
    name: g.name,
    size: new TextEncoder().encode(g.text).length,
    type: g.type,
    text: g.text,
  };
}

/** 把规范化产物叠加到预览行的 base Question 上(复用 id/number,只 enrich);挂目标员工。 */
export function normalizedQuestionToImport(
  base: Question,
  gq: GeneratedQuestion,
  employeeId?: string,
): Question {
  const tags = Array.from(new Set([...(base.tags ?? []), ...(gq.tags ?? [])]));
  const categories = employeeId
    ? Array.from(new Set([employeeId, ...(base.categories ?? [])]))
    : base.categories;
  // 确定性兜底:prompt 里若残留「轮N:」多轮标号,拆成 prompt=第1轮 + subPrompts=[第2轮…]
  // (覆盖 LLM 给的 subPrompts,总步数=轮数);拆出多轮 → 难度归为 hard。
  const split = splitInlineTurns(
    gq.prompt || base.prompt,
    gq.subPrompts && gq.subPrompts.length > 0 ? gq.subPrompts : undefined,
  );
  // AI 自拟附件:仅当原题**没带任何附件**、且规范化产出了自拟文本附件时才挂(不覆盖已有附件;
  // ...base 已把 base.attachments 透传,这里只在需要时覆盖)。
  const baseHasAttachments =
    Array.isArray(base.attachments) && base.attachments.length > 0;
  const draftedAttachments =
    !baseHasAttachments && gq.attachments && gq.attachments.length > 0
      ? gq.attachments.map(draftedToAttachment)
      : null;
  return {
    ...base,
    title: gq.title || base.title,
    prompt: split.prompt || base.prompt,
    subPrompts: split.subPrompts.length > 0 ? split.subPrompts : undefined,
    difficulty:
      split.subPrompts.length > 0 ? "hard" : (gq.difficulty ?? base.difficulty),
    tags,
    categories,
    referenceAnswer: gq.referenceAnswer ?? base.referenceAnswer,
    passForm: gq.passForm ?? base.passForm,
    failForm: gq.failForm ?? base.failForm,
    severity: gq.severity ?? base.severity,
    intent: gq.intent ?? base.intent,
    outOfScope: gq.outOfScope ?? base.outOfScope,
    ...(gq.judgeFocus ? { judgeFocus: gq.judgeFocus } : {}),
    ...(draftedAttachments ? { attachments: draftedAttachments } : {}),
    ...(employeeId ? { targetEmployeeId: employeeId } : {}),
  };
}
