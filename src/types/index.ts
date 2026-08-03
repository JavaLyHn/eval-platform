export type Difficulty = "easy" | "medium" | "hard";

export type QuestionStatus = "untested" | "tested" | "passed" | "failed";

/**
 * Question category. Open string — users can add new categories from the
 * question form. The constants below are seeded built-ins, useful for the
 * filter dropdown and as defaults.
 */
export type Category = string;

export const BUILTIN_CATEGORIES = [
  "Agent 核心",
  "营销策略",
  "平台运营",
  "横向能力",
  "增长 / 数据",
  "用户研究",
  "综合诊断",
] as const;

export type GroundTruthCheckKind =
  | "lang-match"
  | "no-leak"
  | "tool-succeeded"
  | "no-placeholder"
  | "must-include";

export interface GroundTruthCheck {
  kind: GroundTruthCheckKind;
  /** per-probe 覆盖;缺省用 ground-truth-check.ts 里的 DEFAULT_PARAMS[kind]。 */
  params?: {
    blocklist?: string[];
    toolNamePatterns?: string[];
    placeholderPatterns?: string[];
    /** must-include:必含子串(大小写不敏感),缺一即扣分。 */
    include?: string[];
    /** must-include:禁现子串(大小写不敏感),出现即扣分。 */
    exclude?: string[];
  };
}

export interface ScoringCriterion {
  key: string;
  label: string;
  weight: number;
  description?: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl?: string; // base64 data URL —— 图片(多模态)/ 小文件
  /** 文本类文件解码后的正文;有则随题内联进发送 prompt(见 question-attachments)。 */
  text?: string;
}

export type ScoringMode = "combined" | "per-sub";

/** How the answer to this question gets scored. */
export type EvaluationMode = "manual" | "llm";

/**
 * 样本意图（评测标准 §6：样本必须覆盖典型 / 边界 / 异常场景）。
 * - typical:  正常业务最常见的输入
 * - boundary: 临近能力边界但仍在范围内的输入
 * - anomaly:  异常输入（被截断、字段缺失、噪声等），考验稳健性
 */
export type SampleIntent = "typical" | "boundary" | "anomaly";

/**
 * 题目严重度等级（用于抽审优先级 + 强约束闸门）。
 * P0 > P1 > P2，与平台暴露问题分级一致。
 */
export type QuestionSeverity = "P0" | "P1" | "P2";

export interface Question {
  id: string;
  number: string;
  title: string;
  prompt: string;
  /** Additional sequential prompts sent after `prompt`, sharing chat context. */
  subPrompts?: string[];
  /** "combined": one evaluation per question. "per-sub": one evaluation per step. */
  scoringMode?: ScoringMode;
  /** One or more category labels. Order is not significant. */
  categories: Category[];
  /**
   * 行业分类(可选,单选)— agent 题的业务行业维度(如 跨境电商 / SaaS)。
   * 取值来自 genDimensions.industries 预置 + 用户新增;题库可按此筛选 / 分组。
   */
  industry?: string;
  difficulty: Difficulty;
  tags: string[];
  status: QuestionStatus;
  referenceAnswer?: string;
  criteria: ScoringCriterion[];
  expectedTokens?: { min: number; max: number };
  timeoutMs?: number;
  lastScore?: number;
  createdAt: string;
  attachments?: Attachment[];
  variableDefaults?: Record<string, string>;
  /** Agent profile IDs this question is applicable to. Empty/undefined = any. */
  agentIds?: string[];
  /** "manual" (人工) or "llm" (LLM-as-Judge). Defaults to "manual". */
  evaluationMode?: EvaluationMode;
  /**
   * Judge profile override(s) when evaluationMode === "llm".
   * - Single element: traditional single-judge mode.
   * - Multiple elements (R2): cross-judge calibration — all judges score the
   *   same answer, agreement % is computed; <85% → needsReview.
   */
  judgeProfileIds?: string[];

  /* ----- Standardization fields（P0-3，标准 §5 / §6 / §7） --------------- */

  /**
   * Pass 形态（标准 §5）：告诉负责人"做到什么算成功"。
   * 评测计划级的 Pass 形态在 MetricInstance 上，这里是**题目级**的 — 用于
   * 单题人工抽审 / Judge agent 自动判定的语义锚点。
   */
  passForm?: string;
  /** Fail 形态：告诉负责人"出现什么反例就不算成功"。 */
  failForm?: string;
  /**
   * 是否为超范围任务（用于异常压力测试，标准 §6 + §3.3）。
   * `true` 时这道题被 adversarial agent 选中跑，期望员工触发兜底。
   */
  outOfScope?: boolean;
  /**
   * 是否有客观正确答案（ground truth）— 决定 judge agent 能否全自动判错。
   * 财务计算 / 合规条款查询等通常 true；文案 / 策略 / 诊断通常 false。
   */
  hasGroundTruth?: boolean;
  /** 确定性 ground-truth 检查;非空 = 这是一道可自动确定性判分的 probe。 */
  groundTruthChecks?: GroundTruthCheck[];
  /**
   * SkillOpt 出题载体:AI 出题保存到题库时把 caseType + expected + checks 原样存这里,
   * 跑 SkillOpt 时 questionToCase 据此还原(三类 interception/acceptAny/standard 全保真,
   * must-include 约束 / standard 意图金标都在 expected 里)。仅 kind=skill 的 AI 题用。
   */
  skilloptCase?: {
    caseType: "interception" | "acceptAny" | "standard";
    expected: {
      intercepted?: boolean;
      language?: string;
      mustInclude?: string[];
      mustExclude?: string[];
      intentType?: string;
      requiresClarification?: boolean;
    };
    groundTruthChecks: string[];
  };
  /** 严重度（决定抽审优先级 + 红线触发判定权重）。默认 P2。 */
  severity?: QuestionSeverity;
  /**
   * 题目作者 — 用于盲测校验（标准 §6）：评分人不能 = 作者。
   * 平台在选评分员时如检测到 evaluator.name === author.name 弹警告。
   */
  author?: EvaluatorRef;
  /** 样本意图：典型 / 边界 / 异常（标准 §6 要求样本集覆盖三类）。 */
  intent?: SampleIntent;
  /**
   * 这道题测哪位标准员工（来自 StandardEmployee.id：aria / sam / dex）。
   * 题库里的题与 demo 员工挂钩，评测计划挑样本时按员工筛。
   */
  targetEmployeeId?: string;
  /** 题归属:agent(按员工,默认)/ skill(按"员工×技能",用于 SkillOpt)。缺省视为 agent。 */
  kind?: "agent" | "skill";
  /**
   * 临时题:首页手动对话自动建的"可评分但未入库"题 —— 能在打分里评,但**不进题库列表**;
   * 用户显式「保存到题库」后置 false 转正。避免"发一条就进题库"。
   */
  transient?: boolean;
  /** skill 题专用:所属技能名(= SkillOpt 顶部 seed 的 skillName)。配合 targetEmployeeId 唯一定位一个技能的题。 */
  targetSkill?: string;
  /** 这道题作为"探针"验证哪些下限要素（FloorElement.id）。 */
  floorElementIds?: string[];
  /**
   * 显式红线标记:不挂下限要素也能把题标成「安全红线题」(judge 走一票否决)。
   * 与 floorElementIds 的红线要素是「或」关系,集中判定见 questionIsRedLine()。
   */
  isRedLine?: boolean;
  /** 评测重点提示:给 LLM judge 的额外叮嘱(可选,自由文本)。 */
  judgeFocus?: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  /** The question currently being evaluated in this conversation, if any. */
  activeQuestionId: string | null;
  /**
   * Upstream agent session key (e.g. the agent gateway's `sessions.create` key).
   * null/undefined means "ask backend to create a fresh session on next send".
   */
  gatewaySessionId: string | null;
  createdAt: string;
  /** Bumped each time a message is added/streamed in this conversation. */
  updatedAt: string;
  /**
   * 用户在侧栏点星标置顶,置顶的会话聚到列表最上方的「置顶」分组。
   * 仅本机偏好 —— 下行合并对会话元信息 local-wins(见 hydrate.ts
   * mergeConversationsWithMessages),与标题同一处理,不跨设备同步。
   */
  pinned?: boolean;
}

export interface TranscriptStep {
  role: "user" | "assistant" | "tool";
  content: string;
  /** 工具步骤:工具名 */
  toolName?: string;
  /** 工具是否出错 */
  isError?: boolean;
  /** 仅白名单工具(present_options/panel_show/preview_file)可见 */
  toolInput?: unknown;
  /** 仅白名单工具可见 */
  output?: unknown;
  createTime?: string;
}

export interface AgentTranscript {
  /** 来源桥:platform(Socket.IO)/ gateway(OpenAI 兼容网关,经后端代理)。 */
  source: "platform" | "gateway";
  /** 上游真实 sessionId(非复合串;gateway 为一次性合成 id) */
  sessionId: string;
  fetchedAt: string;
  steps: TranscriptStep[];
  /** gateway(Dex)经 delta 数组返回的文件产物(base64 data URI);其它源无。 */
  files?: { filename: string; dataUri: string }[];
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  questionId?: string;
  /** Profile that produced this message (assistant) or was targeted by it (user). */
  agentProfileId?: string;
  /** 0-based index of the turn for multi-turn questions. */
  turnIndex?: number;
  /** Total turns this question had (set on the user message of each turn). */
  turnTotal?: number;
  /** 多 trial:本条是该题第几次试跑(0-based)。仅多 trial 运行设置。 */
  trialIndex?: number;
  /** 多 trial:该题计划试跑总次数(K)。仅多 trial 运行设置。 */
  trialTotal?: number;
  /** 用户消息附带的图片(data URL,base64)—— 聊天输入框上传;气泡里回显缩略图。 */
  images?: string[];
  /** 用户消息附带的文本文件(气泡显示芯片;内联文本已并入发给 agent 的 prompt)。 */
  files?: import("@/lib/file-input").AttachedFile[];
  createdAt: string;
  isStreaming?: boolean;
  /** Set when the answer was stopped early (manual stop or upstream error). */
  interrupted?: boolean;
  /**
   * 中断的来源,用于区分「可评」与「不可评」:
   *   - "agent-pause":agent 主动反问/暂停等用户(present_options 等)——是完整的一轮,可评测;
   *   - "timeout":本题超时被自动中断——部分文本,不计入评测;
   *   - "error":上游请求失败——不计入评测。
   * 旧数据可能只有 interrupted=true 而无本字段,按「可评」处理(绝大多数旧中断即 agent 反问)。
   */
  interruptKind?: "agent-pause" | "timeout" | "error";
  durationMs?: number;
  tokens?: number;
  /** 真实/估算的输入 token。 */
  tokensIn?: number;
  /** 真实/估算的输出 token。 */
  tokensOut?: number;
  /** true = tokensIn/tokensOut 为估算(如 platform);缺省 = 厂商真实用量。 */
  tokensEstimated?: boolean;
  modelVersion?: string;
  /** 完整结构化运行轨迹(目前仅 platform provider 产出)。 */
  transcript?: AgentTranscript;
}

export interface ScoreDimension {
  key: string;
  label: string;
  value: number; // 0-10
  max: number;
}

export interface Annotation {
  id: string;
  quote: string;
  label?: string;
  note?: string;
  createdAt: string;
}

/** 不确定信号类型(静默错误的语言线索)。 */
export type UncertaintySignalType =
  | "hedging" // 软化措辞:可能 / 大概 / 我认为应该
  | "clarify" // 反问澄清:你是指 X 吗 / 需要更多信息
  | "refusal" // 拒答 / 能力声明:我无法 / 超出范围
  | "confidence"; // 主动置信度声明:我有 X% 把握 / 仅供参考请核实

export interface UncertaintySignal {
  type: UncertaintySignalType;
  /** 触发该信号的原文片段(截断到 ≤200 字)。 */
  quote: string;
}

/** 失败成因 6 类(北极星原则4):知识/工具/参数/规划/风格/安全。 */
export type FailureCategory =
  | "knowledge"
  | "tool"
  | "param"
  | "planning"
  | "style"
  | "safety";

/** 一道失败题的归因:主因 + 可选次因。纯诊断,不改 verdict。 */
export interface FailureAttribution {
  primary: FailureCategory;
  /** 次要成因(不含 primary,去重);可空。 */
  secondary?: FailureCategory[];
  /** 来源:judge 自动 / 红线确定性 / 人工。 */
  source: "judge" | "redline" | "manual";
  note?: string;
}

export interface Evaluation {
  id: string;
  questionId: string;
  messageId: string;
  /** When present, this eval covers one specific sub-step of the question. */
  subIndex?: number;
  /**
   * 多 trial 试跑评测:被评回答是第几次 trial(0-based)。带此标的评测**只计
   * verdict(通过率 / pass^k),不计分** —— scores 置空、autoScore 置 undefined,
   * 因而自动被一切平均分统计排除(均以 autoScore != null 为分母)。
   */
  trialIndex?: number;
  scores: ScoreDimension[];
  autoScore?: number;
  notes: string;
  verdict: "passed" | "failed";
  submittedAt: string;
  annotations?: Annotation[];
  modelVersion?: string;
  /** Profile that answered this question. */
  agentProfileId?: string;
  /** Who submitted this evaluation, if a user profile was set. */
  evaluator?: EvaluatorRef;
  /**
   * Set when an LLM produced (or seeded) this evaluation.
   * In multi-judge mode this is the "primary" (first) judge — full breakdown
   * lives in `calibrationSnapshots`.
   */
  judgeProfileId?: string;
  /**
   * Per-judge results when this evaluation came from a multi-judge calibration
   * run (R2). Each entry = one judge's view of the same answer; together they
   * drive the agreement metric.
   */
  calibrationSnapshots?: Array<{
    judgeProfileId: string;
    scores: ScoreDimension[];
    verdict: "passed" | "failed";
    notes: string;
    /** 该 judge 给出的失败主因(用于多 judge 归因聚合)。 */
    failureCategory?: FailureCategory;
    uncertaintySignals?: UncertaintySignal[];
  }>;
  /** Pass/Fail agreement rate (0-100) across `calibrationSnapshots`. ≥85 OK. */
  agreementRate?: number;
  /** Raw LLM judge output for traceability. */
  judgeRawOutput?: string;
  /** 发给 LLM judge 的评测 prompt(多裁判共用同一份)。用于轨迹追溯。 */
  judgePrompt?: string;
  /** 本次评测实际使用的 llm-judge prompt 版本(Prompt 管理;1=内置默认)。 */
  judgePromptVersion?: number;
  /** 失败成因归因(仅 verdict==="failed" 时有意义)。纯诊断。 */
  failureAttribution?: FailureAttribution;
  /** judge 检测到的不确定信号(静默错误线索)。纯诊断,不影响判定/分数。 */
  uncertaintySignals?: UncertaintySignal[];
  /** 裁判判定所依据/踩的 FloorElement id(由 citedFloorRefs 映射校验后);无则省略。 */
  citedFloorElementIds?: string[];
}

/* -------------------------------------------------------------------------- */
/* Evaluation Report — 手动生成的评测报告快照                                  */
/*                                                                            */
/* 用户在数据看板上点「生成报告」，把当前 scope 下的 (question, answer, eval)  */
/* 三元组冻结成一份只读快照。题目改名 / agent 改名 / 评测重做 后历史报告       */
/* 不受影响（所有字段都按生成时刻的值 snapshot）。                              */
/* -------------------------------------------------------------------------- */

/** 报告里的一道题：题目快照 + 回答 + 评分。 */
/** 报告里单个裁判 / 评测者对一道题的结果(生成时刻冻结,名字已解析,不再是 profile id)。 */
export interface ReportJudgeResult {
  /** 裁判显示名(LLM 模型名 / 「人工 · 姓名」),报告生成时已解析冻结。 */
  name: string;
  /** 该裁判是 LLM 还是人工。 */
  kind: "llm" | "human";
  verdict: "passed" | "failed";
  /** 该裁判给出的加权分(可空)。 */
  score?: number;
  /** 该裁判各维度的分(报告生成时冻结),用于逐裁判展开维度明细。 */
  scores?: ScoreDimension[];
  /** 该裁判的评语。 */
  notes?: string;
}

export interface ReportItem {
  questionId: string;
  /** 生成时刻的题目标题（即使后续改名也保留）。 */
  questionTitle: string;
  /** 生成时刻的题目内容（即使后续编辑也保留）。 */
  questionPrompt: string;
  /** Assistant 给出的回答（asst message content）。 */
  answer: string;
  /**
   * 生成报告时刻冻结的题目附件(随题发送给 agent 的文件)—— 供报告完整还原「agent
   * 当时看到了什么」。文本类连正文一起冻结、可在报告里预览;旧报告无此字段则不显示。
   */
  attachments?: Attachment[];
  verdict: "passed" | "failed";
  autoScore?: number;
  /** 每个评分维度的分数（准确性 / 专业性 / 语气）。 */
  scores: ScoreDimension[];
  /** Judge / 评测者的评语。 */
  notes?: string;
  /** 评测提交时间。 */
  submittedAt: string;
  /** 失败成因归因快照(报告生成时刻冻结)。 */
  failureAttribution?: FailureAttribution;
  /** 各裁判逐个结果(多 judge 校准时 ≥2 条;单 judge / 人工 1 条),名字已解析冻结。 */
  judges?: ReportJudgeResult[];
  /** 多裁判 Pass/Fail 一致率(0-100,≥85 视为校准达标)。 */
  agreementRate?: number;
  /** 本次 LLM 评测实际使用的 llm-judge prompt 版本(Prompt 管理;1=内置默认)。 */
  judgePromptVersion?: number;
  /**
   * 困难题逐轮评分:同题各轮收拢成一条 ReportItem,这里逐轮展开。
   * 顶层 verdict/autoScore/scores 为整题汇总(任一轮失败=失败,分=各轮均值)。
   */
  subResults?: ReportItemSub[];
  /**
   * 多 trial 试跑:同题 K 次(单-prompt 每次一条 verdict-only 评测)收拢成一条
   * ReportItem 时,这里逐次展开。多 trial 设计上**只测通过率/稳定性、不打分**,故各次
   * 无维度分;顶层 verdict = pass^k 是否成立、scores 空。与 subResults 互斥。
   */
  trials?: ReportItemTrial[];
  /** 多 trial 的 pass^k 汇总(仅 trials 存在时有)。 */
  passK?: ReportItemPassK;
}

/** 多 trial 里某一次试跑的评测快照(verdict-only,无维度分)。 */
export interface ReportItemTrial {
  /** 第几次试跑(0-based)。 */
  trialIndex: number;
  /** 该次 Agent 回答。 */
  answer: string;
  verdict: "passed" | "failed";
  notes?: string;
  judges?: ReportJudgeResult[];
  agreementRate?: number;
  judgePromptVersion?: number;
}

/** 多 trial 的 pass^k 汇总(报告生成时冻结)。 */
export interface ReportItemPassK {
  /** 实际评测的 trial 次数。 */
  trials: number;
  /** verdict==="passed" 的次数。 */
  passed: number;
  /** 目标次数 k(计划试跑数)。 */
  k: number;
  /** pass^k 是否成立(跑满 k 且每次都过)。 */
  passPowerK: boolean;
  /** green=达标 / partial=有过有挂 / incomplete=全过但未跑满 k / red=0 过或无数据。 */
  status: "green" | "partial" | "incomplete" | "red";
}

/** 困难题里某一轮的评测快照(逐轮单评)。 */
export interface ReportItemSub {
  subIndex: number;
  /** 该轮用户提问。 */
  userPrompt: string;
  /** 该轮 Agent 回答。 */
  answer: string;
  verdict: "passed" | "failed";
  autoScore?: number;
  scores: ScoreDimension[];
  notes?: string;
  judges?: ReportJudgeResult[];
  agreementRate?: number;
  judgePromptVersion?: number;
}

/* ----- §6 标准化报告:指标聚合 ----------------------------------------- */

/** 报告类型:A 首版 / B 迭代。 */
export type ReportKind = "A" | "B";

/** 报告结论(§6:通过全量 / 限定通过 / 未通过)。 */
export type ReportConclusion = "pass" | "limited" | "blocked";

/** 一行指标的聚合结果。 */
export interface MetricRow {
  /** 稳定 key(通用指标固定,如 "completion";专属指标用 ScoreDimension.key)。 */
  key: string;
  label: string;
  kind: "general" | "specific";
  /** 展示用文案,如 "92%" / "8.4 / 10" / "需人工采集" / "—"。 */
  actualLabel: string;
  /** 可比较数值。量纲固定:百分比类(完成/静默/边界/一致性)0-100;评分类(专属)0-10。算不出为 undefined。 */
  actualValue?: number;
  /** 用户填的目标值(同 actualValue 量纲)。 */
  target?: number;
  /** 静默错误率 / 红线为 true(值越低越好)。 */
  betterWhenLower?: boolean;
  /** pass=达标 / fail=未达标 / na=无数据或未设目标 / manual=必须人工。 */
  status: "pass" | "fail" | "na" | "manual";
  /** 该指标只能人工采集(如满意度)。报告生成后可在报告页手动录入实测值,标记恒为 true。 */
  manual?: boolean;
  note?: string;
}

/** B 类差异表的一行。 */
export interface MetricDiffRow {
  key: string;
  label: string;
  kind: "general" | "specific";
  prevValue?: number;
  currValue?: number;
  /** currValue - prevValue(两者皆为数才有)。 */
  delta?: number;
  /** 纯数值升降(不做好坏归一):up/down/flat/na。 */
  direction: "up" | "down" | "flat" | "na";
  betterWhenLower?: boolean;
  note?: string;
}

/** B 类整体判定。 */
export type DiffSummary = "improved" | "declined" | "flat" | "mixed";

/** 完整指标聚合块(生成时算出并冻结进报告)。 */
export interface ReportMetrics {
  general: MetricRow[];
  specific: MetricRow[];
  /** 展示分组(redline + silent-error),非硬闸门。 */
  strongConstraint: { keys: string[]; allMet: boolean };
  conclusion: ReportConclusion;
  /** pass^k 口径记录(一致性用)。 */
  k: number;
}

/** §6 报告头,全可选 free-text(原出自被移除的 EvaluationPlan,不发明)。 */
export interface ReportHeaderMeta {
  businessOwner?: string;
  techOwner?: string;
  approver?: string;
  targetReleaseDate?: string;
  period?: string;
}

export interface EvaluationReport {
  id: string;
  createdAt: string;
  /** 用户填的报告标题。 */
  title: string;
  /** 被测 agent 的 profile id（agent-kind）。 */
  agentProfileId: string;
  /** 生成时刻的 agent 名字 snapshot。 */
  agentName: string;
  items: ReportItem[];
  /**
   * 生成这份报告的用户（按生成时刻的 user profile 盖章）。
   * 用于「每个用户只看自己的报告」过滤。老报告无此字段 → 视为无主，对所有人可见。
   */
  owner?: EvaluatorRef;
  /** 生成时刻冻结的发版裁定(仅安全红线口径)。老报告无此字段 → 预览页按 items 现算兜底。 */
  canRelease?: boolean;
  releaseBlockers?: { key?: string; label?: string }[];
  /** §6 报告类型(老报告无 → 视为无聚合的快照报告)。 */
  kind?: ReportKind;
  /** 生成时冻结的指标聚合块。老报告无。 */
  metrics?: ReportMetrics;
  /** B 类:上一版报告 id。 */
  baselineReportId?: string;
  /** B 类:冻结的上一版指标(防上一版被删/改)。 */
  baselineMetrics?: ReportMetrics;
  /** §6 报告头(全可选)。 */
  header?: ReportHeaderMeta;
  /** 用户填的目标值留档(MetricRow.key → 目标值)。 */
  targets?: Record<string, number>;
}

export type EvaluationRunStatus =
  | "queued" | "answering" | "judging" | "reporting"
  | "done" | "partial" | "failed" | "canceled" | "interrupted";

export interface EvaluationRunConfig {
  questionIds: string[];
  /** 每题 trial 次数(= pass^k 的 k);默认 1。 */
  trialsPerQuestion: number;
  judgeProfileIds: string[];
  /** 已评题处理,沿用批量评分语义。 */
  judgeMode: "skip" | "redo";
}

export interface EvaluationRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** 被测 agent profile;整个 run 所有作答钉死它。 */
  subjectProfileId: string;
  /** 自由文本版本标签。 */
  versionLabel: string;
  config: EvaluationRunConfig;
  status: EvaluationRunStatus;
  progress: { answered: number; judged: number; total: number };
  /** 答题队列所在会话,供编排器匹配"本 run 的队列是否跑完"。 */
  runConversationId?: string;
  /** 评完出的报告 id(复用 reports 切片)。 */
  reportId?: string;
  /** verdict=failed 的题(喂"只回归失败")。 */
  failedQuestionIds?: string[];
  rerunOfRunId?: string;
  onlyFailedFromRunId?: string;
  baselineRunId?: string;
  error?: string;
}

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

/**
 * What the agent is doing right now (per-request lifecycle), separate from
 * the persistent connection status.
 *
 *  - idle       : nothing in flight
 *  - thinking   : request sent, no response chunks yet
 *  - streaming  : chunks arriving from the agent
 */
export type AgentActivity = "idle" | "thinking" | "streaming";

export type RightTab =
  | "library"
  | "current"
  | "preview"
  | "evaluation"
  | "results"
  | "adaptive"
  | "dashboard"
  | "skills"
  | "employees";

/**
 * A single capability the agent declares it has — e.g. a tool, a domain
 * skill, or a system-defined plugin. Returned by the bridge's /v1/skills
 * endpoint (or any provider that implements `listSkills`).
 */
export interface AgentSkill {
  /** Stable identifier — used as React key, can echo the upstream tool name. */
  id: string;
  /** Human-readable label shown on the card title. */
  name: string;
  /** One-paragraph description; rendered as plain text. */
  description?: string;
  /** Optional grouping label (e.g. "工具", "知识", "推理"). */
  category?: string;
  /** Free-form tags rendered as small badges below the card. */
  tags?: string[];
  /** Optional icon hint (lucide-react name) — UI may map to an icon. */
  icon?: string;
  /** Free-form key→value metadata shown in an expandable details block. */
  meta?: Record<string, string | number | boolean>;
  /**
   * Optional full skill body (e.g. SKILL.md markdown). Providers that carry
   * the complete skill text (like gateway, sourced from the repo) populate it;
   * the UI shows it in an expandable full-text block. Live bridges that only
   * list tool names leave it undefined.
   */
  body?: string;
  /**
   * Optional attached files (scripts / references / templates / tests …),
   * relative path + full text content. Populated for bundled skills sourced
   * from the repo so the UI can browse the complete skill package. Undefined
   * for live bridges that don't ship file bodies.
   */
  files?: Array<{ path: string; content: string }>;
}

/**
 * A skill record returned by GET /v1/platform/skills.
 * `templateIds` is often length-1 but can be empty for "common" skills.
 */
export interface PlatformSkill {
  id: string;
  name: string;
  description?: string;
  version?: string;
  templateIds?: string[];
  isCommon?: boolean;
}

export interface PlatformEmployee {
  templateId: string;
  templateName: string;
}

/** Response shape of GET /v1/skills (and `AgentClient.listSkills`). */
export interface AgentSkillsResult {
  /** Agent id the listing belongs to. */
  agent?: string;
  /** Bridge / agent version, for debugging. */
  version?: string;
  /** When the listing was generated (ISO). */
  generatedAt?: string;
  skills: AgentSkill[];
}

/* -------------------------------------------------------------------------- */
/* Floor Guarantee（保下限）— Layer1/2 关键要素"零缺口"对象                    */
/* 详见 docs/superpowers/specs/2026-05-30-floor-guarantee-保下限-design.md     */
/* -------------------------------------------------------------------------- */

/** 镜像企业架构蓝图 Layer1/2 的 10 个模块。前 5 → L1，后 5 → L2。 */
export type FloorCategory =
  | "master-data" // L1 主数据（客户/员工/产品/组织）
  | "business-data" // L1 业务数据（订单/合同/工单/交易）
  | "doc-knowledge" // L1 文档知识（文档/FAQ）
  | "template-asset" // L1 模板资产（Prompt/SOP）
  | "eval-data" // L1 评估数据（质量评分/历史反例/A·B/效果监测）
  | "permission-identity" // L2 权限与身份（角色权限/数据边界/操作审计）
  | "business-rules" // L2 业务规则库（流程规范/风控规则/责任归属）
  | "human-confirmation" // L2 人工确认（操作中断/外部处理/重要节点）
  | "enterprise-tools" // L2 企业系统工具（CRM/ERP/OA/工单）
  | "audit-security"; // L2 审计与安全（日志记录/操作回溯/异常检测）

/** 一条"下限要素"：守住它 = 地基某一处零缺口。 */
export interface FloorElement {
  id: string;
  /** 归属员工（"aria" | "sam"）。 */
  employeeId: string;
  /** 由 category 决定，冗余存便于分组。 */
  layer: "L1" | "L2";
  category: FloorCategory;
  /** 蓝图子项，如「数据边界」「风控规则」「操作中断」「CRM」。 */
  subType?: string;
  /** 具体要素名。 */
  title: string;
  /** 做到什么算"在位"。 */
  passForm: string;
  /** 出现什么算"缺口"。 */
  failForm: string;
  /** 踩了即一票否决。 */
  isRedLine: boolean;
  /** 是否要求出处可溯（L1 知识类常 true）。 */
  requiresCitation?: boolean;
  /** 来源（inferred 留给 Phase 4 反推补漏）。 */
  source: "seed" | "llm" | "manual" | "inferred";
  /** 若 seed：关联的 specificMetricTemplate key。 */
  sourceMetricKey?: string;
  /** 已知踩坑（如 platform 的 P0），用于出探针题。 */
  counterExamples?: string[];
  /** ISO 8601 创建时刻。 */
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Standard AI Employee — 标准员工档案                                        */
/*                                                                            */
/* 来自 evaluation-standard §1-§4：                                            */
/*   一个 AI 员工 = 基座模型 + SOP + Skills + 知识库 + 上下文 + 兜底 + 可观测 */
/*   demo 标准线预置 Aria / Sam(可编辑 / 扩展),扩展线经网关接入 Dex,        */
/*   客户定制员工与内部辅助 agent 用各自独立标准。                            */
/* -------------------------------------------------------------------------- */

/** Relevance L1-L4 自治等级（来自 platform-evolution §3.6）。 */
export type AutonomyLevel = "L1" | "L2" | "L3" | "L4";

/** AI 员工的任务输入形态。 */
export type EmployeeInputForm = "dialog" | "form" | "file" | "api";

/** AI 员工的任务输出形态。 */
export type EmployeeOutputForm =
  | "online-artifact" // 在线产物（仪表盘 / 看板）
  | "document" // 文档（报告 / 模板）
  | "triggered-action" // 真实触发的外部动作（发邮件 / 推文 / API call）
  | "asset"; // 资产（品牌手册 / 知识库条目）

/**
 * 角色专属指标的预置模板。业务方在评测计划里基于此填具体目标值 + Pass/Fail
 * 形态。模板本身只是"建议起点"，每员工 2-3 项。
 */
export interface EmployeeMetricTemplate {
  /** 内部 id，跨员工唯一。e.g. "aria.zero-fabrication"。 */
  key: string;
  /** 显示名。 */
  label: string;
  /** 含义说明，告诉业务方这个指标在测什么。 */
  description: string;
  /** Pass 形态参考文案（占位提示，业务方可改）。 */
  passFormHint?: string;
  /** Fail 形态参考文案（占位提示，业务方可改）。 */
  failFormHint?: string;
}

/** 角色专属指标的用户改写:只存改过的字段,缺字段沿用内置原值。 */
export type MetricOverride = Partial<
  Pick<
    EmployeeMetricTemplate,
    "label" | "description" | "passFormHint" | "failFormHint"
  >
>;

/**
 * 每员工「角色专属指标」自定义层(overlay)。
 * 内置指标(STANDARD_EMPLOYEES.specificMetricTemplates)保持不可变;
 * 用户的改写 / 隐藏 / 新增都落在这里。空 overlay ⟺ 完全用内置。
 */
export interface EmployeeMetricsOverlay {
  /** 内置指标 key → 改写过的字段。 */
  overrides: Record<string, MetricOverride>;
  /** 被隐藏的内置指标 key。 */
  hiddenKeys: string[];
  /** 用户 / AI 新增的自定义指标(自带 key)。 */
  custom: EmployeeMetricTemplate[];
}

/**
 * 「源定义画像」— 从agent 定义仓(agent-defs)每位 AI
 * 员工的 IDENTITY / SOUL / AGENTS 等源定义文档忠实精炼而来,作为评测平台
 * 「被测对象画像」的权威补充。只读展示,不参与评分;评测构造仍走
 * `specificMetricTemplates` 等字段。
 */
export interface EmployeeSourceProfile {
  /** 一句话人设 / 性格(IDENTITY 的 Role+Vibe 融合 SOUL 精神内核)。 */
  persona: string;
  /** 专长领域。 */
  expertise: string[];
  /** 核心工作原则(SOUL / AGENTS 里最定义「怎么工作」的信条)。 */
  principles: string[];
  /** 明确不做 / 拒绝的事。 */
  declines: string[];
  /** 来源 workspace 路径,便于溯源(如 `agent-defs/workspaces/aria`)。 */
  sourceRef: string;
}

/**
 * 标准员工档案 — eval-platform 评测的核心对象之一。
 *
 * 预置员工不可删除（`builtin: true`），但每位的字段（除 id / builtin）
 * 都可编辑。客户定制员工允许 `builtin: false` 扩展，但不参与本平台的对外
 * 标准评测 — 评测范围锁在 预置集。
 */
export interface StandardEmployee {
  id: string;
  /** 显示名（如 Aria / Sam / Dex）。 */
  name: string;
  /** Emoji 头像（fallback / 小尺寸 chip 场景仍用）。 */
  avatar: string;
  /**
   * Avatar 图像 URL（优先于 emoji 渲染）。可选，缺省用 emoji。
   */
  avatarUrl?: string;
  /** 职能定位（一句话）。 */
  title: string;

  /* ----- 职责定义（模板 §2） ------------------------------------------- */

  /** 服务对象 — 客户企业里的什么角色 / 部门。 */
  servesAudience: string;
  /** 核心任务（≤ 5 条，每条 "输入到输出"）。 */
  coreTasks: string[];
  /** 任务输入形态。 */
  inputForms: EmployeeInputForm[];
  /** 任务输出形态。 */
  outputForms: EmployeeOutputForm[];
  /** 不在职责范围内的事 / 能力边界 — 用于生成超范围测试样本。 */
  outOfScope: string;
  /** 下游接收方。 */
  downstream: string[];
  /** 典型请求示例(源定义 example_prompts）—— 展示这个员工实际被怎么用。 */
  examplePrompts?: string[];
  /** 可用工具 / 渠道(源定义 mcp_tools 的 channel,如 slack / armada / email）。 */
  toolChannels?: string[];
  /**
   * 用户偏好 / 运行时记忆(源定义 platform_overrides.*.user)—— 已剥离真实
   * Slack ID / 邮箱 / 姓名等个人标识,只保留可复用的行为规则。属运行时个性化,
   * 非通用人设,仅展示。
   */
  userPreferences?: string[];

  /* ----- 装配信息 ------------------------------------------------------- */

  /** 自治等级（高风险岗位如法务 / 财务建议 L1）。 */
  autonomyLevel: AutonomyLevel;
  /** 关联文档（占位，业务方填路径或 URL）。 */
  linkedDocs: {
    sop?: string;
    skillsListPath?: string;
    knowledgeBaseIndex?: string;
    capabilityListEntry?: string;
  };
  /** 关联的 agent profile id（基座 + 连接）— 评测时跑这个 profile。 */
  associatedProfileId?: string;
  /**
   * 归属 provider id —— 该员工原生由哪个 provider 承载(如扩展员工 Dex ↔
   * "gateway")。设了它,「员工↔agent」关联即按 provider 认,不依赖精确命名
   * (避免「Dex / Dex」差一个空格就关联不上)。 Platform 员工共用
   * "platform" provider、彼此靠名字区分,故**不设**此字段,继续走名字匹配。
   */
  homeProviderId?: string;

  /* ----- 评测装备 ------------------------------------------------------- */

  /**
   * 角色专属指标模板，每员工 3-4 项。评测计划基于此填具体目标值。
   * 派生自 agent-defs 仓各员工源定义文档(AGENTS.md / SOUL.md)里明文承诺
   * 的可测行为(阈值 / 红线 / 工作铁律),补通用指标的盲区,不是穷举。
   */
  specificMetricTemplates: EmployeeMetricTemplate[];

  /**
   * 源定义画像 — 取自 agent-defs 仓的 IDENTITY / SOUL / AGENTS 等源文档,
   * 忠实精炼的人设 / 专长 / 原则 / 边界。只读展示,补充被测对象画像。
   */
  sourceProfile?: EmployeeSourceProfile;

  /* ----- 元数据 -------------------------------------------------------- */

  /** 是否为 标准预置员工（不可删除）。 */
  builtin: boolean;
  /** 状态。 */
  status: "active" | "archived";
}

/**
 * The human operating the platform. Captured locally only — no backend.
 * Stored separately from agent profiles to avoid name collision.
 */
export interface UserProfile {
  name: string;
  email?: string;
  role?: string;
  avatarUrl?: string;
}

/** Lightweight evaluator stamp embedded in each Evaluation when present. */
export interface EvaluatorRef {
  name: string;
  email?: string;
  role?: string;
}

