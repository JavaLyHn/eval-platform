import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_CRITERIA,
  DEFAULT_SCORE_DIMENSIONS,
  MOCK_EVALUATIONS,
} from "@/lib/mock-data";
import { shortId } from "@/lib/utils";
import { getProvider, getProfileKind, listProviders } from "@/agents/registry";
import { registerBuiltinProviders } from "@/agents/providers";
import {
  loadProfiles,
  saveProfiles,
  loadActiveProfileId,
  saveActiveProfileId,
} from "@/agents/profiles";
import {
  STORAGE_KEYS,
  loadSlice,
  saveSlice,
  clearAllPlatformData,
} from "@/lib/persistence";
import type { AgentClient, AgentProfile } from "@/agents/types";
import type {
  AgentActivity,
  AgentSkillsResult,
  Annotation,
  Category,
  ChatMessage,
  ConnectionStatus,
  Conversation,
  Evaluation,
  EvaluationMode,
  EvaluationReport,
  EvaluationRun,
  EvaluationRunConfig,
  MetricRow,
  EvaluatorRef,
  EmployeeMetricTemplate,
  EmployeeMetricsOverlay,
  FailureAttribution,
  FailureCategory,
  FloorElement,
  MetricOverride,
  Question,
  QuestionStatus,
  ReportItem,
  ReportJudgeResult,
  RightTab,
  ScoreDimension,
  ScoringCriterion,
  UncertaintySignal,
  UserProfile,
} from "@/types";
import { estimateTokens } from "@/lib/token-estimate";
import { resolveFailureAttribution } from "@/lib/failure-attribution";
import { prefixBeforeMessage } from "@/lib/conversation-fork";
import { questionContentSig } from "@/lib/question-import";
import { downloadBlob } from "@/lib/io";
import {
  applyConversationBundle,
  buildConversationBundle,
  parseConversationBundle,
} from "@/lib/conversation-bundle";
import type { FloorCandidate } from "@/lib/floor-elements";
import { dedupeFloorCandidates } from "@/lib/floor-elements";
import { buildJudgePrompt, parseJudgeOutput } from "@/lib/judge";
import { collectJudgeFileTexts } from "@/lib/judge-attachments";
import {
  getEffectivePromptVersion,
  getPromptOverridesSnapshot,
  mergePromptOverridesFromServer,
  subscribePrompts,
} from "@/lib/prompt-registry";
import {
  buildAdaptiveAnchor,
  buildAdaptiveFollowupPrompt,
  parseAdaptiveFollowup,
  ADAPTIVE_TAG,
  type AdaptiveMode,
} from "@/lib/adaptive-followup";
import {
  buildCriteriaPrompt,
  mergeDraftCriteria,
  mapFloorRefsToIds,
  parseCriteria,
  type DesignNote,
  type GeneratedDraft,
} from "@/lib/question-generator";
import { findDuplicateQuestion } from "@/lib/question-dedup";
import { criteriaForQuestion, questionIsRedLine } from "@/lib/question-type";
import { summarizeToolEvents } from "@/lib/tool-events";
import { answeredTurns, answeredTurnsByTrial } from "@/lib/conversation-turns";
import { aggregateJudgeSnapshots, agreementRateOf, type JudgeSnap } from "@/lib/judge-aggregate";
import {
  partitionForBatchJudgeAcrossConvs,
  upsertBatchJudgeEvaluation,
  groupJudgeUnitsByContext,
} from "@/lib/batch-judge-plan";
import { judgeIsolationLevel } from "@/lib/judge-isolation";
import { runGroundTruthChecks } from "@/lib/ground-truth-check";
import { BUILTIN_CATEGORIES } from "@/types";
import { STANDARD_EMPLOYEES } from "@/lib/standard-employees";
import { GATEWAY_EMPLOYEES } from "@/lib/extended-employees";
import { agentMatchesEmployee, resolveEmployeeForProfile } from "@/lib/employee-resolve";

/**
 * 展示 / 关联解析 / 指标解析用的员工全集 = Platform 锁定 6 位 + Gateway 扩展员工。
 * 评测基线 / 报告 / 出题范围仍单独用常量 `STANDARD_EMPLOYEES`(锁定 6 位不被打乱);
 * 这里只让画廊卡片、关联 Agent、专属指标解析等**展示与解析路径**认识扩展员工。
 */
const DISPLAY_EMPLOYEES = [...STANDARD_EMPLOYEES, ...GATEWAY_EMPLOYEES];
function findDisplayEmployee(id: string) {
  return DISPLAY_EMPLOYEES.find((e) => e.id === id);
}
import {
  EMPTY_OVERLAY,
  resolveEmployeeMetrics,
  dedupeMetricInits,
} from "@/lib/employee-metrics";
import {
  SEED_INDUSTRIES,
  SEED_PROFESSIONS,
  SEED_SCENARIOS,
} from "@/lib/gen-dimensions";
import {
  useMessagesSync,
  useProfilesSync,
  useSettingsSync,
  useSliceSync,
} from "@/lib/use-slice-sync";
import {
  hydrateFromServer,
  mergeById,
  mergeByIdDropping,
  mergeConversationsWithMessages,
  type HydrationResult,
} from "@/lib/hydrate";
import { shouldRefetch, isRefetchStale } from "@/lib/refetch-gate";
import { evaluateReleaseGate } from "@/lib/release-gate";
import { evalScoreFields, passKSummary, passKSummaryByTrial, type PassKSummary } from "@/lib/multi-trial";
import { DEFAULT_K } from "@/lib/floor-report-logic";
import { applyManualMetricValue, computeReportMetrics } from "@/lib/report-metrics";
import type { ReportMetricsInput } from "@/lib/report-metrics";
import type {
  SkillEvalReport,
  SkillReportMeta,
  SkillAuditMark,
  ReleaseGateThresholds,
} from "@/lib/skill-report";
import { upsertAuditMark, withThresholds } from "@/lib/skill-report";
import type { SkillOptDoneFrame } from "@/lib/skillopt-client";
import type { BatchJudgeEntry, LastBatchJudge } from "@/lib/batch-results";
import { isSkillQuestion } from "@/lib/skill-question";
import { nextQuestionNumber, normalizeQuestionNumbers } from "@/lib/question-number";
import { planAutoJudge, type AutoJudgeConfig } from "@/lib/auto-judge";
import { type PendingSend } from "@/lib/pending-send";
import {
  type ConvRun,
  isConvStreaming,
  anyStreaming,
  isConvBusy,
} from "@/lib/conv-run";
import { inlineAttachments, type AttachedFile } from "@/lib/file-input";
import type { PreviewFile } from "@/lib/file-preview";
import { attachmentsToSendPayload } from "@/lib/question-attachments";
import {
  shouldStartJudging,
  deriveRunProgress,
  failedQuestionIdsFromReport,
} from "@/lib/evaluation-run";
import { useAuth } from "./use-auth";
import {
  selectConfiguredEmployeeIds,
  isEmployeeConfigured as isEmployeeConfiguredPure,
  reconcileEmployeeProfileMap,
} from "@/lib/employee-visibility";
import { outbox } from "@/lib/outbox";

registerBuiltinProviders();

export type QuestionDraft = Omit<
  Question,
  "id" | "number" | "createdAt" | "status" | "lastScore"
> & {
  status?: QuestionStatus;
};

/** 首页手动输入自动建的「自由对话」能力题的类别 / 标记;建题与派生识别用同一字串。 */
export const FREE_TALK_TAG = "自由对话";

export type SortField =
  | "created"
  | "difficulty"
  | "lastScore"
  | "number"
  /** Manual / drag-and-drop reorder. Preserves `questions[]` array order as-is. */
  | "manual";
export type SortDirection = "asc" | "desc";

export interface QueueItem {
  questionId: string;
  profileId: string;
  /** 多 trial:本项是第几次试跑(0-based)。 */
  trialIndex?: number;
  /** 多 trial:该题计划试跑总次数(K)。 */
  trialTotal?: number;
  /** 多 trial:派发时强制隔离(空 history + 空 session + 不回写 sid)。 */
  freshSession?: boolean;
  /** 多 trial:固定派发到这个会话(run 会话),不受 active 切换影响。 */
  convId?: string;
  /**
   * 题级上下文隔离 key(不设则 sendQuestion 默认用 q.id)。多 trial 用 `${q.id}#t${t}`:
   * 同 trial 的多轮复用同一 gateway session、history 按 (questionId, trialIndex) 隔离,
   * trial 间因 key 含 #t${t} 而隔离。取代单 prompt 时代的 freshSession。
   */
  contextKey?: string;
}

export interface QueueState {
  running: boolean;
  /** 这批答题跑在哪个 run 会话 —— 完成摘要/打分引导只在该会话展示,切到别的会话不显示。 */
  conversationId?: string;
  pending: QueueItem[];
  current: QueueItem | null;
  completed: QueueItem[];
  errored: QueueItem[];
  total: number;
  /** 「答完即评」:本批答完后自动接的批量评分配置;null = 不自动(默认)。 */
  autoJudge?: AutoJudgeConfig | null;
}

export interface SubEvalDraft {
  scores: ScoreDimension[];
  notes: string;
  verdict: Evaluation["verdict"] | null;
}

/**
 * 单个裁判(judge)对一条回答的完整评判结果。多 LLM 校准时每位裁判一条,
 * 用于「评判过程」展开视图 —— 让用户看见每位裁判各自的判定 / 打分 / 评语,
 * 而不是只看聚合后的分数(黄金准则:读轨迹不可省)。
 */
export interface JudgeSnapshot {
  judgeProfileId: string;
  scores: ScoreDimension[];
  verdict: "passed" | "failed";
  notes: string;
  /** 该裁判的原始输出(可选,提交前可见;提交后的 calibrationSnapshots 不留存)。 */
  raw?: string;
  failureCategory?: FailureCategory;
  uncertaintySignals?: UncertaintySignal[];
  /** 裁判引用的条款编号(1-based,对应 floorCandidates 顺序)。 */
  citedFloorRefs?: number[];
}

interface TurnDispatch {
  /** Conversation that owns this turn pipeline. Stays fixed across user switches. */
  convId: string;
  questionId: string;
  profileId: string;
  prompts: string[]; // remaining turns
  initialTotal: number;
  errored: boolean;
  /** 题级上下文隔离 key:同一会话里按此切分 history + 每题独立 gateway session。 */
  contextKey?: string;
  /** 多 trial:续轮沿用 turn0 的 trial 序号 —— 否则 turns 1..n 会标错标签、history 匹配不到 turn0。 */
  trialIndex?: number;
  /** 多 trial:试跑总数 K。 */
  trialTotal?: number;
}

interface UISlice {
  selectedQuestionId: string | null;
  rightTab: RightTab;
  /** 用户手动隐藏了「本会话题目」面板(全局偏好;空会话本就不显示)。 */
  sessionQuestionsHidden?: boolean;
  /** 自适应追问开关:开 → 右侧多一个「自适应」tab(全局偏好)。 */
  adaptiveEnabled?: boolean;
  /** 右栏折叠偏好(全局)。 */
  rightPanelCollapsed?: boolean;
}

interface QAStoreValue {
  // session
  sessionId: string;
  connectionStatus: ConnectionStatus;
  /** Wipe all locally-persisted platform data and return to initial seed. */
  clearLocalData: () => void;
  /** True if the *currently viewed* conversation is the one being streamed. */
  isStreamingHere: boolean;
  /** Same scope but covering multi-turn pipelines for this conversation. */
  isQuestionInProgressHere: boolean;
  agentActivity: AgentActivity;
  /** UNIX ms when the current activity started; used by UI to show elapsed time. */
  activityStartedAt: number | null;
  /** Latest progress stage reported by the bridge (e.g. "Claude 推理中"). */
  agentStage: string | null;
  // profiles
  profiles: AgentProfile[];
  activeProfileId: string | null;
  activeProfile: AgentProfile | null;
  setActiveProfile: (id: string | null) => void;
  addProfile: (p: AgentProfile) => void;
  updateProfile: (id: string, patch: Partial<AgentProfile>) => void;
  deleteProfile: (id: string) => void;
  pingProfile: (id: string) => Promise<{
    ok: boolean;
    detail?: string;
    latencyMs?: number;
  }>;
  /** User-triggered: ping the active profile and update connectionStatus. */
  connectActive: () => Promise<{
    ok: boolean;
    detail?: string;
    latencyMs?: number;
  }>;
  /**
   * 对指定 profile 做连接测试:更新连接态,ping 成功则置 verified=true(员工卡才显示)。
   * silent=true 时不弹通知。用于「测试」按钮 / 自动验证。
   */
  connectProfile: (
    id: string,
    opts?: { silent?: boolean },
  ) => Promise<{ ok: boolean; detail?: string; latencyMs?: number }>;
  /**
   * 标记某 profile 的下一次自动验证要弹「已连接/连接失败」通知。用户点「添加/保存」后调用,
   * 实际验证由 store 自愈 effect 在 state 更新后执行(避开 stale-closure 竞态)。
   */
  requestVerifyWithNotice: (id: string) => void;
  /**
   * Fetch the skills the active agent declares. Cached per profile config so
   * a Tab switch doesn't re-hit the bridge. Pass `force=true` to refetch.
   */
  listActiveSkills: (force?: boolean) => Promise<AgentSkillsResult>;
  /** Indicates whether the active provider advertises listSkills support. */
  activeSupportsSkills: boolean;
  /** Most recent ping result for the active profile (cleared on profile switch). */
  lastPing: {
    ok: boolean;
    detail?: string;
    latencyMs?: number;
    at: string;
  } | null;
  /** Transient toast notice (success / error / info). */
  notice: {
    id: string;
    kind: "success" | "error" | "info";
    message: string;
    detail?: string;
  } | null;
  showNotice: (n: {
    kind: "success" | "error" | "info";
    message: string;
    detail?: string;
  }) => void;
  dismissNotice: (id: string) => void;
  /** Resolve which profile id to use when sending a question. */
  resolveProfileForQuestion: (q: Question) => string | null;
  // questions
  questions: Question[];
  selectedQuestionId: string | null;
  setSelectedQuestion: (id: string | null) => void;
  addQuestion: (draft: QuestionDraft) => Question;
  updateQuestion: (id: string, patch: Partial<Question>) => void;
  deleteQuestion: (id: string) => void;
  replaceQuestions: (next: Question[]) => void;
  /** Manual reorder (drag-and-drop). Ids not in `nextIds` get appended in their
   *  current relative order so we never lose entries. */
  reorderQuestions: (nextIds: string[]) => void;
  importQuestions: (
    next: Question[],
    mode: "append" | "replace",
  ) => { added: number; skipped: number };
  /** 导出一段会话(题目 + 作答轨迹 + 打分)为自包含 JSON 文件。 */
  exportConversation: (convId: string) => void;
  /** 导入一段会话包(JSON 文本);成功返回 true。 */
  importConversationBundle: (text: string) => boolean;
  /**
   * Full list of category names visible in pickers — built-ins ∪ user-added ∪
   * categories used by any current question, minus those the user has deleted.
   * Recomputed reactively.
   */
  categories: Category[];
  /** Add a new user-defined category; idempotent. */
  addCategory: (name: string) => void;
  /** 出题维度清单（预置 + 自定义合并去重）。 */
  genDimensions: { industries: string[]; professions: string[]; scenarios: string[] };
  /** 往某个轴追加一个自定义取值（已存在则忽略）。 */
  addGenDimension: (
    axis: "industries" | "professions" | "scenarios",
    value: string,
  ) => void;
  /** 删除某个轴的取值（含内置种子,记墓碑,跨刷新持久）。 */
  removeGenDimension: (
    axis: "industries" | "professions" | "scenarios",
    value: string,
  ) => void;
  /** 每员工角色专属指标 overlay(内置不可变,改写/隐藏/新增落这里)。 */
  employeeMetrics: Record<string, EmployeeMetricsOverlay>;
  /** 改写一条内置指标的某些字段。 */
  setMetricOverride: (employeeId: string, key: string, patch: MetricOverride) => void;
  /** 恢复一条内置指标到默认(清掉改写 + 取消隐藏)。 */
  restoreBuiltinMetric: (employeeId: string, key: string) => void;
  /** 隐藏一条内置指标(可恢复)。 */
  hideBuiltinMetric: (employeeId: string, key: string) => void;
  /** 加一条自定义指标,返回新 key。 */
  addCustomMetric: (
    employeeId: string,
    init: Omit<EmployeeMetricTemplate, "key">,
  ) => string;
  /** 改一条自定义指标。 */
  updateCustomMetric: (
    employeeId: string,
    key: string,
    patch: Partial<Omit<EmployeeMetricTemplate, "key">>,
  ) => void;
  /** 删一条自定义指标。 */
  deleteCustomMetric: (employeeId: string, key: string) => void;
  /** 批量导入自定义指标(按 label 去重),返回新建 key。 */
  importCustomMetrics: (
    employeeId: string,
    inits: Array<Omit<EmployeeMetricTemplate, "key">>,
  ) => string[];
  /** 把该员工 overlay 整体清空(恢复全部默认)。 */
  resetEmployeeMetrics: (employeeId: string) => void;
  // user
  user: UserProfile;
  setUser: (patch: Partial<UserProfile>) => void;
  clearUser: () => void;
  /**
   * Default scoring criteria applied to newly-created questions. Editable
   * by the user from the question form. Persisted locally.
   */
  defaultCriteria: ScoringCriterion[];
  setDefaultCriteria: (next: ScoringCriterion[]) => void;
  resetDefaultCriteria: () => void;
  /**
   * Delete a category. Any questions currently in this category get reassigned
   * to a fallback (first remaining category, or "未分类"). Built-ins are
   * hidden via a deny-list rather than removed from the constant.
   */
  deleteCategory: (name: string) => void;
  // selection
  selection: Set<string>;
  toggleSelection: (id: string) => void;
  setSelection: (ids: string[]) => void;
  setSelectionForConv: (convId: string, ids: string[]) => void;
  clearSelection: () => void;
  // bulk queue
  queue: QueueState;
  /** Run each selected question, fanning out per its agentIds (or active profile). */
  runQueue: (
    questionIds: string[],
    opts?: {
      trials?: number;
      autoJudge?: AutoJudgeConfig;
      subjectProfileId?: string;
      /** 跳过已被目标 agent 答过的题(任意会话里有已完成回答)。多 trial 不适用。 */
      skipAnswered?: boolean;
    },
  ) => string | null;
  /** 员工 id → 绑定的 agent profile id(无绑定 → null)。供 UI 估算被测供应商。 */
  agentForEmployee: (employeeId: string) => string | null;
  /** 当前用户已配置 agent 的员工 id 列表(按 standardEmployees 顺序)。 */
  configuredEmployeeIds: string[];
  /** 判断某员工是否已为当前用户配置 agent。 */
  isEmployeeConfigured: (employeeId: string) => boolean;
  stopQueue: () => void;
  /** 从上一个中断点继续:重新跑停止时保留的剩余队列(同一个 run 会话)。无剩余 → null。 */
  resumeQueue: () => string | null;
  /** Clear queue.completed + errored after a run; doesn't affect a running queue. */
  clearQueueResults: () => void;
  // batch LLM judge
  judgeQueue: JudgeQueueState;
  lastBatchJudge: LastBatchJudge | null;
  runBatchJudge: (opts: {
    questionIds: string[];
    judgeProfileIds: string[];
    mode: "skip" | "redo";
    overrideConvId?: string;
  }) => Promise<void>;
  stopBatchJudge: () => void;
  clearBatchJudgeResults: () => void;
  // conversations (claude.ai-style multi-session)
  conversations: Conversation[];
  activeConversationId: string | null;
  /** 正在进行(流式/续发/批量答题)的会话 id;无则 null。侧栏呼吸标志用(向后兼容单值)。 */
  runningConversationId: string | null;
  /** 所有正在跑的会话 id 集合(多会话并行:侧栏呼吸标志逐行判定用)。 */
  runningConversationIds: Set<string>;
  activeConversation: Conversation | null;
  newConversation: () => string;
  /** 「在工作区作答」:开/切到新会话并选中这道题,返回新会话 id。 */
  startQuestionInNewConversation: (questionId: string) => string;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  /** 星标置顶 / 取消置顶。置顶的会话在侧栏聚到最上方「置顶」分组。 */
  togglePinConversation: (id: string) => void;
  // chat (derived from active conversation)
  messages: ChatMessage[];
  isStreaming: boolean;
  /**
   * 从服务器重新拉取并合并(跨设备同步的下行半边)。自动触发:切回前台;
   * 手动触发:侧栏「同步」按钮({ force: true },只跳过节流)。
   */
  refetchFromServer: (opts?: { force?: boolean }) => Promise<void>;
  /** 上次成功拉取的时间戳(ms);null = 本次会话还没成功拉过。 */
  lastSyncedAt: number | null;
  /** boot 水合是否完成:false = 首帧仅 localStorage(可能是服务器数据的子集),
   *  UI 应避免据此显示会「先少后补」的统计数字。finally 里必定置 true(离线也是)。 */
  hydrated: boolean;
  /** 正在拉取中(UI 转圈)。 */
  isRefetching: boolean;
  /**
   * m-3:当前(若有)正在飞的这一发重新拉取是否已经超过挂死阈值(REFETCH_STALE_MS)。
   * isRefetching 只有在世代号匹配时才会被清掉,真挂死时会永久卡 true;UI 用这个字段在
   * 挂死之后重新放开手动「同步」按钮,避免被自己的 loading 态锁死。渲染期现算,不额外起
   * 定时器,只随其它状态触发的重渲染刷新(详见 use-qa-store.tsx 里的取舍说明)。
   */
  refetchTimedOut: boolean;
  isQuestionInProgress: boolean;
  sendQuestion: (q: Question, profileId?: string) => void;
  sendRawPrompt: (
    prompt: string,
    images?: string[],
    files?: AttachedFile[],
    /** 后台自动补发用:指定发到哪条会话 + 用哪个 agent(不传 = 当前 active)。 */
    target?: { convId?: string; profileId?: string },
  ) => void;
  editAndResendMessage: (messageId: string, newContent: string) => void;
  /** 用相同输入(含图片)重新生成:从该用户消息分叉、丢弃其后旧回答后重发。 */
  retryMessage: (messageId: string) => void;
  /** Abort the current in-flight reply and freeze whatever's been streamed. */
  stopGeneration: () => void;
  /** 生成中排队的单槽自由发送(null = 无)。 */
  pendingSend: PendingSend | null;
  /** 忙碌时排队(覆盖旧的)。空闲时调用方应直接走 sendRawPrompt。 */
  queueSend: (prompt: string, images?: string[], files?: AttachedFile[]) => void;
  /** 取消待发送。 */
  cancelPendingSend: () => void;
  /** 手动补发(报错保留后点击);仅该会话空闲时生效。 */
  flushPendingSend: () => void;
  resetSession: () => void;
  clearMessages: () => void;
  // evaluation
  evaluations: Evaluation[];
  scoreDraft: ScoreDimension[];
  setScoreDraft: (s: ScoreDimension[]) => void;
  notesDraft: string;
  setNotesDraft: (s: string) => void;
  attributionDraft: FailureAttribution | null;
  setAttributionDraft: (a: FailureAttribution | null) => void;
  /** 直接改某条评测的归因(人工覆盖 / 清除);null=清除。 */
  setEvaluationAttribution: (evaluationId: string, attribution: FailureAttribution | null) => void;
  annotationsDraft: Annotation[];
  addAnnotation: (a: Omit<Annotation, "id" | "createdAt">) => void;
  removeAnnotation: (id: string) => void;
  subDrafts: SubEvalDraft[];
  updateSubDraft: (subIndex: number, patch: Partial<SubEvalDraft>) => void;
  ensureSubDrafts: (count: number) => void;
  submitEvaluation: (verdict: Evaluation["verdict"]) => void;
  /** 看板抽审「逐条复核」:对任意 (questionId, messageId) 直接落一条人工 Evaluation,
   *  不依赖当前选中题/回答。供发版门抽审弹窗在看板内人工打分用。 */
  recordAuditReview: (
    questionId: string,
    messageId: string,
    input: {
      scores: ScoreDimension[];
      notes: string;
      verdict: "passed" | "failed";
      attribution?: FailureAttribution | null;
    },
  ) => void;
  /** 按 messageId 跨会话取回答正文(抽审弹窗展示用);找不到 → ""。 */
  getMessageAnswer: (messageId: string) => string;
  submitSubEvaluations: () => void;
  /**
   * LLM-as-Judge fan-out: every profile in `judgeProfileIds` scores the latest
   * assistant answer for the active question. Runs sequentially. On completion,
   * the draft is populated with the aggregate (mean scores, majority verdict)
   * and per-judge snapshots are kept for the agreement display + the eventual
   * Evaluation record's `calibrationSnapshots`.
   *
   * Single-element array ≡ legacy single-judge behavior.
   */
  runLLMJudge: (opts: {
    judgeProfileIds: string[];
    subIndex?: number;
  }) => Promise<void>;
  isJudging: boolean;
  judgeError: string | null;
  /**
   * 最近一次 LLM 评判的逐裁判快照(按 messageId 归属),供「评判过程」展开视图。
   * 编辑器据 messageId 判断是否属于当前回答;切走则不显示。提交后改看 Evaluation
   * 的 calibrationSnapshots(持久化)。
   */
  judgeSnapshots: {
    messageId: string;
    snaps: JudgeSnapshot[];
    expected: number;
    /** 发给所有裁判的评测 prompt(多裁判共用同一份)。 */
    prompt: string;
    /** 本次实际使用的 llm-judge prompt 版本(Prompt 管理)。 */
    promptVersion: number;
  } | null;
  /** Which Judge profile pool was used last, so the picker can default to it. */
  lastJudgeProfileIds: string[];
  setLastJudgeProfileIds: (ids: string[]) => void;
  /** Last profile used for AI question generation. */
  lastGeneratorProfileId: string | null;
  setLastGeneratorProfileId: (id: string | null) => void;
  /** Map of standardEmployeeId → agentProfileId. Editable per row. */
  employeeProfileMap: Record<string, string | null>;
  setEmployeeProfile: (employeeId: string, profileId: string | null) => void;
  /**
   * One-shot LLM call against an arbitrary profile. Collects the full
   * streamed output and returns it as a string. Used for utilities like
   * question generation that don't fit the chat/judge flows.
   */
  runOneShot: (
    profileId: string,
    prompt: string,
    opts?: {
      timeoutMs?: number;
      onChunk?: (delta: string) => void;
      /** 外部中断:触发后立即中止在途调用并以「已中止」reject。 */
      signal?: AbortSignal;
    },
  ) => Promise<string>;
  /** 自适应追问(MVP):据 agent 回答生成并发出下一问;可保存到题库(默认困难题)。 */
  generateFollowup: (input: {
    questionId: string;
    goal: string;
    mode: AdaptiveMode;
    maxTurns: number;
    generatorProfileId?: string;
  }) => Promise<{
    action: "asked" | "stopped";
    reason?: string;
    generatorPrompt?: string;
  }>;
  /** 终止自适应追问:中断生成器出题(stage1)+ 停掉被测 agent 正在流式的回答(stage2),让整个追问流程干净结束。 */
  stopFollowup: () => void;
  /** 构造「下一轮追问」会发给 LLM 的 prompt(与 generateFollowup 同源,只构造不发出);供面板实时预览。 */
  buildFollowupPromptPreview: (input: {
    questionId: string;
    goal: string;
    mode: AdaptiveMode;
    maxTurns: number;
  }) => string | null;
  /**
   * 保存到题库:把这段多轮自适应对话存成一道困难题。判据**据整段多轮题面 + 原题考点**
   * 用 B 段判据生成器现写(passForm/failForm/referenceAnswer/judgeFocus 完整),不沿用原单轮题。
   * 异步(跑一次 LLM);补全失败则不入库,返回 {ok:false}。
   */
  freezeAdaptiveAsQuestion: (input: {
    questionId: string;
    generatorProfileId?: string;
  }) => Promise<
    | { ok: true; question: Question; created: boolean }
    | { ok: false; reason: string }
  >;
  /** 把临时题(手动对话自动建的可评分题)就地转正进题库;多轮顺带 B 段补判据。 */
  saveQuestionToLibrary: (
    questionId: string,
  ) => Promise<{ ok: true; question: Question } | { ok: false; reason: string }>;
  /** Persist the question-level evaluation mode and judge pool choice. */
  setQuestionEvaluation: (
    id: string,
    patch: {
      evaluationMode?: EvaluationMode;
      judgeProfileIds?: string[] | null;
    },
  ) => void;
  activeQuestion: Question | null;
  activeMessages: ChatMessage[];
  /** Question the user is currently looking at (library selection). */
  selectedQuestion: Question | null;
  /** Assistant messages in the active conv that target `selectedQuestion`. */
  selectedMessages: ChatMessage[];
  /**
   * Set of question ids that have a completed (non-interrupted, non-streaming)
   * assistant answer in the currently-active conversation. Used by the right
   * panel header to show a conv-scoped "未测" count that refreshes when the
   * user switches conversations.
   */
  testedInActiveConv: Set<string>;
  /** Per-question status scoped to the active conversation (fresh conv → all untested). */
  getQStatusInActiveConv: (qid: string) => QuestionStatus;
  /** Latest weighted score for this question IN THIS CONV (undefined if no eval here). */
  getQLastScoreInActiveConv: (qid: string) => number | undefined;
  /** Map qid → {status, score} for the active conversation. Used by dashboard scope. */
  statsByQInActiveConv: Map<string, { status: QuestionStatus; score?: number }>;
  /** 本会话里「多 trial 题」的 pass^k 摘要(qid → summary)。非多 trial 题不入表。 */
  passKByQInActiveConv: Map<string, PassKSummary>;
  // ----- Standard employees (P0 标准化数据模型) -----
  /** 6 位标准 AI 员工档案（预置 + 客户扩展）。 */
  standardEmployees: typeof STANDARD_EMPLOYEES;

  // ----- Evaluation reports (手动生成的只读快照) -----
  reports: EvaluationReport[];
  /** Compose a fresh ReportItem[] from current evaluations + questions, for
   *  the given agent + optional question-id whitelist. Used by the generate
   *  dialog to preview / commit. */
  composeReportItems: (
    agentProfileId: string,
    questionIds?: string[],
  ) => ReportItem[];
  /** 组装 §6 指标聚合(从全部 evaluation 算,不塌缩到最新)。 */
  composeReportMetrics: (
    agentProfileId: string,
    questionIds?: string[],
    opts?: { targets?: Record<string, number>; employeeId?: string },
  ) => import("@/types").ReportMetrics;
  /** Persist a new report and return its id. */
  addReport: (init: {
    title: string;
    agentProfileId: string;
    agentName: string;
    items: ReportItem[];
    kind?: import("@/types").ReportKind;
    metrics?: import("@/types").ReportMetrics;
    baselineReportId?: string;
    baselineMetrics?: import("@/types").ReportMetrics;
    header?: import("@/types").ReportHeaderMeta;
    targets?: Record<string, number>;
  }) => string;
  deleteReport: (id: string) => void;
  /** 人工采集指标(如满意度)报告生成后手动录入实测值;value=null 恢复「需人工采集」。 */
  setReportManualMetric: (reportId: string, metricKey: string, value: number | null) => void;

  evaluationRuns: EvaluationRun[];
  addEvaluationRun: (init: { subjectProfileId: string; versionLabel: string; config: EvaluationRunConfig; rerunOfRunId?: string; onlyFailedFromRunId?: string }) => string;
  updateEvaluationRun: (id: string, patch: Partial<EvaluationRun>) => void;
  deleteEvaluationRun: (id: string) => void;
  startEvaluationRun: (init: { subjectProfileId: string; versionLabel: string; config: EvaluationRunConfig; rerunOfRunId?: string; onlyFailedFromRunId?: string }) => string;
  cancelEvaluationRun: (runId: string) => void;

  skillReports: SkillEvalReport[];
  addSkillReport: (init: { title: string; meta: SkillReportMeta; frame: SkillOptDoneFrame; logs: string[] }) => string;
  deleteSkillReport: (id: string) => void;
  setSkillReportAudit: (
    reportId: string,
    m: { caseId: string; autoCorrect: boolean; note?: string },
  ) => void;
  setSkillReportThresholds: (reportId: string, t: ReleaseGateThresholds) => void;

  // ----- 保下限要素（FloorElement[]） -----
  floorElements: FloorElement[];
  addFloorElement: (init: Omit<FloorElement, "id" | "createdAt">) => string;
  updateFloorElement: (id: string, patch: Partial<FloorElement>) => void;
  deleteFloorElement: (id: string) => void;
  /** 批量导入种子/草拟候选，返回新建的 id 列表。 */
  importFloorCandidates: (cands: FloorCandidate[]) => string[];
  /** 设置某题验证哪些下限要素（探针挂载）。 */
  setQuestionFloorElements: (questionId: string, elementIds: string[]) => void;
  /** 切换单个题⇄要素的探针关联（用函数式更新，读最新值，避免快照覆盖）。 */
  toggleQuestionFloorElement: (
    questionId: string,
    elementId: string,
    on: boolean,
  ) => void;

  // ui
  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;
  /** 待预览文件(点聊天文件时设置;null=无)。 */
  previewFile: PreviewFile | null;
  /** 点文件在右栏预览(设 previewFile + 切 preview tab + 展开右栏)。 */
  openFilePreview: (file: PreviewFile) => void;
  /** 关闭预览。 */
  closePreview: () => void;
  /** 右栏是否折叠(持久化偏好)。 */
  rightPanelCollapsed: boolean;
  setRightPanelCollapsed: (b: boolean) => void;
  /** 「本会话题目」面板是否被用户手动隐藏。 */
  sessionQuestionsHidden: boolean;
  setSessionQuestionsHidden: (b: boolean) => void;
  /** 自适应追问开关(开 → 右侧多一个「自适应」tab)。 */
  adaptiveEnabled: boolean;
  setAdaptiveEnabled: (b: boolean) => void;
  /** 技能源仓库同步版本号:每次同步 agent-defs 仓 +1。消费仓库数据(如员工技能)的
   *  组件把它放进 effect 依赖,即可在同步后实时刷新、不再用旧缓存。 */
  agentRepoVersion: number;
  bumpAgentRepoVersion: () => void;
  /** 上次同步技能源仓的时刻(ms epoch);从未同步为 null。供「最近一次刷新时间」展示。 */
  agentRepoSyncedAt: number | null;
}

const QAStoreContext = createContext<QAStoreValue | null>(null);

/**
 * 【暂时下线·可恢复】ground-truth 确定性判分总开关。false = 答题完成后不再跑
 * runGroundTruthChecks(skill / agent 探针都回到仅 LLM/人工判分)。置回 true 即恢复。
 */
const GROUND_TRUTH_GRADING_ENABLED: boolean = false;

const GROUND_TRUTH_CHECK_LABEL: Record<string, string> = {
  "lang-match": "语言一致",
  "no-leak": "不泄漏",
  "tool-succeeded": "发得出去",
  "no-placeholder": "无占位符",
};

const DETERMINISTIC_EVALUATOR: EvaluatorRef = {
  name: "确定性 checker",
  role: "deterministic",
};

/** Stable empty selection — used so the derived `selection` keeps reference
 *  equality when the current conversation has no bulk selection, preventing
 *  useMemo/useEffect dep churn in consumers. Treat as immutable. */
const EMPTY_SELECTION: Set<string> = new Set<string>();

const EMPTY_QUEUE: QueueState = {
  running: false,
  pending: [],
  current: null,
  completed: [],
  errored: [],
  total: 0,
  autoJudge: null,
};

/** 批量评分的一个判分单元(逐轮题每轮一个;单轮/多 trial 一题一个)。 */
export interface BatchJudgeUnit {
  /** 唯一键 = 该单元回答的 messageId。 */
  key: string;
  questionId: string;
  /** 逐轮题的轮序(0-based);单轮不设。 */
  subIndex?: number;
  /** 逐轮题该轮的子问题(实时列表区分各轮用)。 */
  subPrompt?: string;
}

interface JudgeQueueState {
  running: boolean;
  /** 这批评分跑在哪个会话 —— 进度/摘要只在该会话展示,切到别的会话不显示。 */
  conversationId: string | null;
  total: number;
  done: number;
  completed: string[]; // 成功落库的 questionId
  errored: { questionId: string; reason: string }[];
  /** 评分计划:每个判分单元(逐轮题按轮展开),供实时列表逐单元显示。 */
  plan?: BatchJudgeUnit[];
  /**
   * 当前正在评的单元 key(= messageId)—— **多个**(并发)。每个在跑的线程占一个,
   * 供实时视图按线程显示 N 行进度。多轮题各轮同一线程顺序评,故 activeKeys 里不会
   * 同时出现同一道多轮题的两轮。
   */
  activeKeys: string[];
  /** 已完成的单元 key。 */
  doneKeys?: string[];
}
/** LLM 批量评分并发度:同时在跑的**作业组**数(一组=一道题/一个 trial 的上下文相连单元)。
 *  多轮题各轮不拆线程(上下文相连);留有余量避免撞供应商限流。 */
const JUDGE_CONCURRENCY = 4;
const EMPTY_JUDGE_QUEUE: JudgeQueueState = {
  running: false,
  conversationId: null,
  total: 0,
  done: 0,
  completed: [],
  errored: [],
  plan: [],
  activeKeys: [],
  doneKeys: [],
};

/** Build the evaluator stamp from current user profile; undefined if no name. */
function makeEvaluatorRef(user: UserProfile): EvaluatorRef | undefined {
  const name = user.name?.trim();
  if (!name) return undefined;
  return {
    name,
    ...(user.email ? { email: user.email } : {}),
    ...(user.role ? { role: user.role } : {}),
  };
}

function makeConversation(
  messages: ChatMessage[] = [],
  title = "新对话",
): Conversation {
  const now = new Date().toISOString();
  return {
    id: shortId("conv"),
    title,
    messages,
    activeQuestionId: null,
    gatewaySessionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Sanitize messages from disk: if a prior session was killed mid-stream, mark
 * those bubbles as failed so the UI doesn't show a stuck typing animation.
 */
function sanitizeMessages(msgs: ChatMessage[]): ChatMessage[] {
  return msgs.map((m) =>
    m.isStreaming
      ? {
          ...m,
          isStreaming: false,
          content:
            m.content +
            (m.content ? "\n\n" : "") +
            "> _(此条消息在刷新前未完成)_",
        }
      : m,
  );
}

/** First non-empty user message → conversation title (truncated). */
function deriveTitle(msgs: ChatMessage[]): string | null {
  for (const m of msgs) {
    if (m.role !== "user") continue;
    const t = m.content.trim().replace(/\s+/g, " ");
    if (!t) continue;
    return t.length > 32 ? t.slice(0, 32) + "…" : t;
  }
  return null;
}

/**
 * 默认选中哪条会话:**最新一条有内容的会话**优先(按 updatedAt 倒序取第一条有消息的);
 * 若全是空会话(如刚建的空「新对话」)则退回最新的那条。返回 null 表示没有会话。
 * —— 这样「之前有会话」时总落在最近真实对话上,不会停在遗留的空「新对话」。
 */
function pickActiveConversationId(convs: Conversation[]): string | null {
  if (convs.length === 0) return null;
  // 按真实时刻倒序。不可用字符串比较:本地 UTC(…Z)与服务端 +08:00 混排会乱序。
  const sorted = [...convs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return (sorted.find((c) => c.messages.length > 0) ?? sorted[0]).id;
}

/**
 * 最多保留**一条**空「新对话」。多出来的删掉(优先保留当前活动的那条,否则保留最新的)。
 * 空「新对话」会在 localStorage 与服务器各自留一份(随机 id),hydrate 合并后两边都留下 →
 * 侧栏出现多条空「新对话」。这里统一收敛;删掉的会话由 useSliceSync 顺带从服务器删除。
 * 返回新数组 + 可能改过的 activeId(若被删的恰是当前活动会话,落到保留的那条)。
 */
function pruneEmptyNewConversations(
  convs: Conversation[],
  activeId: string | null,
): { conversations: Conversation[]; activeId: string | null } {
  const empties = convs.filter(
    (c) => c.messages.length === 0 && c.title === "新对话",
  );
  if (empties.length <= 1) return { conversations: convs, activeId };
  const keep =
    empties.find((c) => c.id === activeId) ??
    [...empties].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  const removeIds = new Set(
    empties.filter((c) => c.id !== keep.id).map((c) => c.id),
  );
  return {
    conversations: convs.filter((c) => !removeIds.has(c.id)),
    activeId: activeId && removeIds.has(activeId) ? keep.id : activeId,
  };
}

/**
 * 该会话是否应同步到后端。两类**只在前端展示、不入库**:
 *   1. 空会话(还没内容,无意义);
 *   2. mock 会话 —— mock provider 只在浏览器回放预置答案,属本地演示,不该落库。
 * 取最近一条带 agentProfileId 的消息判定归属(切 agent 会另开新会话,故单会话单 agent)。
 */
function isSyncableConversation(
  conv: Conversation,
  mockProfileIds: Set<string>,
): boolean {
  if (conv.messages.length === 0) return false;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const aid = conv.messages[i].agentProfileId;
    if (aid) return !mockProfileIds.has(aid);
  }
  return true; // 有消息但都不带 agent(罕见)→ 允许同步
}

/**
 * 是否是「mock 自由对话临时题」——这类题由给 mock 发消息时自动建/更新(transient),
 * 只为前端打分演示,不该入库。用户点「保存到题库」后 transient 变 false → 恢复同步。
 */
function isMockTransientQuestion(q: Question, mockProfileIds: Set<string>): boolean {
  return (
    !!q.transient &&
    Array.isArray(q.agentIds) &&
    q.agentIds.length > 0 &&
    q.agentIds.every((id) => mockProfileIds.has(id))
  );
}

function loadInitialConversations(): {
  conversations: Conversation[];
  activeId: string;
  /**
   * 仅当走「Fresh start」分支(localStorage 全空 → 现造的占位会话)时为该会话 id。
   * 从 localStorage / legacy 恢复的真实数据为 null。hydrate 时用它判定「服务器已有
   * 数据 → 丢掉这个占位,别让它被同步成重复会话」。
   */
  freshPlaceholderId: string | null;
} {
  // Preferred: new versioned conversations array
  const stored = loadSlice<Conversation[]>(STORAGE_KEYS.conversations, []);
  if (stored.length > 0) {
    const sanitized = stored.map((c) => ({
      ...c,
      messages: sanitizeMessages(c.messages),
    }));
    // 启动即收敛:本地若已堆积多条空「新对话」,只留一条(避免首屏就闪多条)。
    const pruned = pruneEmptyNewConversations(
      sanitized,
      pickActiveConversationId(sanitized),
    );
    return {
      conversations: pruned.conversations,
      activeId: pruned.activeId!,
      freshPlaceholderId: null,
    };
  }
  // Legacy single-array messages → wrap in one conversation
  const legacy = loadSlice<ChatMessage[]>(STORAGE_KEYS.messages, []);
  if (legacy.length > 0) {
    const sanitized = sanitizeMessages(legacy);
    const title = deriveTitle(sanitized) ?? "上次对话";
    const conv = makeConversation(sanitized, title);
    return { conversations: [conv], activeId: conv.id, freshPlaceholderId: null };
  }
  // Fresh start —— 空占位会话(空消息 → 走 MessageList 的「开始一段新评测」欢迎态)。
  // 服务器一旦有数据就在 hydrate 时丢弃(不同步)。
  const conv = makeConversation([], "新对话");
  return { conversations: [conv], activeId: conv.id, freshPlaceholderId: conv.id };
}


interface DraftBundle {
  scores: ScoreDimension[];
  notes: string;
  annotations: Annotation[];
  subDrafts: SubEvalDraft[];
  attribution?: FailureAttribution | null;
}

const EMPTY_DRAFT: DraftBundle = {
  scores: DEFAULT_SCORE_DIMENSIONS,
  notes: "",
  annotations: [],
  subDrafts: [],
  attribution: null,
};

/**
 * Fresh draft bundle for a newly-sent question.
 *
 * Multi-sub questions used to support a "per-sub" mode (one evaluation per
 * step); we've unified the model so EVERY question gets a single evaluation
 * once all turns are answered. The `scoringMode` field is now ignored — kept
 * on the type for backwards compat with stored questions only.
 */
function makeInitialDraft(q: Question): DraftBundle {
  return {
    scores: q.criteria.map((c) => ({
      key: c.key,
      label: c.label,
      value: 7,
      max: 10,
    })),
    notes: "",
    annotations: [],
    subDrafts: [],
    attribution: null,
  };
}

export function QAStoreProvider({ children }: { children: ReactNode }) {
  // ----- Profile bootstrap (localStorage → env seed → mock) -----
  const initialProfiles = useMemo(() => {
    // 平台已全面转 platform:不再自动 seed 任何 agent —— 用户去「Agent 管理」添加 Platform 员工。
    // 同时清掉历史上 env seed 出来的遗留 agentcli profile(provider 已移除,留着也跑不了)。
    const cleaned = loadProfiles().filter(
      (p) => p.providerId !== "agentcli-bridge",
    );
    saveProfiles(cleaned); // 落地清洗结果,避免下次再读到 agentcli
    return { profiles: cleaned, freshSeededIds: [] as string[] };
  }, []);
  const [profiles, setProfilesState] = useState<AgentProfile[]>(initialProfiles.profiles);
  const freshSeededProfileIdsRef = useRef<Set<string>>(
    new Set(initialProfiles.freshSeededIds),
  );
  const [activeProfileId, setActiveProfileIdState] = useState<string | null>(
    () => {
      const stored = loadActiveProfileId();
      if (stored && profiles.some((p) => p.id === stored)) return stored;
      return profiles[0]?.id ?? null;
    },
  );

  // Persist profile + active changes.
  useEffect(() => {
    saveProfiles(profiles);
  }, [profiles]);
  useEffect(() => {
    saveActiveProfileId(activeProfileId);
  }, [activeProfileId]);

  // ----- Client cache: one AgentClient per profile, lazily created -----
  const clientCache = useRef(new Map<string, AgentClient>());
  // 已尝试过「自动连接测试(验证)」的 profile id。挂载时对现有 agent 逐个验证;
  // 新建 agent 出现新 id 时自动验证;编辑配置后从此集合删除该 id → 触发重新验证。
  const verifyAttemptedRef = useRef<Set<string>>(new Set());
  // 下一次自动验证需「弹通知」的 profile id —— 用户刚点「添加/保存」,想看到连接成/败结果;
  // 挂载时的批量自动验证不在此集合内 → 静默,避免刷新刷屏。
  const verifyWithNoticeRef = useRef<Set<string>>(new Set());

  const getClient = useCallback(
    (profileId: string): AgentClient | null => {
      const cached = clientCache.current.get(profileId);
      if (cached) return cached;
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return null;
      const provider = getProvider(profile.providerId);
      if (!provider) return null;
      const client = provider.createClient(profile.config);
      clientCache.current.set(profileId, client);
      return client;
    },
    [profiles],
  );

  // Invalidate clients whose config/provider changed.
  const profilesSignature = useMemo(
    () =>
      profiles
        .map((p) => `${p.id}:${p.providerId}:${JSON.stringify(p.config)}`)
        .join("|"),
    [profiles],
  );
  useEffect(() => {
    // Drop all caches when any config changed. Simple but safe.
    clientCache.current.clear();
  }, [profilesSignature]);

  // ----- Session / chat state -----
  const [sessionId] = useState(() => shortId("sess"));
  // 连接状态按 profile(agent)维护,而非全局——连接是 agent 的属性,与会话无关。
  // 这样切换会话、或切回一个已连接过的 agent,都能保持其真实连接态,不会被重置成
  // 「点击连接」。当前展示值由 activeProfileId 派生(见下方 connectionStatus / lastPing)。
  type PingInfo = { ok: boolean; detail?: string; latencyMs?: number; at: string };
  const [connByProfile, setConnByProfile] = useState<Map<string, ConnectionStatus>>(
    () => new Map(),
  );
  const [pingByProfile, setPingByProfile] = useState<Map<string, PingInfo>>(
    () => new Map(),
  );
  const setProfileConn = useCallback(
    (profileId: string, status: ConnectionStatus, ping?: PingInfo | null) => {
      setConnByProfile((prev) => {
        const next = new Map(prev);
        next.set(profileId, status);
        return next;
      });
      // ping 省略 → 只改状态、保留上次探活详情;传 null → 清除;传对象 → 覆盖。
      if (ping !== undefined) {
        setPingByProfile((prev) => {
          const next = new Map(prev);
          if (ping === null) next.delete(profileId);
          else next.set(profileId, ping);
          return next;
        });
      }
    },
    [],
  );
  const connectionStatus: ConnectionStatus = activeProfileId
    ? (connByProfile.get(activeProfileId) ?? "disconnected")
    : "disconnected";
  const lastPing: PingInfo | null = activeProfileId
    ? (pingByProfile.get(activeProfileId) ?? null)
    : null;
  const [notice, setNotice] = useState<{
    id: string;
    kind: "success" | "error" | "info";
    message: string;
    detail?: string;
  } | null>(null);
  const showNotice = useCallback(
    (n: {
      kind: "success" | "error" | "info";
      message: string;
      detail?: string;
    }) => {
      setNotice({ id: shortId("ntc"), ...n });
    },
    [],
  );
  const dismissNotice = useCallback((id: string) => {
    setNotice((cur) => (cur && cur.id === id ? null : cur));
  }, []);
  // ----- 会话级流式运行态(纯内存,绝不持久化 / 不写 outbox / 不写会话对象) -----
  // 多会话并行:只有正在生成的会话在这些 Map 里有条目,流结束即删除。
  // 对外暴露量(agentActivity / isStreaming 等)由「当前查看会话」那条派生。
  const [runsByConv, setRunsByConv] = useState<Map<string, ConvRun>>(
    () => new Map(),
  );
  // 每条会话的多轮续发管线(剩余轮)。key=convId。
  const [pendingTurnsByConv, setPendingTurnsByConv] = useState<
    Map<string, TurnDispatch>
  >(() => new Map());
  // 每条会话生成中排队的自由发送。key=convId。
  const [pendingSendByConv, setPendingSendByConv] = useState<
    Map<string, PendingSend>
  >(() => new Map());
  // 每条会话一个 AbortController(新派发只中断本会话上一路)。
  const abortByConv = useRef<Map<string, AbortController>>(new Map());

  const setConvRun = useCallback(
    (convId: string, patch: Partial<ConvRun> | null) => {
      setRunsByConv((prev) => {
        const next = new Map(prev);
        if (patch === null) next.delete(convId);
        else
          next.set(convId, {
            activity: "thinking",
            startedAt: null,
            stage: null,
            ...prev.get(convId),
            ...patch,
          });
        return next;
      });
    },
    [],
  );
  const setConvPendingTurns = useCallback(
    (convId: string, td: TurnDispatch | null) => {
      setPendingTurnsByConv((prev) => {
        const next = new Map(prev);
        if (td === null) next.delete(convId);
        else next.set(convId, td);
        return next;
      });
    },
    [],
  );
  const setConvPendingSend = useCallback(
    (convId: string, ps: PendingSend | null) => {
      setPendingSendByConv((prev) => {
        const next = new Map(prev);
        if (ps === null) next.delete(convId);
        else next.set(convId, ps);
        return next;
      });
    },
    [],
  );

  // ----- Persisted slices (lazy-load from localStorage) -----
  const [questions, setQuestions] = useState<Question[]>(() => {
    // 新用户(localStorage 无 questions 切片)→ 空题库,不再注入内置示例题。
    const raw = loadSlice<Array<Record<string, unknown>>>(
      STORAGE_KEYS.questions,
      [],
    );
    // Migrate:
    //   (1) legacy { category: string } → { categories: [string] }
    //   (2) legacy { judgeProfileId: string } → { judgeProfileIds: [string] } (R2)
    //   (3) Force-reset criteria to the canonical 3-item set
    //       (准确性 / 专业性 / 语气). Older saved questions still carry
    //       depth/framework rows — we overwrite so every question renders the
    //       same 3 dimensions.
    const migrated = raw.map((q) => {
      const out = { ...q } as unknown as Question & {
        category?: Category;
        judgeProfileId?: string;
      };
      if (!Array.isArray(out.categories)) {
        const legacy = (q as { category?: unknown }).category;
        out.categories =
          typeof legacy === "string" && legacy.trim()
            ? [legacy.trim()]
            : ["营销策略"];
      }
      delete (out as { category?: unknown }).category;
      if (!Array.isArray(out.judgeProfileIds)) {
        const legacy = (q as { judgeProfileId?: unknown }).judgeProfileId;
        out.judgeProfileIds =
          typeof legacy === "string" && legacy ? [legacy] : undefined;
      }
      delete (out as { judgeProfileId?: unknown }).judgeProfileId;
      out.criteria = DEFAULT_CRITERIA.map((c) => ({ ...c }));
      return out as Question;
    });
    // (4) 题号迁移:旧全局 Q- 号 → 分种类 A-/S- 序列(幂等,合规则原样)。
    return normalizeQuestionNumbers(migrated).questions;
  });

  const storedUi = useMemo(
    () =>
      loadSlice<UISlice>(STORAGE_KEYS.ui, {
        // No auto-selection — workspace stays empty until the user explicitly
        // picks a question from /library. Auto-selecting MOCK_QUESTIONS[0]
        // here made the home right-panel render content even when the user
        // hadn't selected anything.
        selectedQuestionId: null,
        rightTab: "library",
        sessionQuestionsHidden: false,
      }),
    [],
  );

  // 按会话隔离的「正在查看题」:键=会话 id。每个会话各看各的题 ——
  // 别的会话跑批量 / 选题不会把右栏内容串到当前会话(会话间彻底隔离)。
  const [selectedQByConv, setSelectedQByConv] = useState<
    Map<string, string | null>
  >(new Map());

  // Per-conversation bulk-selection. Each conv has its own Set so switching
  // chats doesn't bleed "已选 N 道" between unrelated tasks.
  const [selectionByConv, setSelectionByConv] = useState<
    Map<string, Set<string>>
  >(new Map());
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE);
  const [judgeQueue, setJudgeQueue] = useState<JudgeQueueState>(EMPTY_JUDGE_QUEUE);
  const batchAbortRef = useRef<AbortController | null>(null);
  // 题级上下文隔离:`${convId}::${contextKey}` → 该题在该会话里的 gateway sessionId。
  // 让"批量进一个会话"时,题与题之间用各自的 session,互不串上下文(platform 靠 session)。
  const sessionByKeyRef = useRef(new Map<string, string>());
  // 多轮续发 / 排队自由发送已收敛到 pendingTurnsByConv / pendingSendByConv(按会话)。

  // ----- Conversations (claude.ai-style multi-session) -----
  const initialConvs = useMemo(() => loadInitialConversations(), []);
  const [conversations, setConversations] = useState<Conversation[]>(
    initialConvs.conversations,
  );
  const [activeConversationId, setActiveConversationIdState] = useState<
    string | null
  >(initialConvs.activeId);
  // fresh-start 占位会话 id(见 loadInitialConversations);hydrate 丢弃后置 null。
  const freshPlaceholderConvIdRef = useRef<string | null>(
    initialConvs.freshPlaceholderId,
  );

  // Derived: active conversation's messages + activeQuestionId
  const activeConversation = useMemo(
    () =>
      conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  // Derived: bulk-selection for the CURRENT conversation. Stable empty-set
  // reference when nothing is selected so consumers' useMemo deps don't
  // thrash.
  const selection = useMemo(
    () =>
      (activeConversationId &&
        selectionByConv.get(activeConversationId)) ||
      EMPTY_SELECTION,
    [selectionByConv, activeConversationId],
  );
  const messages = activeConversation?.messages ?? [];

  // Derived: 当前会话的「正在查看题」。
  const selectedQuestionId =
    (activeConversationId
      ? selectedQByConv.get(activeConversationId)
      : null) ?? null;
  /** 写入指定会话的「正在查看题」(convId 为空时 no-op)。 */
  const setSelectedQuestionIdFor = useCallback(
    (convId: string | null, id: string | null) => {
      if (!convId) return;
      setSelectedQByConv((prev) => {
        if ((prev.get(convId) ?? null) === id) return prev;
        const next = new Map(prev);
        next.set(convId, id);
        return next;
      });
    },
    [],
  );

  // 首次加载把 UI 对齐到「当前会话」的 effect —— 见下方 agentForEmployee 定义之后
  // (它需要 agentForEmployee / employeeProfileMap 兜底把陈旧 agentProfileId 解析回
  //  员工的当前 profile,而这些定义在本处之后,故 effect 下移到那里)。

  /**
   * Update one conversation by id. Used by stream callbacks that captured
   * the target id at dispatch time — so chunks land in the right conversation
   * even if the user switched to a different one mid-stream.
   */
  const updateConversation = useCallback(
    (
      id: string,
      patch:
        | Partial<Conversation>
        | ((c: Conversation) => Conversation),
    ) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const next =
            typeof patch === "function" ? patch(c) : { ...c, ...patch };
          return { ...next, updatedAt: new Date().toISOString() };
        }),
      );
    },
    [],
  );

  /**
   * Backward-compat wrapper preserving the old `setMessages(updater)` API.
   * Internally rewrites the active conversation's messages.
   */
  const setMessages = useCallback(
    (
      updaterOrValue:
        | ChatMessage[]
        | ((prev: ChatMessage[]) => ChatMessage[]),
    ) => {
      const id = activeConversationId;
      if (!id) return;
      updateConversation(id, (c) => ({
        ...c,
        messages:
          typeof updaterOrValue === "function"
            ? updaterOrValue(c.messages)
            : updaterOrValue,
      }));
    },
    [activeConversationId, updateConversation],
  );

  // isStreaming 不再是全局 state:改为「当前查看会话」的派生(见下 isStreamingHere)。

  const [evaluations, setEvaluations] = useState<Evaluation[]>(() => {
    const raw = loadSlice<Evaluation[]>(STORAGE_KEYS.evaluations, MOCK_EVALUATIONS);
    // Migrate legacy "partial" verdicts → "failed" (strict Pass/Fail).
    return raw.map((e) =>
      (e.verdict as string) === "partial" ? { ...e, verdict: "failed" } : e,
    );
  });
  // Read-only evaluation report snapshots. User-triggered via 数据看板.
  const [reports, setReports] = useState<EvaluationReport[]>(() =>
    loadSlice<EvaluationReport[]>(STORAGE_KEYS.reports, []),
  );
  useEffect(() => {
    saveSlice(STORAGE_KEYS.reports, reports);
  }, [reports]);

  const [evaluationRuns, setEvaluationRuns] = useState<EvaluationRun[]>(() =>
    loadSlice<EvaluationRun[]>(STORAGE_KEYS.evaluationRuns, []),
  );
  useEffect(() => {
    saveSlice(STORAGE_KEYS.evaluationRuns, evaluationRuns);
  }, [evaluationRuns]);

  const [activeEvaluationRunId, setActiveEvaluationRunId] = useState<string | null>(null);
  /** 已派发过判分+报告尾段的 runId,防衔接 effect 重入(状态更新有异步窗口)。 */
  const judgeDispatchedRef = useRef<Set<string>>(new Set());
  /** 已派发过出报告的 runId,防"出报告 effect"重入。 */
  const reportDispatchedRef = useRef<Set<string>>(new Set());

  // 加载时把卡住的 run 标记为 interrupted(刷新会断掉前端编排)。
  useEffect(() => {
    setEvaluationRuns((prev) =>
      prev.map((r) =>
        r.status === "answering" || r.status === "judging" || r.status === "reporting"
          ? { ...r, status: "interrupted" as const, updatedAt: new Date().toISOString() }
          : r,
      ),
    );
    // 仅 mount 跑一次:刷新会断掉前端编排,半截 run 标记为可重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skill 评测报告:localStorage 本地缓存 + PG sync(下方 useSliceSync;logs 不入 PG,后端落库前清空)。
  const [skillReports, setSkillReports] = useState<SkillEvalReport[]>(() =>
    loadSlice<SkillEvalReport[]>(STORAGE_KEYS.skillReports, []),
  );
  useEffect(() => {
    saveSlice(STORAGE_KEYS.skillReports, skillReports);
  }, [skillReports]);

  // 保下限要素清单。本地持久化（live-sync 列入 Phase 4）。
  const [floorElements, setFloorElements] = useState<FloorElement[]>(() =>
    loadSlice<FloorElement[]>(STORAGE_KEYS.floorElements, []),
  );
  useEffect(() => {
    saveSlice(STORAGE_KEYS.floorElements, floorElements);
  }, [floorElements]);

  const [isJudging, setIsJudging] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [lastJudgeProfileIds, setLastJudgeProfileIdsState] = useState<string[]>(
    [],
  );
  const [lastGeneratorProfileId, setLastGeneratorProfileIdState] = useState<
    string | null
  >(() =>
    loadSlice<string | null>(STORAGE_KEYS.lastGeneratorProfileId, null),
  );
  const setLastGeneratorProfileId = useCallback((id: string | null) => {
    setLastGeneratorProfileIdState(id);
    saveSlice(STORAGE_KEYS.lastGeneratorProfileId, id);
  }, []);

  const [lastBatchJudge, setLastBatchJudge] = useState<LastBatchJudge | null>(() => {
    const v = loadSlice<LastBatchJudge | null>(STORAGE_KEYS.lastBatchJudge, null);
    // 升级前的旧指针(无 entries,用平行 questionIds/evaluationIds)结构不兼容,直接丢弃。
    return v && Array.isArray((v as LastBatchJudge).entries) ? v : null;
  });
  useEffect(() => {
    saveSlice(STORAGE_KEYS.lastBatchJudge, lastBatchJudge);
  }, [lastBatchJudge]);

  // Standard-employee → agent-profile mapping. Persisted + synced via outbox.
  const [employeeProfileMap, setEmployeeProfileMapState] = useState<
    Record<string, string | null>
  >(() => loadSlice(STORAGE_KEYS.employeeProfileMap, {}));
  useEffect(() => {
    saveSlice(STORAGE_KEYS.employeeProfileMap, employeeProfileMap);
  }, [employeeProfileMap]);
  const setEmployeeProfile = useCallback(
    (employeeId: string, profileId: string | null) => {
      setEmployeeProfileMapState((prev) => ({
        ...prev,
        [employeeId]: profileId,
      }));
    },
    [],
  );
  /**
   * Per-message judge output cache so submit can persist it.
   *
   * In single-judge mode `snapshots` has one entry; in multi-judge calibration
   * (R2) all N judges' results sit here, and submitEvaluation stamps them onto
   * the Evaluation as `calibrationSnapshots` + `agreementRate`.
   */
  const judgeOutputsRef = useRef<
    Map<
      string,
      {
        snapshots: Array<{
          judgeProfileId: string;
          scores: ScoreDimension[];
          verdict: "passed" | "failed";
          notes: string;
          raw: string;
          failureCategory?: FailureCategory;
          uncertaintySignals?: UncertaintySignal[];
          /** 裁判引用的条款编号(1-based,对应 floorCandidates 顺序)。 */
          citedFloorRefs?: number[];
        }>;
        /** 发给所有裁判的评测 prompt(共用一份),供提交时写入 Evaluation。 */
        prompt?: string;
        /** 本次实际使用的 llm-judge prompt 版本(Prompt 管理)。 */
        promptVersion?: number;
      }
    >
  >(new Map());
  /**
   * 最近一次 LLM 评判的逐裁判结果(反应式),供「评判过程」展开视图实时显示。
   * 按 messageId 归属:切到别的回答时编辑器据此自动隐藏,不会串台。
   * judgeOutputsRef 仍是 submit 落库的来源,这里仅用于展示。
   */
  const [judgeSnapshots, setJudgeSnapshots] = useState<{
    messageId: string;
    snaps: JudgeSnapshot[];
    /** 本轮预计的裁判总数(用于实时显示「已评 1 / N」进度)。 */
    expected: number;
    /** 发给所有裁判的评测 prompt(共用一份)。 */
    prompt: string;
    /** 本次实际使用的 llm-judge prompt 版本(Prompt 管理)。 */
    promptVersion: number;
  } | null>(null);
  const [customCategories, setCustomCategories] = useState<string[]>(() =>
    loadSlice<string[]>(STORAGE_KEYS.customCategories, []),
  );
  const [customGenDims, setCustomGenDims] = useState<{
    industries: string[];
    professions: string[];
    scenarios: string[];
    /** 墓碑:被用户删除的取值(含内置种子)→ merge 时过滤掉,跨刷新持久。 */
    hidden?: { industries: string[]; professions: string[]; scenarios: string[] };
  }>(() =>
    loadSlice(STORAGE_KEYS.genDimensions, {
      industries: [],
      professions: [],
      scenarios: [],
    }),
  );
  const [employeeMetrics, setEmployeeMetrics] = useState<
    Record<string, EmployeeMetricsOverlay>
  >(() => loadSlice(STORAGE_KEYS.employeeMetrics, {}));
  const [hiddenCategories, setHiddenCategories] = useState<string[]>(() =>
    loadSlice<string[]>(STORAGE_KEYS.hiddenCategories, []),
  );
  const [user, setUserState] = useState<UserProfile>(() =>
    loadSlice<UserProfile>(STORAGE_KEYS.user, { name: "" }),
  );

  // 登录:把本地「评估人」资料与当前账号对齐。
  const { me } = useAuth();
  useEffect(() => {
    if (!me) return;
    setUserState((prev) => {
      // 本地资料的 email 与当前登录账号不一致 = 这份资料属于「上一个账号」(换号残留)。
      // 此时按当前账号重置,清掉上个账号残留的姓名/职位/头像 —— 否则会跨账号泄漏
      //(线上 bug:「角色/职位」显示成上个账号的邮箱等脏数据)。role(职位)不从 me 带,
      // me.role 是鉴权角色、非职位,重置为空由用户自填。
      const belongsToOtherAccount = !!prev.email && prev.email !== me.email;
      const next: UserProfile = belongsToOtherAccount
        ? {
            name: me.name || "",
            email: me.email,
            avatarUrl: me.avatarUrl || undefined,
          }
        : {
            ...prev,
            // 同账号 / 本地为空:仅回填空字段,保留用户已填的 name / role / avatar。
            name: prev.name || me.name,
            email: prev.email || me.email,
            avatarUrl: prev.avatarUrl || me.avatarUrl || undefined,
          };
      // 「职位」是自填短标签(QA / PM / 增长),绝不该是邮箱 —— 清掉误入 / 残留的邮箱脏值。
      if (next.role && /\S+@\S+\.\S+/.test(next.role)) {
        next.role = undefined;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, me?.email, me?.avatarUrl]);

  const [defaultCriteria, setDefaultCriteriaState] = useState<ScoringCriterion[]>(
    () => {
      // Canonical keys after the 3-criteria reset (准确性 / 专业性 / 语气).
      // Anything else in localStorage is legacy (e.g. depth/framework from
      // the old 4-item shape) and gets overwritten.
      const canonical = DEFAULT_CRITERIA.map((c) => c.key).sort().join(",");
      const stored = loadSlice<ScoringCriterion[]>(
        STORAGE_KEYS.defaultCriteria,
        DEFAULT_CRITERIA.map((c) => ({ ...c })),
      );
      const storedKeys = [...stored.map((c) => c.key)].sort().join(",");
      return storedKeys === canonical
        ? stored
        : DEFAULT_CRITERIA.map((c) => ({ ...c }));
    },
  );

  // Per-question evaluation drafts (see DraftBundle / EMPTY_DRAFT above).
  // Keyed by question id so switching question/conversation preserves each
  // question's in-progress evaluation. Cleared on successful submit.
  const [draftsByQ, setDraftsByQ] = useState<Map<string, DraftBundle>>(
    () => new Map(),
  );

  /**
   * Mutate (or remove) the draft for one question. Centralized so every
   * draft setter goes through the same code path.
   */
  const patchDraftForQ = useCallback(
    (qid: string | null, patch: Partial<DraftBundle> | null) => {
      if (!qid) return;
      setDraftsByQ((prev) => {
        const next = new Map(prev);
        if (patch === null) {
          next.delete(qid);
          return next;
        }
        const existing = next.get(qid) ?? EMPTY_DRAFT;
        next.set(qid, { ...existing, ...patch });
        return next;
      });
    },
    [],
  );

  // Drafts exposed to the UI are keyed by the SELECTED question (what the
  // user is currently looking at), not by `activeQuestionId` (last-asked in
  // this conv). That way library clicks across questions show each one's
  // own in-progress evaluation.
  const currentDraft = useMemo(() => {
    if (!selectedQuestionId) return EMPTY_DRAFT;
    return draftsByQ.get(selectedQuestionId) ?? EMPTY_DRAFT;
  }, [draftsByQ, selectedQuestionId]);
  const scoreDraft = currentDraft.scores;
  const notesDraft = currentDraft.notes;
  const attributionDraft = currentDraft.attribution ?? null;
  const annotationsDraft = currentDraft.annotations;
  const subDrafts = currentDraft.subDrafts;
  const setScoreDraft = useCallback(
    (s: ScoreDimension[]) => patchDraftForQ(selectedQuestionId, { scores: s }),
    [patchDraftForQ, selectedQuestionId],
  );
  const setNotesDraft = useCallback(
    (s: string) => patchDraftForQ(selectedQuestionId, { notes: s }),
    [patchDraftForQ, selectedQuestionId],
  );
  const setAttributionDraft = useCallback(
    (a: FailureAttribution | null) =>
      patchDraftForQ(selectedQuestionId, { attribution: a }),
    [patchDraftForQ, selectedQuestionId],
  );
  const setAnnotationsDraft = useCallback(
    (a: Annotation[] | ((prev: Annotation[]) => Annotation[])) => {
      if (!selectedQuestionId) return;
      setDraftsByQ((prev) => {
        const next = new Map(prev);
        const existing = next.get(selectedQuestionId) ?? EMPTY_DRAFT;
        const newAnnotations =
          typeof a === "function" ? a(existing.annotations) : a;
        next.set(selectedQuestionId, {
          ...existing,
          annotations: newAnnotations,
        });
        return next;
      });
    },
    [selectedQuestionId],
  );
  // activeQuestionId is derived from active conversation
  const activeQuestionId = activeConversation?.activeQuestionId ?? null;
  const setActiveQuestionId = useCallback(
    (id: string | null) => {
      const convId = activeConversationId;
      if (!convId) return;
      updateConversation(convId, (c) => ({ ...c, activeQuestionId: id }));
    },
    [activeConversationId, updateConversation],
  );

  const [rightTab, setRightTab] = useState<RightTab>(storedUi.rightTab);
  // 待预览文件(会话内瞬态,不持久化):点聊天文件卡/芯片时设置。
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [sessionQuestionsHidden, setSessionQuestionsHidden] = useState<boolean>(
    storedUi.sessionQuestionsHidden ?? false,
  );
  const [adaptiveEnabled, setAdaptiveEnabled] = useState<boolean>(
    storedUi.adaptiveEnabled ?? false,
  );
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState<boolean>(
    storedUi.rightPanelCollapsed ?? false,
  );

  /** 点聊天文件 → 在右栏预览:设待预览 + 切「预览」tab + 强制展开右栏。 */
  const openFilePreview = useCallback((file: PreviewFile) => {
    setPreviewFile(file);
    setRightTab("preview");
    setRightPanelCollapsed(false);
  }, []);

  /** 关闭预览:清待预览;若正停在预览 tab 则回落「题目」。 */
  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setRightTab((t) => (t === "preview" ? "current" : t));
  }, []);
  // 技能源仓库同步版本(纯内存,不持久化):同步成功 +1 → 触发消费组件重取仓库数据。
  // agentRepoSyncedAt 记录上次同步时刻(ms),供「最近一次刷新时间」展示。
  const [agentRepoVersion, setAgentRepoVersion] = useState(0);
  const [agentRepoSyncedAt, setAgentRepoSyncedAt] = useState<number | null>(null);
  const bumpAgentRepoVersion = useCallback(() => {
    setAgentRepoVersion((v) => v + 1);
    setAgentRepoSyncedAt(Date.now());
  }, []);

  const questionsRef = useRef(questions);
  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);
  // runQueue 的「跳过已答」用:读全量会话判某题是否已被目标 agent 答过,避免入依赖。
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  // runQueue 的并发保护用:避免把 queue 整个放进它的依赖。
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  // 流式回调里取「当前正看的会话」用(回调捕获的是派发时的值,会过期)。
  const activeConvIdRef = useRef(activeConversationId);
  useEffect(() => {
    activeConvIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // 自愈:activeConversationId 悬空(指向已不在列表里的会话)→ 立刻落回一条真实会话。
  // 悬空会让聊天窗口空白、切 agent 不新建(cur 找不到)、发出的消息写进不存在的会话而「消失」。
  // 这里把它修回「最新一条有内容的会话」(无则 null,回到欢迎态),从根上消除上述连锁问题。
  useEffect(() => {
    if (
      activeConversationId &&
      !conversations.some((c) => c.id === activeConversationId)
    ) {
      setActiveConversationIdState(pickActiveConversationId(conversations));
    }
  }, [conversations, activeConversationId]);

  // 收敛:任何时刻最多保留一条空「新对话」。多余的(localStorage + 服务器各留一份、
  // hydrate 合并后并存)在此删除;删除经 useSliceSync 顺带从服务器清掉,刷新后不再回来。
  useEffect(() => {
    const { conversations: pruned, activeId: nextActive } =
      pruneEmptyNewConversations(conversations, activeConversationId);
    if (pruned.length !== conversations.length) {
      setConversations(pruned);
      if (nextActive !== activeConversationId)
        setActiveConversationIdState(nextActive);
    }
  }, [conversations, activeConversationId]);

  // ----- Save persisted slices on change -----
  useEffect(() => {
    saveSlice(STORAGE_KEYS.questions, questions);
  }, [questions]);
  useEffect(() => {
    saveSlice(STORAGE_KEYS.evaluations, evaluations);
  }, [evaluations]);
  useEffect(() => {
    saveSlice(STORAGE_KEYS.customCategories, customCategories);
  }, [customCategories]);
  useEffect(() => {
    saveSlice(STORAGE_KEYS.genDimensions, customGenDims);
  }, [customGenDims]);
  useEffect(() => {
    saveSlice(STORAGE_KEYS.employeeMetrics, employeeMetrics);
  }, [employeeMetrics]);
  useEffect(() => {
    saveSlice(STORAGE_KEYS.hiddenCategories, hiddenCategories);
  }, [hiddenCategories]);
  useEffect(() => {
    saveSlice(STORAGE_KEYS.user, user);
  }, [user]);
  useEffect(() => {
    saveSlice(STORAGE_KEYS.defaultCriteria, defaultCriteria);
  }, [defaultCriteria]);
  // 上次落盘时的 runsByConv 引用 —— 用来区分"某 chunk 到达(runsByConv 未变)"与
  // "某流起/止(runsByConv 变了)",避免流式期每 chunk 都 churn localStorage。
  const savedRunsRef = useRef(runsByConv);
  useEffect(() => {
    const runsChanged = savedRunsRef.current !== runsByConv;
    savedRunsRef.current = runsByConv;
    // 有流在飞、且只是某会话 chunk 更新(runsByConv 没变)→ 跳过,避免每 chunk 落盘。
    if (anyStreaming(runsByConv) && !runsChanged) return;
    // 空闲 → 全量落盘(与改前一致);有流在飞但流态刚变化(某流起/止)→ 落一次"剥离在飞
    // streaming 半截消息"的快照:这样某会话流结束时它的已完成轮立即持久化,不必等所有
    // 并发流都结束(否则关标签会丢已完成内容)。剥掉的 in-flight 消息本就不该入库(刷新
    // 无法续流),与原意一致。
    const persistable = anyStreaming(runsByConv)
      ? conversations.map((c) =>
          (c.messages ?? []).some((m) => m.isStreaming)
            ? { ...c, messages: (c.messages ?? []).filter((m) => !m.isStreaming) }
            : c,
        )
      : conversations;
    saveSlice(STORAGE_KEYS.conversations, persistable);
  }, [conversations, runsByConv]);
  useEffect(() => {
    saveSlice<UISlice>(STORAGE_KEYS.ui, {
      selectedQuestionId,
      rightTab,
      sessionQuestionsHidden,
      adaptiveEnabled,
      rightPanelCollapsed,
    });
  }, [selectedQuestionId, rightTab, sessionQuestionsHidden, adaptiveEnabled, rightPanelCollapsed]);

  const [hydrated, setHydrated] = useState(false);

  // hydration 的"应用"半边:boot 与后续重新拉取(refetchFromServer)共用同一条下行路径。
  // opts.boot=false 时**跳过 settings / prompts 的回灌** —— 那两块每次都会产出新对象引用,
  // 重复拉取会变成"每次同步都多一条 settings 写",而它们本身不是跨设备会话同步要解决的问题。
  const applyHydration = useCallback(
    (res: HydrationResult, opts: { boot: boolean }) => {
      if (res.questions) {
        setQuestions((prev) =>
          // 合并后做题号迁移:服务端可能带回旧 Q- 全局号(幂等,合规则原样)。
          normalizeQuestionNumbers(
            mergeById(prev, res.questions as Question[]),
          ).questions,
        );
      }
      if (res.conversations && res.conversations.length > 0) {
        // Server returns conversation metadata; messages come per-conv.
        const enriched = (res.conversations as Conversation[]).map((c) => {
          const fetched = res.messagesByConversation.get(c.id);
          if (fetched && fetched.length > 0) {
            return { ...c, messages: fetched as unknown as ChatMessage[] };
          }
          return c;
        });
        // m-2:不采纳消息数为 0 的服务器会话。空会话本来就不入库(isSyncableConversation
        // 要求 messages.length > 0),所以服务器上出现的空会话行只可能是历史遗留、或这轮
        // 消息拉取失败(上面 hydrate.ts 的 per-conversation fetch catch 掉了错误,只是让
        // 这条会话保留 metadata 端点原有的空 messages)。这两种情况都不该被当成 serverOnly
        // 拉回本机——它不在 syncable 集合里,用户删了它也不会产生服务器 DELETE,下次同步又
        // 会把它拉回来;标题若是「新对话」还会被下面的 prune effect 立刻再删,变成每次切回
        // 前台一轮 setConversations + 落盘 churn。副作用:这轮消息拉取失败的会话这次先不
        // 采纳,等下一轮重新拉取再看——这比拉回一个空壳、然后立刻又要处理它好。
        const enrichedSyncable = enriched.filter((c) => (c.messages?.length ?? 0) > 0);
        // 服务器已有会话 → 丢掉本地 fresh 占位「新对话」,避免它被同步成重复会话。
        // C-1:这个丢弃只能在 boot 时做一次——freshPlaceholderConvIdRef 只在「localStorage
        // 全空的全新浏览器」场景下被赋值,且只在 boot 拿到非空数据时才清空(见下方 if(dropId)
        // 分支)。若 refetchFromServer(boot=false)路径也执行这段:全新浏览器 → 占位会话 p1
        // 落地、ref="p1" → boot 时服务器恰好不通/该账号 0 条会话 → ref 保持 "p1" 不被清空 →
        // 用户这段时间在 p1 里用 Mock(offline)聊了天(mock 不入 outbox,pendingWrites 恒为 0)
        // → 之后服务器有数据了,随便一次 visibilitychange/focus 触发 refetch 时 dropId 仍是
        // "p1",于是本机 p1 被当成「待丢弃的 fresh 占位」过滤掉——但服务器上根本没有 p1,等于
        // 把用户刚产生的一整条会话静默、永久地删掉(persist effect 立刻落盘,不可逆)。所以
        // 非 boot 路径必须把 dropId 当作「没有」,只做合并,绝不触发丢弃。
        const dropId = opts.boot ? freshPlaceholderConvIdRef.current : null;
        setConversations((prev) =>
          mergeConversationsWithMessages(
            prev,
            enrichedSyncable,
            dropId ? new Set([dropId]) : new Set<string>(),
          ),
        );
        if (dropId) {
          // 服务器已有会话 → 落到最新一条(有内容优先),不停在被丢弃的空占位上。
          // 用 enrichedSyncable(已过滤空会话)而不是 enriched——落到的这条本来就该有内容,
          // 用未过滤的列表在"服务器只有空会话"的边缘场景下可能回退到一条空壳。
          const newestId = pickActiveConversationId(enrichedSyncable);
          setActiveConversationIdState((cur) =>
            cur === dropId ? (newestId ?? cur) : cur,
          );
          freshPlaceholderConvIdRef.current = null;
        }
      }
      if (res.evaluations) {
        setEvaluations((prev) =>
          mergeById(prev, res.evaluations as Evaluation[]),
        );
      }
      if (res.reports) {
        setReports((prev) =>
          mergeById(prev, res.reports as EvaluationReport[]),
        );
      }
      if (res.skillReports) {
        setSkillReports((prev) =>
          mergeById(prev, res.skillReports as SkillEvalReport[]),
        );
      }
      if (res.agents && res.agents.length > 0) {
        // 服务器已有 profile → 丢掉本次 env-seed 的默认「Mock (offline)」,
        // 避免它被同步成重复 mock(换设备就多一个的根因)。
        // C-1(同上 dropId 的道理):freshSeededProfileIdsRef 只在 boot 拿到非空 agents 时才
        // 清空,非 boot 路径若也读它,会在「boot 时服务器不通 → ref 未清空 → 之后 refetch」
        // 的时序里把用户正在用的 profile 当成待丢弃的 env-seed,把 activeProfileId 顶到
        // res.agents[0]。所以非 boot 路径视为「没有要丢的」,只合并、不丢弃。
        const dropIds = opts.boot ? freshSeededProfileIdsRef.current : new Set<string>();
        setProfilesState((prev) =>
          mergeByIdDropping(prev, res.agents as AgentProfile[], dropIds),
        );
        if (dropIds.size > 0) {
          const firstServer = (res.agents as AgentProfile[])[0]?.id;
          setActiveProfileIdState((cur) =>
            cur && dropIds.has(cur) ? (firstServer ?? cur) : cur,
          );
          freshSeededProfileIdsRef.current = new Set();
        }
      }
      // M-5:这行之后读的是 applyHydration 首帧闭包捕获的变量——它的 useCallback 依赖数组
      // 是空数组 `[]`(上面已用 eslint-disable 显式声明),这是故意的,为的是让
      // refetchFromServer 引用稳定(它挂在 visibilitychange/focus 监听上,依赖一变监听就要
      // 重新挂载)。所以**不要把 boot-only 之后的段落(prompts / settings 合并)往上挪到这行
      // 之前**——那样会同时踩两个坑:①读到的是首帧闭包里的 stale 值;②非 boot(refetch)
      // 路径也会跑到本该 boot-only 的 settings 回灌 / outbox.enqueue,产生跨用户写风险
      // (与 M-3 的 mountedRef 守卫要防的是同一类问题)。
      if (!opts.boot) return;
      // Prompt 管理:独立 prompts 表(每 key 一行)→ 按「不可变联合」合并进本地
      // (本地没有的版本号补进来,同号/指针本地优先)。
      if (res.prompts) {
        mergePromptOverridesFromServer(
          Object.fromEntries(res.prompts.map((r) => [r.id, r])),
        );
      }
      // Settings: only back-fill when the local key is unset/empty.
      // The settings come back as { key: value } from /v1/settings.
      if (res.settings) {
        // 旧位置(settings 键 prompts.overrides)一次性兼容回灌:迁表前的
        // 历史数据仍能合并进来;新写入只走 prompts 表。
        mergePromptOverridesFromServer(res.settings["prompts.overrides"]);
        // 员工→agent 绑定:后端权威;后端空而本地有 → 迁移一次。
        const { map, migrate } = reconcileEmployeeProfileMap(
          employeeProfileMap,
          res.settings["employee.profileMap"] as
            | Record<string, string | null>
            | null
            | undefined,
        );
        setEmployeeProfileMapState(map);
        if (migrate) {
          outbox.enqueue({
            table: "settings",
            op: "upsert",
            recordId: "employee.profileMap",
            payload: map,
          });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ----- 重新拉取(跨设备同步下行)的 state / ref 声明 -----
  // M-6:这几行(以及本次新增的几个 ref)整体放在 boot useEffect 之前——纯粹是可读性,
  // 零语义变化。放前面之前 boot effect 是靠"回调体要等整个组件函数体跑完、commit 之后
  // 才真正执行"这一点绕开 TDZ 的(声明在下面、但运行在更后面,合法但反直觉);现在声明
  // 挪到使用点之前,读起来更顺。注意:hydratedRef / isStreamingRef 这两个 ref 镜像
  // useEffect 没有一起挪——它们依赖的 hydrated / isStreaming state 各自在别处声明,
  // 这两个镜像 effect 留在原位(boot effect 之后)完全没问题;真要把它们也往前挪到
  // hydrated/isStreaming 的 state 声明之前才会炸 TDZ(依赖数组是渲染期求值的,不是
  // commit 后才求值),所以特意不动它们。
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [isRefetching, setIsRefetching] = useState(false);
  const lastSyncedAtRef = useRef<number | null>(null);
  // I-1:in-flight 标志从布尔量换成「起始时间戳 + 世代号」。src/lib/api.ts 全文没有超时/
  // AbortSignal,手机切后台挂久了、恢复前台时旧 socket 往往已经死了(这正是本功能的主用例)
  // ——fetch 可能长时间不 settle,若只用一个布尔量记「是否在飞」,一旦真挂死就会永久卡 true,
  // 之后每次 visibilitychange/focus/手动点「同步」都在入口被挡、isRefetching 也永久 true
  // (按钮转圈但再也不会好),只能刷新页面自愈。时间戳能在超过 REFETCH_STALE_MS 后判定
  // 「这次大概率挂死了」从而放行新的一次;世代号用来在 finally 里区分「我方才结束的是不是
  // 最新一次」——挂死的旧请求如果后来真的 settle 了,不能让它把新一次正在飞的标志误清掉
  // (那个旧请求照样会调 applyHydration,这是安全的,合并逻辑本身是追加式的,不用额外拦)。
  const refetchStartedAtRef = useRef<number | null>(null);
  const refetchGenRef = useRef(0);
  // M-1:节流基准要用「上次尝试」而不是「上次成功」。lastSyncedAtRef 只在 res.serverUp
  // 为真时才更新,服务器长期不通时它会一直停在很久以前(或 null),shouldRefetch 的 20s
  // 节流就形同虚设——每次切前台都会真的打一发 /health。lastAttemptAtRef 在「通过闸门、
  // 真正开跑」时就记下来,不论这次成不成功;lastSyncedAt(给 UI 显示"N 分钟前"那个)
  // 仍然只在成功时更新,不受影响。
  const lastAttemptAtRef = useRef<number | null>(null);
  // M-3:QAStoreProvider 会真的卸载(登出 / session 过期时 RequireAuth 跳 /login)。
  // in-flight 的 fetch 不会因为组件卸载而被浏览器取消,await 恢复时如果已经卸载就不该再
  // applyHydration / setState。React 18 下现在只是无声的 no-op,谈不上是当前的 bug;
  // 但这行是给将来兜底——万一有人把 settings 段(含 outbox.enqueue)挪到 applyHydration
  // 里 `!opts.boot return` 之前,登出后才 settle 的旧请求就会把上一个用户的数据写进
  // (模块级、跨组件实例共享的)outbox。
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ----- Boot-time hydration from server (Phase 2.5) -----
  // On mount: fetch each table once, merge by id (local-wins) so server data
  // back-fills records this browser doesn't have without trampling offline
  // edits. Sync hooks are paused until hydration resolves so the merge itself
  // doesn't echo back as a flood of upserts.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // m-1(回归修复):boot 这次拉取也要算一次「尝试」,在真正发起请求前就记下来——
        // 呼应下面 refetchFromServer 里 lastAttemptAtRef 的语义(尝试就记,不论成不成功)。
        // 原来只在 res.serverUp 分支里和 lastSyncedAtRef 一起记(甚至干脆不记),于是 boot
        // 成功拉完几秒内用户切走再切回,lastAttemptAtRef 仍是 null,shouldRefetch 的
        // `lastRefetchAt === null` 分支直接放行,把刚拉完的 9 张表 + 逐会话 messages 请求
        // 原样再打一遍,20s 节流形同虚设。boot 本身就是一次真实发生的拉取尝试,在开跑前记
        // 时间戳,才能让 20s 节流对"boot 刚拉完"这个起点也生效。
        lastAttemptAtRef.current = Date.now();
        const res = await hydrateFromServer();
        if (cancelled) return;
        if (res.serverUp) {
          applyHydration(res, { boot: true });
          // 只在 serverUp 时记一次「已同步」,否则服务器没连上也会显示"刚刚同步过"。
          lastSyncedAtRef.current = Date.now();
          setLastSyncedAt(lastSyncedAtRef.current);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- 重新拉取(跨设备同步下行) -----
  // 闸门判定全在 shouldRefetch 里(纯函数,可单测)。这里只负责取当下的实况 + 防重入。
  // hydrated / isStreaming 用 ref 镜像:refetchFromServer 要保持稳定引用(它挂在
  // visibilitychange 监听上,依赖一变就得重挂监听),不能把它们塞进依赖数组。
  const hydratedRef = useRef(false);
  useEffect(() => {
    hydratedRef.current = hydrated;
  }, [hydrated]);
  const isStreamingRef = useRef(false);
  useEffect(() => {
    // 镜像"任一会话在跑"—— refetch 门要"任一在飞就别拉"。
    isStreamingRef.current = anyStreaming(runsByConv);
  }, [runsByConv]);

  const refetchFromServer = useCallback(
    async (opts?: { force?: boolean }) => {
      const now = Date.now();
      const startedAt = refetchStartedAtRef.current;
      // I-1/m-4:挂死判定抽成 refetch-gate.ts 的纯函数 isRefetchStale(可单测,顺带修了
      // 时钟回拨时旧写法会永远判"仍在飞"的问题)。仍在飞且没超过挂死阈值 → 有人正在跑,
      // 直接让路;超过阈值(含回拨)就当作挂死,放行新的一次。
      if (startedAt !== null && !isRefetchStale(startedAt, now)) return;
      const gate = shouldRefetch({
        hydrated: hydratedRef.current,
        visible:
          typeof document === "undefined" || document.visibilityState === "visible",
        streaming: isStreamingRef.current,
        pendingWrites: outbox.size(),
        // M-1:传"上次尝试"而不是"上次成功",服务器不通时节流依然生效。
        lastRefetchAt: lastAttemptAtRef.current,
        now,
        force: opts?.force,
      });
      if (!gate) return;
      const gen = ++refetchGenRef.current;
      refetchStartedAtRef.current = now;
      lastAttemptAtRef.current = now;
      setIsRefetching(true);
      // 复核用:闸门只在起飞前判过一次 pendingWrites===0,但 await 期间(几百毫秒到几秒,
      // 9 张表 + 逐会话 messages 请求)本机完全可能发生新的删除并且已经排空——outbox.size()
      // 这时早就回到 0,测不出"飞行期间发生过删除"这件事。deletesEnqueued() 是只增不减的
      // 计数,起飞前后各取一次快照,不一致就说明发生过删除,见 outbox.ts 里的注释。
      const deletesBeforeFlight = outbox.deletesEnqueued();
      try {
        const res = await hydrateFromServer();
        // M-3:await 期间组件可能已经卸载,卸载后不再落地任何状态变更。
        if (!mountedRef.current) return;
        // 落地前复核:如果飞行期间本机又入队过删除(哪怕已经排空、服务器那边已经真删了),
        // 这份快照里对应的记录仍可能是"删除发生前"的旧状态——采纳会被 mergeConversationsWithMessages
        // 等追加式合并当成 serverOnly 整条拉回来,下一帧 useSliceSync/useMessagesSync 又把它当
        // 新增回推服务器,等于把用户的删除静默撤销、还在服务器上重建。整份丢弃这次响应比"部分
        // 采纳、指望别处再纠错"更安全——丢弃不是失败,只是这份快照已经过期。把 lastAttemptAtRef
        // 清空,让下一次触发(哪怕是几毫秒后的下一帧)能立刻重拉而不被 20s 节流挡住。
        if (outbox.deletesEnqueued() !== deletesBeforeFlight) {
          lastAttemptAtRef.current = null;
          return;
        }
        if (res.serverUp) {
          // applyHydration 是追加式合并,即便这一发是挂死很久才姗姗来迟的旧世代,落地也
          // 无害(不按 gen 把关,故意不受下面的世代号保护)。
          applyHydration(res, { boot: false });
          // m-2:但"同步时间戳"文案不一样——它代表"数据新鲜到什么时候",一份 30s+ 前发出、
          // 世代已经过期的旧响应不能把它刷成"刚刚"(会误导用户以为数据是这一秒才拉的)。
          // 只有世代仍然匹配(=没有更晚的一次已经开始或结束)才更新它。
          if (refetchGenRef.current === gen) {
            lastSyncedAtRef.current = Date.now();
            setLastSyncedAt(lastSyncedAtRef.current);
          }
        }
      } finally {
        // I-1:只有"我方才结束的就是最新一次"才清标志,避免挂死的旧请求晚 settle 时
        // 把新一次正在飞的标志误清掉。
        if (refetchGenRef.current === gen) {
          refetchStartedAtRef.current = null;
          setIsRefetching(false);
        }
      }
    },
    [applyHydration],
  );

  // m-3:isRefetching 只有在"最后结束的就是最新一次"时才会被清掉(见上面 finally 里的世代号
  // 判断)。如果最新一发真的挂死(超过 REFETCH_STALE_MS 还没 settle),isRefetching 会永久
  // 卡 true——侧栏「同步」按钮原本 disabled={isRefetching},于是唯一的手动逃生口也被自己
  // 挡住,只能刷新页面自愈。这里派生一个"当前这次 in-flight 是否已经过了挂死阈值"的布尔,
  // 给 UI 用来在挂死之后重新放开按钮。
  // 取舍:特意不为它加 setInterval 之类的定时器——它就是渲染期用 Date.now() 现算的普通值,
  // 只随"其它状态引发的重渲染"(切换会话、消息流更新、profile 切换……)一起刷新;按钮从
  // "转圈卡死"变回"可点"可能有几百毫秒到几秒的延迟。这个延迟可以接受,换来的是不为一个
  // 小概率边缘态常驻一个轮询定时器。
  const refetchTimedOut = isRefetchStale(refetchStartedAtRef.current, Date.now());

  // 切回前台就拉一次(手机切回 App / 桌面切回标签页)。focus 也挂上:两个窗口
  // 都可见时切换焦点不触发 visibilitychange。
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onMaybeVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refetchFromServer();
    };
    document.addEventListener("visibilitychange", onMaybeVisible);
    window.addEventListener("focus", onMaybeVisible);
    return () => {
      document.removeEventListener("visibilitychange", onMaybeVisible);
      window.removeEventListener("focus", onMaybeVisible);
    };
  }, [refetchFromServer]);

  // ----- Live sync to backend via outbox (Phase 2) -----
  // mock 只在浏览器回放预置答案,属本地演示,**一律不入库**(会话 / 消息 / 自由对话临时题)。
  // 同步前先滤掉,杜绝发条 mock 消息就弹「正在同步 1 条变更到 postgres」。
  const mockProfileIds = useMemo(
    () => new Set(profiles.filter((p) => p.providerId === "mock").map((p) => p.id)),
    [profiles],
  );
  const syncableQuestions = useMemo(
    () => questions.filter((q) => !isMockTransientQuestion(q, mockProfileIds)),
    [questions, mockProfileIds],
  );
  const syncableConversations = useMemo(
    () => conversations.filter((c) => isSyncableConversation(c, mockProfileIds)),
    [conversations, mockProfileIds],
  );
  useSliceSync(syncableQuestions, "questions", { enabled: hydrated });
  useSliceSync(evaluations, "evaluations", { enabled: hydrated });
  useSliceSync(reports, "reports", { enabled: hydrated });
  useSliceSync(skillReports, "skillReports", { enabled: hydrated });
  useProfilesSync(profiles, { enabled: hydrated });
  // Stream-in-progress: don't fire deltas mid-stream; the next steady-state
  // change will flush a coalesced upsert.
  useSliceSync(syncableConversations, "conversations", {
    enabled: hydrated && !anyStreaming(runsByConv),
  });
  useMessagesSync(syncableConversations, {
    enabled: hydrated && !anyStreaming(runsByConv),
  });
  // Prompt 管理(模块级注册表)→ 镜像成 state:变更才换引用,驱动上行落库。
  // 落独立 prompts 表(每 key 一行),与 questions/evaluations 同款 outbox 管道。
  const [promptOverrides, setPromptOverrides] = useState(
    getPromptOverridesSnapshot,
  );
  useEffect(
    () =>
      subscribePrompts(() =>
        setPromptOverrides(getPromptOverridesSnapshot()),
      ),
    [],
  );
  const promptRows = useMemo(
    () =>
      Object.entries(promptOverrides).map(([id, st]) => ({ id, ...st })),
    [promptOverrides],
  );
  useSliceSync(promptRows, "prompts", { enabled: hydrated });
  useSettingsSync(
    {
      "user": user,
      "categories.custom": customCategories,
      "categories.hidden": hiddenCategories,
      "criteria.default": defaultCriteria,
      "judge.lastIds": lastJudgeProfileIds,
      "generator.lastId": lastGeneratorProfileId,
      "agent.activeId": activeProfileId,
      "employee.profileMap": employeeProfileMap,
    },
    { enabled: hydrated },
  );

  const clearLocalData = useCallback(() => {
    clearAllPlatformData();
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  /* ------------------------- Conversation actions ----------------------- */

  // 停/清理某条会话的流:中断它的控制器、删它的 run 条目 / 续发 / 排队。纯内存操作,
  // 不动别的会话。stopActiveStream / deleteConversation / stopQueue 共用。
  const teardownConvStream = useCallback(
    (convId: string) => {
      abortByConv.current.get(convId)?.abort();
      abortByConv.current.delete(convId);
      setConvRun(convId, null);
      setConvPendingTurns(convId, null);
      setConvPendingSend(convId, null); // 停止 = 连本会话待发送一起取消
    },
    [setConvRun, setConvPendingTurns, setConvPendingSend],
  );

  const stopActiveStream = useCallback(() => {
    const target = activeConversationId;
    // 只停「当前查看会话」这一条手动流,不再一刀切停全部。
    if (target) teardownConvStream(target);
    // 批量单槽独立:仅当 active 会话正是「正在跑的批量」的 run 会话时才连带清批量队列;
    // 否则停当前手动会话不该影响别处的批量(也不该误清已完成的批量结果)。
    if (
      target &&
      queueRef.current.running &&
      queueRef.current.conversationId === target
    ) {
      setQueue(EMPTY_QUEUE);
    }
  }, [activeConversationId, teardownConvStream]);

  /**
   * User-initiated stop. Marks the in-flight assistant bubble as halted,
   * then runs the standard teardown (abort fetch, clear pending turns + bulk
   * queue, reset activity state).
   */
  const stopGeneration = useCallback(() => {
    // 「停止生成」只停当前查看的会话(无「停止全部」)。别的会话的后台流继续跑。
    const target = activeConversationId;
    // Resolve the interrupted question deterministically before issuing any
    // state updates: prefer the pending-turns record (multi-turn mid-flight),
    // otherwise read the in-flight assistant bubble in the target conv.
    const targetPending = target ? pendingTurnsByConv.get(target) : undefined;
    let interruptedQuestionId: string | null =
      targetPending?.questionId ?? null;
    if (!interruptedQuestionId && target) {
      const conv = conversations.find((c) => c.id === target);
      const streamingMsg = conv?.messages.find((m) => m.isStreaming);
      interruptedQuestionId = streamingMsg?.questionId ?? null;
    }
    if (target) {
      updateConversation(target, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.isStreaming
            ? {
                ...m,
                isStreaming: false,
                interrupted: true,
                content:
                  m.content +
                  (m.content ? "\n\n" : "") +
                  "> _(已手动停止生成)_",
              }
            : m,
        ),
      }));
    }
    if (interruptedQuestionId) {
      // Revert the question to "untested" — a halted answer doesn't count as
      // tested. The "未测" badge count in the right panel header restores.
      const qid = interruptedQuestionId;
      setQuestions((qs) =>
        qs.map((q) => (q.id === qid ? { ...q, status: "untested" } : q)),
      );
    }
    stopActiveStream();
  }, [
    activeConversationId,
    pendingTurnsByConv,
    conversations,
    updateConversation,
    stopActiveStream,
  ]);

  const newConversation = useCallback(() => {
    // Reuse an existing empty "新对话" if present — repeated clicks should
    // not pile up duplicates.
    const existingEmpty = conversations.find(
      (c) => c.messages.length === 0 && c.title === "新对话",
    );
    if (existingEmpty) {
      // 复用既有空「新对话」时,把它的 updatedAt 顶到最新 —— 否则它可能是埋在
      // Recents 列表深处的一条旧空会话,切过去后左侧看不出任何变化(像没反应)。
      // 冒泡到顶部 + 设为活动,切 agent 时就能看到一条新会话出现在最上面。
      // 注意:用 prev 里的当前版本做基(不是闭包里的陈旧快照),避免把刚收到消息的
      // 会话洗回空白 / 丢消息。
      setConversations((prev) => {
        const cur = prev.find((c) => c.id === existingEmpty.id);
        if (!cur) return prev; // 已不在列表(被删/被合并丢弃)→ 不复活
        return [
          { ...cur, updatedAt: new Date().toISOString() },
          ...prev.filter((c) => c.id !== existingEmpty.id),
        ];
      });
      if (existingEmpty.id !== activeConversationId) {
        // Switch only — do NOT abort any in-flight stream. It belongs to its
        // own conversation and must keep running there.
        setActiveConversationIdState(existingEmpty.id);
      }
      return existingEmpty.id;
    }
    // Create a fresh conv and switch focus. Again: no abort.
    const conv = makeConversation([], "新对话");
    setConversations((prev) => [conv, ...prev]);
    setActiveConversationIdState(conv.id);
    return conv.id;
  }, [conversations, activeConversationId]);

  /**
   * 「在工作区作答」:开/切到一个新会话并把这道题选进去。用 newConversation 返回的新 id
   * 直接写 selectedQuestionId(不走 setSelectedQuestion —— 它依赖 activeConversationId 闭包,
   * 刚切会话时是旧值,会写到旧会话上)。返回新会话 id。
   */
  const startQuestionInNewConversation = useCallback(
    (questionId: string): string => {
      const id = newConversation();
      setSelectedQuestionIdFor(id, questionId);
      return id;
    },
    [newConversation, setSelectedQuestionIdFor],
  );

  const switchConversation = useCallback(
    (id: string) => {
      if (id === activeConversationId) return;
      // DO NOT abort any in-flight stream — it belongs to its original
      // conversation and will keep writing there. The user can come back any
      // time and see the live state.
      setActiveConversationIdState(id);
      // 把活动 agent 切回该会话所属的 agent —— 会话不直接存 agentProfileId,
      // 取最近一条带 agentProfileId 的消息推断。这样切到 Aria 的会话,头部就显示
      // Aria、新消息也发给 Aria,而不是停在上一个 agent(Sam)。
      // 必须用原始 setter:setActiveProfile 在 agent 变化时会新建会话,会把刚切过去的
      // 会话又跳走。
      const conv = conversations.find((c) => c.id === id);
      if (conv) {
        let convAgentId: string | undefined;
        for (let i = conv.messages.length - 1; i >= 0; i--) {
          const pid = conv.messages[i].agentProfileId;
          if (pid) {
            convAgentId = pid;
            break;
          }
        }
        if (convAgentId && profiles.some((p) => p.id === convAgentId)) {
          setActiveProfileIdState(convAgentId);
        }
      }
      // selectedQuestionId is a global, user-driven choice — switching
      // conversations must NOT auto-restore the new conv's old
      // activeQuestionId. Otherwise an empty workspace gets polluted by an
      // unrelated question the user didn't just pick. The previously-active
      // question (if any) stays in place; user picks a new one via /library.
    },
    [activeConversationId, conversations, profiles],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      // 无条件清理这条会话的流/续发/排队/控制器:不止流式中,轮间空档(有 pendingTurns)
      // 或报错保留(held pendingSend、run 已删)时删会话也要清,否则残留 pendingTurns 会
      // 向已删除的幽灵会话派发下一轮。teardownConvStream 对不存在的键都是 no-op,安全。
      teardownConvStream(id);
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (id === activeConversationId) {
          const fallback =
            [...next].sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
            )[0] ?? null;
          if (fallback) {
            setActiveConversationIdState(fallback.id);
            return next;
          }
          // No conversations left — seed an empty one
          const fresh = makeConversation([], "新对话");
          setActiveConversationIdState(fresh.id);
          return [fresh];
        }
        return next;
      });
      // Drop the deleted conv's selection slot so we don't leak orphan state.
      setSelectionByConv((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    },
    [activeConversationId, teardownConvStream],
  );

  const renameConversation = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim() || "未命名";
      updateConversation(id, (c) => ({ ...c, title: trimmed }));
    },
    [updateConversation],
  );

  const togglePinConversation = useCallback((id: string) => {
    // 故意不走 updateConversation(它会 bump updatedAt):置顶是纯偏好切换,
    // 若 bump,「取消置顶」会把会话顶到 Recents 最上(updatedAt=now),很反直觉。
    // 生成新对象即可让 useSliceSync 按引用差异上行同步(pinned 随 data 走)。
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
    );
  }, []);

  // ----- 对外派生:全部从「当前查看会话」那条 run 切出来(签名不变) -----
  // 绝大多数 UI(顶栏活动 / 气泡占位 / composer 忙碌态)本就读"当前会话在不在忙",
  // 因此改成 active 会话口径后无需改动;内部判定一律用按会话函数,不用这几个派生量。
  const activeRun = activeConversationId
    ? runsByConv.get(activeConversationId)
    : undefined;
  const agentActivity: AgentActivity = activeRun?.activity ?? "idle";
  const activityStartedAt: number | null = activeRun?.startedAt ?? null;
  const agentStage: string | null = activeRun?.stage ?? null;

  // Conversation-scoped flags: only true when the currently-viewed conversation
  // is the one being streamed. Used by UI so a stream running in conversation
  // A doesn't leak its activity badge / stop button into conversation B.
  const isStreamingHere = isConvStreaming(runsByConv, activeConversationId);
  const isQuestionInProgressHere =
    isStreamingHere ||
    (activeConversationId != null &&
      pendingTurnsByConv.has(activeConversationId));

  // 对外的 isStreaming / isQuestionInProgress 改成 active 会话口径:只有正看的这条会话
  // 在忙才禁用它的编辑/重试等。内部并行判定不用它们,一律走按会话函数。
  const isStreaming = isStreamingHere;
  const isQuestionInProgress = isQuestionInProgressHere;

  // 所有正在跑的会话 id(侧栏呼吸标志逐行判定 / 停止判定用)。
  const runningConversationIds: Set<string> = useMemo(
    () => new Set(runsByConv.keys()),
    [runsByConv],
  );
  // 向后兼容单值(侧栏迁移到 runningConversationIds 前仍在用):优先 active,
  // 否则任取一条在跑的会话;都没有则看批量运行会话。
  const runningConversationId: string | null =
    activeConversationId && runsByConv.has(activeConversationId)
      ? activeConversationId
      : (runsByConv.keys().next().value ??
        (queue.running ? (queue.conversationId ?? null) : null));

  // 当前查看会话的排队自由发送(供 message-list 待发送气泡用)。
  const pendingSend: PendingSend | null = activeConversationId
    ? (pendingSendByConv.get(activeConversationId) ?? null)
    : null;

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  /* ------------------------- Profile CRUD ------------------------------- */

  const setActiveProfile = useCallback(
    (id: string | null) => {
      // 切到「不同」的被测 agent:仅当**当前会话已有消息**时才开新会话(避免把上一个
      // agent 的对话续到新 agent 上);当前会话是空的就直接切,不新建。
      if (id && id !== activeProfileId) {
        const cur = conversations.find((c) => c.id === activeConversationId);
        if (cur && cur.messages.length > 0) {
          newConversation(); // 复用已有空「新对话」/ 否则新建,不堆积
        }
      }
      setActiveProfileIdState(id);
    },
    [activeProfileId, activeConversationId, conversations, newConversation],
  );

  const addProfile = useCallback((p: AgentProfile) => {
    setProfilesState((prev) => [...prev, p]);
  }, []);

  const updateProfile = useCallback(
    (id: string, patch: Partial<AgentProfile>) => {
      setProfilesState((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
      );
      clientCache.current.delete(id);
      // 配置可能变了 → 允许自动验证 effect 重新对它做连接测试(见下方 verify effect)。
      verifyAttemptedRef.current.delete(id);
    },
    [],
  );

  // 标记某 profile 的「下一次自动验证」要弹通知。用户点「添加 / 保存」后调用 ——
  // 由 store 的自愈验证 effect 在 state 更新后执行那次连接测试(避开 stale-closure 竞态),
  // 并据此标记决定弹「已连接 / 连接失败」通知。
  const requestVerifyWithNotice = useCallback((id: string) => {
    verifyWithNoticeRef.current.add(id);
  }, []);

  // 只改 verified 标记(连接测试结果),不动 config,也不清 client 缓存 / 重验标记 ——
  // 避免与自动验证 effect 互相触发成环。带 guard:值没变就不写 state。
  const setProfileVerified = useCallback((id: string, verified: boolean) => {
    setProfilesState((prev) =>
      prev.map((p) =>
        p.id === id && (p.verified ?? false) !== verified ? { ...p, verified } : p,
      ),
    );
  }, []);

  const deleteProfile = useCallback(
    (id: string) => {
      setProfilesState((prev) => prev.filter((p) => p.id !== id));
      clientCache.current.delete(id);
      verifyAttemptedRef.current.delete(id);
      verifyWithNoticeRef.current.delete(id);
      // 清理指向被删 profile 的员工绑定 —— 否则残留的死 id 会短路 agentForEmployee
      // (显式绑定优先),导致「删了再加同名 agent、连接也成功却仍不显示」。删除键(而非置 null)
      // 让员工回到「未绑定」,由名字匹配 + 自动关联重新接管新加的 agent。
      setEmployeeProfileMapState((prev) => {
        let changed = false;
        const next: Record<string, string | null> = {};
        for (const [empId, pid] of Object.entries(prev)) {
          if (pid === id) {
            changed = true;
            continue;
          }
          next[empId] = pid;
        }
        return changed ? next : prev;
      });
      setActiveProfileIdState((prev) => {
        if (prev !== id) return prev;
        const remaining = profiles.filter((p) => p.id !== id);
        return remaining[0]?.id ?? null;
      });
    },
    [profiles],
  );

  const pingProfile = useCallback(
    async (id: string) => {
      const client = getClient(id);
      if (!client) return { ok: false, detail: "profile not found" };
      if (!client.ping) return { ok: true, detail: "(provider has no ping)" };
      // 8s timeout —防止 SYN 被防火墙静默丢弃时一直卡住。
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      try {
        return await client.ping(ac.signal);
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") {
          return { ok: false, detail: "请求超时（8s）— 多半是防火墙/网络不通" };
        }
        return { ok: false, detail: err.message };
      } finally {
        clearTimeout(timer);
      }
    },
    [getClient],
  );

  // 对任意 profile 做连接测试并更新其连接态。ping 成功 = 该配置「验证通过」
  // (verified=true 持久化)→ 对应员工卡才显示、并可被自动关联。
  // silent=true 时不弹通知(挂载批量自动验证 / 手动「测试」按钮用)。
  const connectProfile = useCallback(
    async (
      profileId: string,
      opts?: { silent?: boolean },
    ): Promise<{ ok: boolean; detail?: string; latencyMs?: number }> => {
      setProfileConn(profileId, "connecting");
      const res = await pingProfile(profileId);
      setProfileConn(profileId, res.ok ? "connected" : "disconnected", {
        ...res,
        at: new Date().toISOString(),
      });
      // 只在成功时置 verified=true(里程碑,持久化);失败不翻回 false ——
      // 避免刷新/瞬时网络抖动把「曾验证通过」的员工卡藏掉。重置只发生在「编辑配置」时。
      if (res.ok) setProfileVerified(profileId, true);
      if (!opts?.silent) {
        const profile = profiles.find((p) => p.id === profileId);
        const profileName = profile?.name ?? "Agent";
        const targetUrl =
          typeof profile?.config?.baseUrl === "string"
            ? (profile.config.baseUrl as string)
            : null;
        if (res.ok) {
          showNotice({
            kind: "success",
            message: `已连接到 ${profileName}`,
            detail: [
              targetUrl,
              res.latencyMs != null ? `延迟 ${res.latencyMs}ms` : null,
              res.detail,
            ]
              .filter(Boolean)
              .join(" · "),
          });
        } else {
          showNotice({
            kind: "error",
            message: `连接 ${profileName} 失败`,
            detail: [targetUrl, res.detail ?? "未知错误"]
              .filter(Boolean)
              .join(" · "),
          });
        }
      }
      return res;
    },
    [pingProfile, setProfileConn, setProfileVerified, profiles, showNotice],
  );

  const connectActive = useCallback(async () => {
    if (!activeProfileId) {
      const res = { ok: false, detail: "请先在 Agent 列表中选择一个配置" };
      // 无 active profile → 派生的 connectionStatus 已是 disconnected,无处可键 ping,
      // 直接用通知告知即可。
      showNotice({
        kind: "error",
        message: "未选择 Agent",
        detail: res.detail,
      });
      return res;
    }
    return connectProfile(activeProfileId);
  }, [activeProfileId, connectProfile, showNotice]);

  // 不再在 activeProfileId 变化时重置连接状态:连接按 profile 维护,从未探活过的
  // agent 自然派生为 disconnected,已连接的 agent 切回来仍显示「已连接」。

  // 连接态是内存态(刷新即清空),且 verified 需在连接测试通过后才置。
  // 统一「自动验证」effect:对每个「尚未尝试过验证」的 agent profile 静默做一次连接测试。
  //   - 挂载:逐个验证现有 agent(顺带迁移旧数据 —— 能连上的自动补 verified,不用手动重测);
  //   - 新建:出现新 id → 自动验证;
  //   - 编辑:updateProfile 已把该 id 从 verifyAttemptedRef 删除 → 此处重新验证。
  // effect 在 profiles state 更新后才运行,connectProfile 读到的是最新 profiles,
  // 因此新建 agent 后不会因 stale-closure 找不到 client(避开同步调用的竞态)。
  useEffect(() => {
    const agentProfiles = profiles.filter(
      (p) => getProfileKind(p.providerId) === "agent",
    );
    for (const p of agentProfiles) {
      if (verifyAttemptedRef.current.has(p.id)) continue;
      verifyAttemptedRef.current.add(p.id);
      // 用户刚「添加/保存」触发的验证 → 弹通知(便于失败时去编辑);挂载批量验证 → 静默。
      // Set.delete 返回是否命中,顺手取标记 + 清除。
      const withNotice = verifyWithNoticeRef.current.delete(p.id);
      void connectProfile(p.id, { silent: !withNotice });
    }
  }, [profiles, connectProfile]);

  // ----- Skills inventory ---------------------------------------------------
  // Per-profile cache so switching tabs doesn't re-hit the bridge. Cleared
  // implicitly when the underlying client cache is reset (profile config edit).
  const skillsCacheRef = useRef<Map<string, AgentSkillsResult>>(new Map());
  useEffect(() => {
    // Drop the skills cache whenever profile configs change — same trigger
    // we use for the client cache, so the data stays consistent.
    skillsCacheRef.current.clear();
  }, [profilesSignature]);

  const activeSupportsSkills = useMemo<boolean>(() => {
    if (!activeProfileId) return false;
    const client = clientCache.current.get(activeProfileId) ?? getClient(activeProfileId);
    return typeof client?.listSkills === "function";
  }, [activeProfileId, getClient]);

  const listActiveSkills = useCallback(
    async (force = false): Promise<AgentSkillsResult> => {
      if (!activeProfileId) {
        return { skills: [] };
      }
      if (!force) {
        const cached = skillsCacheRef.current.get(activeProfileId);
        if (cached) return cached;
      }
      const client = getClient(activeProfileId);
      if (!client?.listSkills) {
        return { skills: [] };
      }
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10_000);
      try {
        const res = await client.listSkills(ac.signal);
        skillsCacheRef.current.set(activeProfileId, res);
        return res;
      } finally {
        clearTimeout(timer);
      }
    },
    [activeProfileId, getClient],
  );

  /**
   * 题目指定的员工 → 绑定的 agent profile id(employeeProfileMap 优先,回退员工
   * 自带的 associatedProfileId);未绑定 → null。
   */
  const agentForEmployee = useCallback(
    (employeeId: string): string | null => {
      // 1) 显式绑定(「员工」tab onLink)优先,其次员工自带 associatedProfileId。
      const explicit =
        employeeProfileMap[employeeId] ??
        findDisplayEmployee(employeeId)?.associatedProfileId ??
        null;
      // 显式绑定指向的 profile 仍存在才采用;指向已删除的 profile → 忽略,回退名字匹配
      // (自愈陈旧绑定:避免「删了 agent 后残留死绑定短路,导致重加同名 agent 仍不显示」)。
      if (explicit && profiles.some((p) => p.id === explicit)) return explicit;
      // 2) 没有显式绑定 → 按「员工名」回退匹配一个 agent-kind profile(复用
      //    agentMatchesEmployee,与反查 resolveEmployeeForProfile 的名字口径一致)。
      //    这样用户在左上把 active 切到名字对得上的 agent(如名为「Aria」的连接),
      //    其专属题的判定也随之切换、可直接作答,无需再去「员工」tab 手动绑定。
      //    显式绑定仍优先,Sam 仍答不了 Aria 的专属题(门依旧有效)。
      const emp = findDisplayEmployee(employeeId);
      if (!emp) return null;
      const matches = profiles.filter(
        (p) =>
          getProfileKind(p.providerId) === "agent" &&
          agentMatchesEmployee(p, emp),
      );
      // 名字兜底:同名多个 agent 时优先选「已验证」的那个,避免选到未验证的导致漏显示。
      const match = matches.find((p) => p.verified) ?? matches[0];
      return match?.id ?? null;
    },
    [employeeProfileMap, profiles],
  );

  // 首次加载把 UI 对齐到「当前会话」(挪到 agentForEmployee 之后:兜底解析陈旧 id 需要它)。
  // 数据到位后各自同步一次:
  //   ① 恢复「正在看的题」(activeQuestionId → selectedQuestionId),否则首屏右侧「题目」
  //      面板被死锁挡住(唯一能自动选题的 effect 在 QuestionPanel 内部,面板不挂载就跑不到)。
  //   ② 把顶部 agent 对齐到会话所属 agent(取最近一条带 agentProfileId 的消息)。
  // 两层防护:
  //   竞态:会话/消息/profiles 线上是挂载**之后**才从服务端 hydrate(换用户清本地→首屏空);
  //     故依赖会话/profiles、数据到位后再跑,ref 保证成功对齐一次后不重跑(不改切换行为)。
  //   陈旧 id:消息里的 agentProfileId 可能指向已删/换 id 的旧 profile(底部靠 employeeProfileMap
  //     仍显示 Aria,顶部按 id 查不到 → 「未配置」)。查不到就兜底:pid→员工→agentForEmployee
  //     取该员工当前存在的 profile(优先 verified),与底部 resolveEmployeeForProfile 口径一致。
  const didAlignInitialRef = useRef(false);
  useEffect(() => {
    if (didAlignInitialRef.current) return;
    const convId = activeConversationId;
    const conv = activeConversation;
    if (!convId || !conv) return; // 会话还没 hydrate 回来 → 先不锁,等它到位再跑
    // ① 正在看的题(有会话即可恢复,不依赖 profiles;幂等)
    const qid = conv.activeQuestionId ?? null;
    if (qid && !selectedQByConv.get(convId)) {
      setSelectedQuestionIdFor(convId, qid);
    }
    // ② 顶部 agent 对齐会话:取最近一条带 agentProfileId 的消息
    let pid: string | null = null;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].agentProfileId) {
        pid = conv.messages[i].agentProfileId ?? null;
        break;
      }
    }
    if (!pid) {
      // 会话没有带 agent 的消息 → 无可对齐;仅当会话确已有消息(非未加载)才收工。
      if (conv.messages.length > 0) didAlignInitialRef.current = true;
      return;
    }
    // 直接命中:该 profile 仍存在 → 用之;否则陈旧 id → 解析回员工取其当前 profile。
    let resolvedId: string | null = profiles.some((p) => p.id === pid) ? pid : null;
    if (!resolvedId) {
      const emp = resolveEmployeeForProfile(pid, profiles, DISPLAY_EMPLOYEES, employeeProfileMap);
      resolvedId = emp ? agentForEmployee(emp.id) : null;
    }
    if (resolvedId) {
      setActiveProfileIdState(resolvedId);
      didAlignInitialRef.current = true; // 成功对齐,收工
    }
    // 仍解析不出(profile 还没 hydrate 回来)→ 不锁 ref,等下次 profiles 变化重试。
  }, [
    activeConversationId,
    activeConversation,
    profiles,
    employeeProfileMap,
    agentForEmployee,
    selectedQByConv,
    setSelectedQuestionIdFor,
  ]);

  // 派生:当前用户拥有 **且连接测试已通过(verified)** 的 agent profile id 集合。
  // 「已配置员工」以此为准 —— 仅存在(填了名字保存)不算,必须验证通过。
  const verifiedProfileIds = useMemo(
    () => new Set(profiles.filter((p) => p.verified).map((p) => p.id)),
    [profiles],
  );
  // 已配置 agent 的员工 id 列表(按 standardEmployees 顺序)。
  const configuredEmployeeIds = useMemo(
    () =>
      selectConfiguredEmployeeIds(DISPLAY_EMPLOYEES, agentForEmployee, verifiedProfileIds),
    [agentForEmployee, verifiedProfileIds],
  );
  // 判断某员工是否已为当前用户配置(且验证通过)agent。
  const isEmployeeConfigured = useCallback(
    (employeeId: string) =>
      isEmployeeConfiguredPure(employeeId, agentForEmployee, verifiedProfileIds),
    [agentForEmployee, verifiedProfileIds],
  );

  /**
   * 反查:某 agent profile 对应哪个标准员工(显式绑定优先,回退员工自带
   * associatedProfileId);找不到 → null。用于"从对话存题"时把答题员工填进 targetEmployeeId。
   */
  const employeeForProfile = useCallback(
    (profileId: string | null | undefined): string | null => {
      if (!profileId) return null;
      for (const [empId, pid] of Object.entries(employeeProfileMap)) {
        if (pid === profileId) return empId;
      }
      return (
        DISPLAY_EMPLOYEES.find((e) => e.associatedProfileId === profileId)?.id ??
        null
      );
    },
    [employeeProfileMap],
  );

  const resolveProfileForQuestion = useCallback(
    (q: Question): string | null => {
      // 专属题:指定了具体员工(非「全体」)→ 只能由该员工绑定的 agent 作答,
      // 不会回退到当前激活的别的 agent(否则 Aria 会答 Sam 的题)。
      if (q.targetEmployeeId && q.targetEmployeeId !== "_all_") {
        return agentForEmployee(q.targetEmployeeId);
      }
      // 全体 / 未指定 → 当前激活的 agent;回退到第一个 agent。
      // 只有 agent-kind 才是被测对象 —— LLM 是裁判 / 工具,从不被测。
      const agentIds = new Set(
        profiles
          .filter((p) => getProfileKind(p.providerId) === "agent")
          .map((p) => p.id),
      );
      if (activeProfileId && agentIds.has(activeProfileId))
        return activeProfileId;
      return [...agentIds][0] ?? null;
    },
    [profiles, activeProfileId, agentForEmployee],
  );

  /* ------------------------- Question CRUD ------------------------------ */

  const setSelectedQuestion = useCallback(
    (id: string | null) => {
      setSelectedQuestionIdFor(activeConversationId, id);
      if (id) setRightTab("current");
    },
    [activeConversationId, setSelectedQuestionIdFor],
  );

  const updateQuestionStatus = useCallback(
    (id: string, status: QuestionStatus, score?: number) => {
      setQuestions((qs) =>
        qs.map((q) =>
          q.id === id ? { ...q, status, lastScore: score ?? q.lastScore } : q,
        ),
      );
    },
    [],
  );

  const addQuestion = useCallback((draft: QuestionDraft) => {
    let created!: Question;
    setQuestions((prev) => {
      // 去重:内容(kind+归属+prompt+subPrompts)相同的题已在库 → 不重复入库,
      // 返回已存在的那道(多次「固化为困难题」/重复出题不再堆重复)。
      const dup = findDuplicateQuestion(prev, draft);
      if (dup) {
        created = dup;
        return prev;
      }
      const q: Question = {
        ...draft,
        id: shortId("q"),
        // 题号按种类分序列:Agent 题 A-、Skill 题 S-,各自递增。
        // 临时题(free-chat 未入库)不占库序列 → 无库号(避免题库显示空号)。
        number: draft.transient ? "" : nextQuestionNumber(prev, draft.kind),
        status: draft.status ?? "untested",
        createdAt: new Date().toISOString(),
      };
      created = q;
      return [q, ...prev];
    });
    return created;
  }, []);

  const updateQuestion = useCallback(
    (id: string, patch: Partial<Question>) => {
      setQuestions((prev) =>
        prev.map((q) => (q.id === id ? { ...q, ...patch, id: q.id } : q)),
      );
    },
    [],
  );

  const setQuestionEvaluation = useCallback(
    (
      id: string,
      patch: {
        evaluationMode?: EvaluationMode;
        /**
         * Replace this question's judge pool. `null` clears the override (falls
         * back to the conv-level default). Empty array = no judges configured.
         */
        judgeProfileIds?: string[] | null;
      },
    ) => {
      setQuestions((prev) =>
        prev.map((q) => {
          if (q.id !== id) return q;
          const next: Question = { ...q };
          if (patch.evaluationMode !== undefined) {
            next.evaluationMode = patch.evaluationMode;
          }
          if (patch.judgeProfileIds !== undefined) {
            next.judgeProfileIds = patch.judgeProfileIds ?? undefined;
          }
          return next;
        }),
      );
    },
    [],
  );

  const setLastJudgeProfileIds = useCallback((ids: string[]) => {
    setLastJudgeProfileIdsState(ids);
  }, []);

  const deleteQuestion = useCallback((id: string) => {
    // 删除后按顺序密集重排题号(回填空号:删中间题,后面序号自动前移)。
    setQuestions((prev) => normalizeQuestionNumbers(prev.filter((q) => q.id !== id)).questions);
    // Drop this id from every conv's selection slot (it's gone everywhere).
    setSelectionByConv((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [convId, sel] of next) {
        if (sel.has(id)) {
          const s = new Set(sel);
          s.delete(id);
          next.set(convId, s);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // 各会话里若正查看这道题,也一并清掉(题已不存在)。
    setSelectedQByConv((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [convId, qid] of next) {
        if (qid === id) {
          next.set(convId, null);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const replaceQuestions = useCallback((next: Question[]) => {
    setQuestions(next);
    // Wholesale replace nukes per-conv selections too.
    setSelectionByConv(new Map());
    setSelectedQByConv(new Map());
  }, []);

  const reorderQuestions = useCallback((nextIds: string[]) => {
    setQuestions((prev) => {
      const byId = new Map(prev.map((q) => [q.id, q]));
      const ordered: Question[] = [];
      for (const id of nextIds) {
        const q = byId.get(id);
        if (q) {
          ordered.push(q);
          byId.delete(id);
        }
      }
      // Anything not mentioned (or new) keeps its tail position.
      for (const q of prev) {
        if (byId.has(q.id)) ordered.push(q);
      }
      // 题号随新顺序密集重排(确保「按顺序存储」)。
      return normalizeQuestionNumbers(ordered).questions;
    });
  }, []);

  const importQuestions = useCallback(
    (next: Question[], mode: "append" | "replace") => {
      if (mode === "replace") {
        replaceQuestions(next);
        return { added: next.length, skipped: 0 };
      }
      let added = 0;
      let skipped = 0;
      setQuestions((prev) => {
        const existingIds = new Set(prev.map((q) => q.id));
        const existingNums = new Set(prev.map((q) => q.number));
        // 内容指纹兜底:即便 id 换新、number 随机导致 id/number 判不出,内容一致者也跳过
        // (「导入过就不再导入」;与 buildImportPreview 共用同一判据)。
        const existingSigs = new Set(prev.map((q) => questionContentSig(q)));
        const merged = [...prev];
        for (const q of next) {
          const sig = questionContentSig(q);
          if (
            existingIds.has(q.id) ||
            existingNums.has(q.number) ||
            existingSigs.has(sig)
          ) {
            skipped++;
            continue;
          }
          merged.unshift(q);
          existingIds.add(q.id);
          existingNums.add(q.number);
          existingSigs.add(sig);
          added++;
        }
        return merged;
      });
      return { added, skipped };
    },
    [replaceQuestions],
  );

  /* ---------------------- 单段会话导出 / 导入 --------------------------- */

  /** 导出一段会话为自包含 JSON(题目 + 作答轨迹 + 打分,附件内联)。 */
  const exportConversation = useCallback(
    (convId: string) => {
      const conv = conversations.find((c) => c.id === convId);
      if (!conv) {
        showNotice({ kind: "error", message: "未找到该对话,无法导出" });
        return;
      }
      const bundle = buildConversationBundle(
        conv,
        questions,
        evaluations,
        new Date().toISOString(),
      );
      const slug =
        (conv.title || "会话")
          .replace(/[\\/:*?"<>|]+/g, "_")
          .replace(/\s+/g, "_")
          .slice(0, 40) || "会话";
      downloadBlob(
        `会话-${slug}-${conv.id.slice(-6)}.json`,
        JSON.stringify(bundle, null, 2),
        "application/json",
      );
      showNotice({
        kind: "success",
        message: "已导出会话",
        detail: `${bundle.questions.length} 题 · ${bundle.evaluations.length} 条评测`,
      });
    },
    [conversations, questions, evaluations, showNotice],
  );

  /**
   * 导入一段会话包:题目按内容指纹去重复用,会话/消息/评测一律分配全新 id 保证隔离。
   * 导入后切到该会话。返回是否成功,便于 UI 判断。
   */
  const importConversationBundle = useCallback(
    (text: string): boolean => {
      const parsed = parseConversationBundle(text);
      if (!parsed.ok) {
        showNotice({ kind: "error", message: "导入失败", detail: parsed.error });
        return false;
      }
      const result = applyConversationBundle(
        parsed.bundle,
        { questions, evaluations },
        {
          newId: (p) => shortId(p),
          now: new Date().toISOString(),
          // 跨环境导入:把消息/评测的 agentProfileId 重锚定到本机同一员工的 profile,
          // 否则源端(如线上)profile id 在本机不存在 → 头像 / 数据看板认不出这条会话。
          // DISPLAY_EMPLOYEES 含 Gateway 员工(Dex),模块常量、无需入 deps。
          employees: DISPLAY_EMPLOYEES,
          employeeProfileMap,
        },
      );
      setQuestions(result.questions);
      setConversations((prev) => [result.conversation, ...prev]);
      setEvaluations((prev) => [...result.evaluations, ...prev]);
      switchConversation(result.conversation.id);
      showNotice({
        kind: "success",
        message: "已导入会话",
        detail: `新增 ${result.addedQuestions} 题 · 复用 ${result.reusedQuestions} 题 · ${result.evaluationCount} 条评测`,
      });
      return true;
    },
    [
      questions,
      evaluations,
      employeeProfileMap,
      setQuestions,
      setConversations,
      setEvaluations,
      switchConversation,
      showNotice,
    ],
  );

  /* ------------------------- Categories --------------------------------- */

  const categories = useMemo<Category[]>(() => {
    const hidden = new Set(hiddenCategories);
    const seen = new Set<string>();
    const out: Category[] = [];
    const push = (c: string) => {
      const t = c.trim();
      if (!t || seen.has(t) || hidden.has(t)) return;
      seen.add(t);
      out.push(t);
    };
    for (const c of BUILTIN_CATEGORIES) push(c);
    for (const c of customCategories) push(c);
    for (const q of questions) {
      const cats = Array.isArray(q.categories) ? q.categories : [];
      for (const c of cats) push(c);
    }
    return out;
  }, [customCategories, hiddenCategories, questions]);

  const addCategory = useCallback((name: string) => {
    const t = name.trim();
    if (!t) return;
    setCustomCategories((prev) => (prev.includes(t) ? prev : [...prev, t]));
    // If a previously-deleted category is re-added, un-hide it.
    setHiddenCategories((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : prev,
    );
  }, []);

  const genDimensions = useMemo(() => {
    const hidden = customGenDims.hidden ?? { industries: [], professions: [], scenarios: [] };
    const merge = (seed: readonly string[], custom: string[], hide: string[]) => {
      const skip = new Set(hide);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const v of [...seed, ...custom]) {
        const t = v.trim();
        if (t && !seen.has(t) && !skip.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
      return out;
    };
    return {
      industries: merge(SEED_INDUSTRIES, customGenDims.industries, hidden.industries),
      professions: merge(SEED_PROFESSIONS, customGenDims.professions, hidden.professions),
      scenarios: merge(SEED_SCENARIOS, customGenDims.scenarios, hidden.scenarios),
    };
  }, [customGenDims]);

  const addGenDimension = useCallback(
    (axis: "industries" | "professions" | "scenarios", value: string) => {
      const t = value.trim();
      if (!t) return;
      setCustomGenDims((prev) => {
        // 重新加入已删除的取值 → 同时从墓碑移除(复活)。
        const hidden = prev.hidden ?? { industries: [], professions: [], scenarios: [] };
        const nextHidden = hidden[axis].includes(t)
          ? { ...hidden, [axis]: hidden[axis].filter((v) => v !== t) }
          : hidden;
        const isSeed = (
          axis === "industries" ? SEED_INDUSTRIES
          : axis === "professions" ? SEED_PROFESSIONS
          : SEED_SCENARIOS
        ).includes(t as never);
        // 已是种子 / 已在自定义里 → 不重复加自定义,但墓碑仍要移除。
        const nextCustom = prev[axis].includes(t) || isSeed ? prev[axis] : [...prev[axis], t];
        return { ...prev, [axis]: nextCustom, hidden: nextHidden };
      });
    },
    [],
  );

  /** 删除一个维度取值(含内置种子):从自定义移除 + 记墓碑,跨刷新持久。 */
  const removeGenDimension = useCallback(
    (axis: "industries" | "professions" | "scenarios", value: string) => {
      const t = value.trim();
      if (!t) return;
      setCustomGenDims((prev) => {
        const hidden = prev.hidden ?? { industries: [], professions: [], scenarios: [] };
        return {
          ...prev,
          [axis]: prev[axis].filter((v) => v !== t),
          hidden: hidden[axis].includes(t)
            ? hidden
            : { ...hidden, [axis]: [...hidden[axis], t] },
        };
      });
    },
    [],
  );

  /* ------------------------- Evaluation reports ------------------------- */

  /**
   * Compose ReportItem[] from the in-memory evaluations + questions:
   *
   *   - filter evaluations by `agentProfileId`
   *   - optionally restrict to a question-id whitelist
   *   - dedupe per question, keep the most recent submission
   *   - snapshot the question's title / prompt at the current moment
   *
   * Each evaluation's question must still exist; missing ones are dropped.
   */
  const composeReportItems = useCallback(
    (agentProfileId: string, questionIds?: string[]): ReportItem[] => {
      const whitelist = questionIds ? new Set(questionIds) : null;
      // 1) Filter relevant evaluations.
      const matching = evaluations.filter((e) => {
        if (e.agentProfileId !== agentProfileId) return false;
        if (whitelist && !whitelist.has(e.questionId)) return false;
        return true;
      });
      // 2) 按 questionId 分组(保留全部,后面分"逐轮 vs 单次"处理)。
      const groups = new Map<string, Evaluation[]>();
      for (const ev of matching) {
        const arr = groups.get(ev.questionId) ?? [];
        arr.push(ev);
        groups.set(ev.questionId, arr);
      }

      // ---- 复用的小工具 ----
      const answerOf = (messageId: string): string => {
        for (const conv of conversations) {
          for (const m of conv.messages ?? []) {
            if (m.id === messageId) return m.content;
          }
        }
        return "";
      };
      const messageOf = (messageId: string): ChatMessage | undefined => {
        for (const conv of conversations) {
          for (const m of conv.messages ?? []) {
            if (m.id === messageId) return m;
          }
        }
        return undefined;
      };
      const judgeName = (jid?: string) =>
        (jid && profiles.find((p) => p.id === jid)?.name) || jid || "未知模型";
      const newer = (a: Evaluation, b: Evaluation) =>
        new Date(a.submittedAt).getTime() > new Date(b.submittedAt).getTime();

      // 3) Build items。困难题逐轮 → 同题各轮收拢成一条(带 subResults + 整题汇总)。
      const items: ReportItem[] = [];
      for (const [qid, evs] of groups) {
        const q = questions.find((qq) => qq.id === qid);
        if (!q) continue;
        const weightedOf = (dims: ScoreDimension[]): number | undefined =>
          dims.length
            ? Number(
                dims
                  .reduce((sum, s) => {
                    const w =
                      q.criteria.find((c) => c.key === s.key)?.weight ??
                      1 / dims.length;
                    return sum + s.value * w;
                  }, 0)
                  .toFixed(2),
              )
            : undefined;
        const judgesOf = (ev: Evaluation): ReportJudgeResult[] | undefined => {
          if (ev.calibrationSnapshots && ev.calibrationSnapshots.length > 0) {
            // 多裁判校准:每位裁判各自的维度分(逐裁判展开明细,别再塌缩成均值)。
            return ev.calibrationSnapshots.map((s) => ({
              name: judgeName(s.judgeProfileId),
              kind: "llm" as const,
              verdict: s.verdict,
              score: weightedOf(s.scores),
              scores: s.scores,
              notes: s.notes,
            }));
          }
          if (ev.judgeProfileId) {
            return [{ name: judgeName(ev.judgeProfileId), kind: "llm", verdict: ev.verdict, score: ev.autoScore, scores: ev.scores, notes: ev.notes }];
          }
          if (ev.evaluator?.name) {
            return [{ name: ev.evaluator.name, kind: "human", verdict: ev.verdict, score: ev.autoScore, scores: ev.scores, notes: ev.notes }];
          }
          return undefined;
        };
        // 同一回答可能既有 LLM 判(judgeProfileId / calibrationSnapshots)又有人工复核
        // (evaluator,无 judgeProfileId)—— 两者是并存的独立评测。各判源各取最新一条、
        // 合并成 judges,别只取「最新那一条」(否则晚提交的人工判会把 LLM 判整个盖掉)。
        const collectJudges = (list: Evaluation[]): ReportJudgeResult[] | undefined => {
          const out: ReportJudgeResult[] = [];
          const llm = list.filter(
            (e) => e.judgeProfileId || (e.calibrationSnapshots?.length ?? 0) > 0,
          );
          if (llm.length) {
            const j = judgesOf(llm.reduce((a, b) => (newer(b, a) ? b : a)));
            if (j) out.push(...j);
          }
          const human = list.filter(
            (e) =>
              !e.judgeProfileId &&
              !(e.calibrationSnapshots?.length) &&
              e.evaluator?.name &&
              e.evaluator.role !== "deterministic",
          );
          if (human.length) {
            const j = judgesOf(human.reduce((a, b) => (newer(b, a) ? b : a)));
            if (j) out.push(...j);
          }
          return out.length ? out : undefined;
        };

        const subEvals = evs.filter((e) => typeof e.subIndex === "number");

        // —— 单-prompt 多 trial 试跑:同题 K 次(每次一条带 trialIndex 的评测,无 subIndex)。
        // 多 trial 只测通过率/稳定性 → 报告展 pass^k + 逐次通过/失败,不展维度分(设计上
        // trial 评测已把 scores 置空)。多步题的多 trial(带 subIndex)仍走下面逐轮分支。
        const trialEvals = evs.filter((e) => e.trialIndex != null);
        if (trialEvals.length > 0 && subEvals.length === 0) {
          // 每个 trialIndex 取最新一条。
          const latestByTrial = new Map<number, Evaluation>();
          for (const e of trialEvals) {
            const ti = e.trialIndex as number;
            const cur = latestByTrial.get(ti);
            if (!cur || newer(e, cur)) latestByTrial.set(ti, e);
          }
          const trialList = [...latestByTrial.values()].sort(
            (a, b) => (a.trialIndex ?? 0) - (b.trialIndex ?? 0),
          );
          // k = 计划试跑数(消息 trialTotal 最大值);取不到回退实际条数(不虚报未跑满)。
          const kPlanned = Math.max(
            trialList.length,
            ...trialList.map((e) => messageOf(e.messageId)?.trialTotal ?? 0),
          );
          const summary = passKSummary(
            trialList.map((e) => ({ verdict: e.verdict })),
            kPlanned,
          );
          const trialResults = trialList.map((e) => ({
            trialIndex: e.trialIndex as number,
            answer: answerOf(e.messageId),
            verdict: e.verdict === "passed" ? ("passed" as const) : ("failed" as const),
            notes: e.notes,
            judges:
              collectJudges(trialEvals.filter((x) => x.messageId === e.messageId)) ??
              judgesOf(e),
            agreementRate: e.agreementRate,
            judgePromptVersion: e.judgePromptVersion,
          }));
          const latest = trialList.reduce((a, b) => (newer(b, a) ? b : a));
          items.push({
            questionId: q.id,
            questionTitle: q.title,
            questionPrompt: q.prompt,
            // 顶层回答给第一次(报告展开里逐次都在);无回答则空。
            answer: trialResults[0]?.answer ?? "",
            ...(q.attachments && q.attachments.length > 0
              ? { attachments: q.attachments }
              : {}),
            // 整题结论 = pass^k(保下限:跑满 k 且每次都过才算通过)。
            verdict: summary.passPowerK ? "passed" : "failed",
            // 多 trial 不打分 → 顶层无 autoScore、维度空。
            scores: [],
            notes:
              trialList.find((e) => e.verdict === "failed")?.notes ?? trialList[0]?.notes,
            submittedAt: latest.submittedAt,
            failureAttribution: trialList.find((e) => e.failureAttribution)
              ?.failureAttribution,
            judgePromptVersion: latest.judgePromptVersion,
            trials: trialResults,
            passK: {
              trials: summary.trials,
              passed: summary.passed,
              k: summary.k,
              passPowerK: summary.passPowerK,
              status: summary.status,
            },
          });
          continue;
        }

        if (subEvals.length > 0) {
          // —— 困难题逐轮:每个 subIndex 取最新一条 ——
          const latestBySub = new Map<number, Evaluation>();
          for (const e of subEvals) {
            const k = e.subIndex as number;
            const cur = latestBySub.get(k);
            if (!cur || newer(e, cur)) latestBySub.set(k, e);
          }
          const subs = [...latestBySub.values()].sort(
            (a, b) => (a.subIndex ?? 0) - (b.subIndex ?? 0),
          );
          const turns = answeredTurns(
            conversations.flatMap((c) => c.messages ?? []),
            qid,
          );
          const subResults = subs.map((e) => {
            // 用 eval 实际判的那条回答(messageId)定位它所在的回合 —— userPrompt + answer
            // 同源同轮。多 trial 折叠时避免「用第 0 次的提问配最新一次的回答」的错配;
            // 定位不到再回退按位置取提问 / 直查回答。
            const turn = turns.find((t) => t.assistant.id === e.messageId);
            return {
            subIndex: e.subIndex as number,
            userPrompt: turn?.userPrompt ?? turns[e.subIndex as number]?.userPrompt ?? "",
            answer: turn?.assistant.content ?? answerOf(e.messageId),
            verdict: e.verdict === "passed" ? ("passed" as const) : ("failed" as const),
            autoScore: e.autoScore,
            scores: e.scores,
            notes: e.notes,
            // 本轮的所有判源(LLM + 人工)一并收进 judges,同上。
            judges:
              collectJudges(
                subEvals.filter(
                  (x) => x.subIndex === e.subIndex && x.messageId === e.messageId,
                ),
              ) ?? judgesOf(e),
            agreementRate: e.agreementRate,
            judgePromptVersion: e.judgePromptVersion,
            };
          });
          // 多步题的多 trial:subEvals 带 trialIndex(单-trial 多轮不设 trialIndex)。
          // 每个 trial = 一整轮多步运行,全轮通过才算该 trial 过 → 跨 trial 做 pass^k
          // (口径同看板 statsByQInActiveConv:passKSummaryByTrial + turnsPerTrial)。
          const multiTrialSubs = subEvals.filter((e) => e.trialIndex != null);
          let passK: ReportItem["passK"] | undefined;
          if (multiTrialSubs.length > 0) {
            // 去重到每 messageId 最新一条(redo 追加取最新),再按 trial 归约。
            const latestByMsg = new Map<string, Evaluation>();
            for (const e of multiTrialSubs) {
              const cur = latestByMsg.get(e.messageId);
              if (!cur || newer(e, cur)) latestByMsg.set(e.messageId, e);
            }
            const kPlanned = Math.max(
              1,
              ...multiTrialSubs.map((e) => messageOf(e.messageId)?.trialTotal ?? 0),
            );
            const turnsPerTrial = 1 + (q.subPrompts?.length ?? 0);
            const summary = passKSummaryByTrial(
              [...latestByMsg.values()],
              kPlanned,
              turnsPerTrial,
            );
            passK = {
              trials: summary.trials,
              passed: summary.passed,
              k: summary.k,
              passPowerK: summary.passPowerK,
              status: summary.status,
            };
          }
          // 整题汇总:任一轮失败=失败;分=各轮均值;维度=各轮同维均值。
          // 多 trial 时整题结论改用 pass^k(跑满 k 且每个 trial 全轮通过才算过,保下限)。
          const overallVerdict = passK
            ? passK.passPowerK
              ? ("passed" as const)
              : ("failed" as const)
            : subs.every((e) => e.verdict === "passed")
              ? ("passed" as const)
              : ("failed" as const);
          const scoredSubs = subs.filter((e) => e.autoScore != null);
          const overallScore = scoredSubs.length
            ? Number(
                (
                  scoredSubs.reduce((s, e) => s + (e.autoScore ?? 0), 0) /
                  scoredSubs.length
                ).toFixed(2),
              )
            : undefined;
          // 只保留「至少有一轮真实打了该维度分」的维度 —— 无任何真实分不编造 0.0
          // (与单次评分 scores: ev.scores 同口径:无分则不显示该维,免红色假分误导;
          //  真实打的 0 分 vals=[0] 仍会保留显示)。
          const dimMeans: ScoreDimension[] = q.criteria
            .map((c) => {
              const vals = subs
                .map((e) => e.scores.find((s) => s.key === c.key)?.value)
                .filter((v): v is number => typeof v === "number");
              if (vals.length === 0) return null;
              return {
                key: c.key,
                label: c.label,
                value: Number(
                  (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1),
                ),
                max: 10,
              };
            })
            .filter((d): d is ScoreDimension => d !== null);
          const latest = subs.reduce((a, b) => (newer(b, a) ? b : a));
          items.push({
            questionId: q.id,
            questionTitle: q.title,
            questionPrompt: q.prompt,
            answer: subResults[0]?.answer ?? "",
            ...(q.attachments && q.attachments.length > 0
              ? { attachments: q.attachments }
              : {}),
            verdict: overallVerdict,
            autoScore: overallScore,
            scores: dimMeans,
            notes: subs.find((e) => e.verdict === "failed")?.notes ?? subs[0]?.notes,
            submittedAt: latest.submittedAt,
            failureAttribution: subs.find((e) => e.failureAttribution)?.failureAttribution,
            judgePromptVersion: latest.judgePromptVersion,
            subResults,
            ...(passK ? { passK } : {}),
          });
          continue;
        }

        // —— 单次评分:整题结论取最新一条(人工复核晚于 LLM 判则以人工为准);
        // judges 收齐该回答的所有判源(LLM + 人工),不再只显示最新那条。
        const ev = evs.reduce((a, b) => (newer(b, a) ? b : a));
        const sameMsg = evs.filter((e) => e.messageId === ev.messageId);
        items.push({
          questionId: q.id,
          questionTitle: q.title,
          questionPrompt: q.prompt,
          answer: answerOf(ev.messageId),
          ...(q.attachments && q.attachments.length > 0
            ? { attachments: q.attachments }
            : {}),
          verdict: ev.verdict,
          autoScore: ev.autoScore,
          scores: ev.scores,
          notes: ev.notes,
          submittedAt: ev.submittedAt,
          failureAttribution: ev.failureAttribution,
          judges: collectJudges(sameMsg) ?? judgesOf(ev),
          agreementRate: ev.agreementRate,
          // 冻结本次 LLM 评测用的 prompt 版本(版本↔报告可追溯)。
          judgePromptVersion: ev.judgePromptVersion,
        });
      }
      // Order: newest first.
      items.sort(
        (a, b) =>
          new Date(b.submittedAt).getTime() -
          new Date(a.submittedAt).getTime(),
      );
      return items;
    },
    [evaluations, questions, conversations],
  );

  const composeReportMetrics = useCallback(
    (
      agentProfileId: string,
      questionIds?: string[],
      opts?: { targets?: Record<string, number>; employeeId?: string },
    ) => {
      const whitelist = questionIds ? new Set(questionIds) : null;
      // 该 agent 在 scope 下的全部 evaluation(不塌缩到最新)。
      const matching = evaluations.filter((e) => {
        if (e.agentProfileId !== agentProfileId) return false;
        if (whitelist && !whitelist.has(e.questionId)) return false;
        return true;
      });
      // 按 questionId 分组。
      const byQ = new Map<string, typeof matching>();
      for (const ev of matching) {
        const arr = byQ.get(ev.questionId) ?? [];
        arr.push(ev);
        byQ.set(ev.questionId, arr);
      }
      const findAnswer = (messageId: string): string => {
        for (const conv of conversations) {
          for (const m of conv.messages ?? []) {
            if (m.id === messageId) return m.content;
          }
        }
        return "";
      };
      const perQuestion: ReportMetricsInput["perQuestion"] = [];
      for (const [qid, evs] of byQ) {
        const q = questions.find((qq) => qq.id === qid);
        const outOfScope = !!(q?.outOfScope || q?.intent === "anomaly");
        const subEvals = evs.filter((e) => typeof e.subIndex === "number");
        if (subEvals.length > 0) {
          // 困难题逐轮:各轮(每 subIndex 取最新)收拢成**一个题单元 = 一个 trial**,
          // 任一轮失败=整题失败;别把每轮当独立 trial 把完成率/一致性冲乱。
          const latestBySub = new Map<number, (typeof evs)[number]>();
          for (const e of subEvals) {
            const k = e.subIndex as number;
            const cur = latestBySub.get(k);
            if (
              !cur ||
              new Date(e.submittedAt).getTime() > new Date(cur.submittedAt).getTime()
            )
              latestBySub.set(k, e);
          }
          const subs = [...latestBySub.values()];
          const allAnswered = subs.every(
            (e) => findAnswer(e.messageId).trim().length > 0,
          );
          const verdict = subs.every((e) => e.verdict === "passed")
            ? ("passed" as const)
            : ("failed" as const);
          // 维度分 = 各轮同维均值(供专属指标聚合)。
          const dims: ScoreDimension[] = (q?.criteria ?? []).map((c) => {
            const vals = subs
              .map((e) => e.scores.find((s) => s.key === c.key)?.value)
              .filter((v): v is number => typeof v === "number");
            return {
              key: c.key,
              label: c.label,
              value: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0,
              max: 10,
            };
          });
          perQuestion.push({
            questionId: qid,
            outOfScope,
            trials: [
              {
                answer: allAnswered ? "ok" : "",
                verdict,
                hadUncertaintySignal: subs.some(
                  (e) => (e.uncertaintySignals?.length ?? 0) > 0,
                ),
                scores: dims,
              },
            ],
          });
          continue;
        }
        perQuestion.push({
          questionId: qid,
          outOfScope,
          trials: evs.map((ev) => ({
            answer: findAnswer(ev.messageId),
            verdict: ev.verdict,
            hadUncertaintySignal: (ev.uncertaintySignals?.length ?? 0) > 0,
            scores: ev.scores,
          })),
        });
      }
      // redline:与 addReport 冻结口径一致 —— 用「每题最新一次」的 items 算。
      const items = composeReportItems(agentProfileId, questionIds);
      const gate = evaluateReleaseGate(
        items.map((it) => ({
          verdict: it.verdict,
          failureAttribution: it.failureAttribution,
          key: it.questionId,
          label: it.questionTitle,
        })),
      );
      const emp = opts?.employeeId
        ? findDisplayEmployee(opts.employeeId)
        : undefined;
      return computeReportMetrics({
        perQuestion,
        k: 1,
        targets: opts?.targets,
        specificMetricTemplates: emp?.specificMetricTemplates,
        redlineBlockerCount: gate.blockers.length,
      });
    },
    [evaluations, questions, conversations, composeReportItems],
  );

  const addReport = useCallback(
    (init: {
      title: string;
      agentProfileId: string;
      agentName: string;
      items: ReportItem[];
      kind?: import("@/types").ReportKind;
      metrics?: import("@/types").ReportMetrics;
      baselineReportId?: string;
      baselineMetrics?: import("@/types").ReportMetrics;
      header?: import("@/types").ReportHeaderMeta;
      targets?: Record<string, number>;
    }): string => {
      const id = `report_${shortId()}`;
      // 盖章:谁生成的报告。用于「每个用户只看自己的报告」过滤。无名用户 → 不盖,留作无主。
      const owner = makeEvaluatorRef(user);
      // 生成时冻结发版裁定(仅安全红线一票否决)。
      const gate = evaluateReleaseGate(
        init.items.map((it) => ({
          verdict: it.verdict,
          failureAttribution: it.failureAttribution,
          key: it.questionId,
          label: it.questionTitle,
        })),
      );
      const report: EvaluationReport = {
        id,
        createdAt: new Date().toISOString(),
        title: init.title.trim() || "未命名报告",
        agentProfileId: init.agentProfileId,
        agentName: init.agentName,
        items: init.items,
        canRelease: gate.canRelease,
        releaseBlockers: gate.blockers,
        ...(owner ? { owner } : {}),
        ...(init.kind ? { kind: init.kind } : {}),
        ...(init.metrics ? { metrics: init.metrics } : {}),
        ...(init.baselineReportId ? { baselineReportId: init.baselineReportId } : {}),
        ...(init.baselineMetrics ? { baselineMetrics: init.baselineMetrics } : {}),
        ...(init.header ? { header: init.header } : {}),
        ...(init.targets ? { targets: init.targets } : {}),
      };
      setReports((prev) => [report, ...prev]);
      return id;
    },
    [user],
  );

  const deleteReport = useCallback((id: string) => {
    setReports((prev) => prev.filter((r) => r.id !== id));
  }, []);

  /**
   * 人工采集类指标(如满意度)在报告生成后手动录入实测值(value=null 恢复「需人工采集」)。
   * 直接改这份报告快照的 metrics 行(reports 走 useSliceSync 上行同步),导出/对比自动跟随。
   */
  const setReportManualMetric = useCallback(
    (reportId: string, metricKey: string, value: number | null) => {
      setReports((prev) =>
        prev.map((r) => {
          if (r.id !== reportId || !r.metrics) return r;
          const patch = (rows: MetricRow[]) =>
            rows.map((row) =>
              row.key === metricKey ? applyManualMetricValue(row, value) : row,
            );
          return {
            ...r,
            metrics: {
              ...r.metrics,
              general: patch(r.metrics.general),
              specific: patch(r.metrics.specific),
            },
          };
        }),
      );
    },
    [],
  );

  const addEvaluationRun = useCallback(
    (init: {
      subjectProfileId: string;
      versionLabel: string;
      config: EvaluationRunConfig;
      rerunOfRunId?: string;
      onlyFailedFromRunId?: string;
    }): string => {
      const id = `run_${shortId()}`;
      const now = new Date().toISOString();
      const run: EvaluationRun = {
        id,
        createdAt: now,
        updatedAt: now,
        subjectProfileId: init.subjectProfileId,
        versionLabel: init.versionLabel,
        config: init.config,
        status: "queued",
        progress: { answered: 0, judged: 0, total: init.config.questionIds.length * Math.max(1, init.config.trialsPerQuestion) },
        ...(init.rerunOfRunId ? { rerunOfRunId: init.rerunOfRunId } : {}),
        ...(init.onlyFailedFromRunId ? { onlyFailedFromRunId: init.onlyFailedFromRunId } : {}),
      };
      setEvaluationRuns((prev) => [run, ...prev]);
      return id;
    },
    [],
  );

  const updateEvaluationRun = useCallback(
    (id: string, patch: Partial<EvaluationRun>): void => {
      setEvaluationRuns((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r,
        ),
      );
    },
    [],
  );

  const deleteEvaluationRun = useCallback((id: string): void => {
    setEvaluationRuns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addSkillReport = useCallback(
    (init: { title: string; meta: SkillReportMeta; frame: SkillOptDoneFrame; logs: string[] }): string => {
      const id = shortId("skillreport");
      const owner = makeEvaluatorRef(user);
      const report: SkillEvalReport = {
        id,
        createdAt: new Date().toISOString(),
        title: init.title.trim() || "未命名 Skill 报告",
        ...(owner ? { owner } : {}),
        meta: init.meta,
        frame: init.frame,
        logs: init.logs,
      };
      setSkillReports((prev) => [report, ...prev]);
      return id;
    },
    [user],
  );

  const deleteSkillReport = useCallback((id: string) => {
    setSkillReports((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const setSkillReportAudit = useCallback(
    (reportId: string, m: { caseId: string; autoCorrect: boolean; note?: string }) => {
      const reviewer = makeEvaluatorRef(user);
      const mark: SkillAuditMark = {
        caseId: m.caseId,
        autoCorrect: m.autoCorrect,
        ...(m.note?.trim() ? { note: m.note.trim() } : {}),
        ...(reviewer ? { reviewer } : {}),
        reviewedAt: new Date().toISOString(),
      };
      setSkillReports((prev) => prev.map((r) => (r.id === reportId ? upsertAuditMark(r, mark) : r)));
    },
    [user],
  );

  const setSkillReportThresholds = useCallback((reportId: string, t: ReleaseGateThresholds) => {
    setSkillReports((prev) => prev.map((r) => (r.id === reportId ? withThresholds(r, t) : r)));
  }, []);

  const addFloorElement = useCallback(
    (init: Omit<FloorElement, "id" | "createdAt">): string => {
      const id = `floor_${shortId()}`;
      setFloorElements((prev) => [
        { ...init, id, createdAt: new Date().toISOString() },
        ...prev,
      ]);
      return id;
    },
    [],
  );

  const updateFloorElement = useCallback(
    (id: string, patch: Partial<FloorElement>) => {
      setFloorElements((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      );
    },
    [],
  );

  const deleteFloorElement = useCallback((id: string) => {
    setFloorElements((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const importFloorCandidates = useCallback(
    (cands: FloorCandidate[]): string[] => {
      // 入库硬去重:与现有(同员工+同归一化标题)重复、及本批内部重复的,都剔除。
      // 在函数式更新里对最新 prev 去重,避免快照过期;返回真正新建的 id。
      const createdIds: string[] = [];
      setFloorElements((prev) => {
        createdIds.length = 0; // StrictMode 双跑时不累加
        const fresh = dedupeFloorCandidates(prev, cands);
        const now = new Date().toISOString();
        const created = fresh.map((c) => {
          const el = { ...c, id: `floor_${shortId()}`, createdAt: now };
          createdIds.push(el.id);
          return el;
        });
        return [...created, ...prev];
      });
      return createdIds;
    },
    [],
  );

  const setQuestionFloorElements = useCallback(
    (questionId: string, elementIds: string[]) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId ? { ...q, floorElementIds: elementIds } : q,
        ),
      );
    },
    [],
  );

  const toggleQuestionFloorElement = useCallback(
    (questionId: string, elementId: string, on: boolean) => {
      setQuestions((prev) =>
        prev.map((q) => {
          if (q.id !== questionId) return q;
          const cur = new Set(q.floorElementIds ?? []);
          if (on) cur.add(elementId);
          else cur.delete(elementId);
          return { ...q, floorElementIds: Array.from(cur) };
        }),
      );
    },
    [],
  );

  /* ----- 角色专属指标 overlay --------------------------------------------- */

  // 统一入口:对某员工 overlay 做不可变变换;变换后若 overlay 为空则删除该条目
  // (保持「干净 = 无 entry」,resolveEmployeeMetrics 对 undefined 也安全)。
  const patchOverlay = useCallback(
    (
      employeeId: string,
      fn: (ov: EmployeeMetricsOverlay) => EmployeeMetricsOverlay,
    ) => {
      setEmployeeMetrics((prev) => {
        const next = fn(prev[employeeId] ?? EMPTY_OVERLAY);
        const isEmpty =
          Object.keys(next.overrides).length === 0 &&
          next.hiddenKeys.length === 0 &&
          next.custom.length === 0;
        const out = { ...prev };
        if (isEmpty) delete out[employeeId];
        else out[employeeId] = next;
        return out;
      });
    },
    [],
  );

  const setMetricOverride = useCallback(
    (employeeId: string, key: string, patch: MetricOverride) => {
      patchOverlay(employeeId, (ov) => ({
        ...ov,
        overrides: { ...ov.overrides, [key]: { ...ov.overrides[key], ...patch } },
      }));
    },
    [patchOverlay],
  );

  const restoreBuiltinMetric = useCallback(
    (employeeId: string, key: string) => {
      patchOverlay(employeeId, (ov) => {
        const overrides = { ...ov.overrides };
        delete overrides[key];
        return {
          ...ov,
          overrides,
          hiddenKeys: ov.hiddenKeys.filter((k) => k !== key),
        };
      });
    },
    [patchOverlay],
  );

  const hideBuiltinMetric = useCallback(
    (employeeId: string, key: string) => {
      patchOverlay(employeeId, (ov) => {
        const overrides = { ...ov.overrides };
        delete overrides[key]; // 隐藏即丢弃其改写
        return {
          ...ov,
          overrides,
          hiddenKeys: ov.hiddenKeys.includes(key)
            ? ov.hiddenKeys
            : [...ov.hiddenKeys, key],
        };
      });
    },
    [patchOverlay],
  );

  const addCustomMetric = useCallback(
    (employeeId: string, init: Omit<EmployeeMetricTemplate, "key">): string => {
      const key = `${employeeId}.custom-${shortId()}`;
      patchOverlay(employeeId, (ov) => ({
        ...ov,
        // 插到最前:新加的空白条出现在自定义组顶部,方便立即填写。
        custom: [{ ...init, key }, ...ov.custom],
      }));
      return key;
    },
    [patchOverlay],
  );

  const updateCustomMetric = useCallback(
    (
      employeeId: string,
      key: string,
      patch: Partial<Omit<EmployeeMetricTemplate, "key">>,
    ) => {
      patchOverlay(employeeId, (ov) => ({
        ...ov,
        custom: ov.custom.map((c) => (c.key === key ? { ...c, ...patch } : c)),
      }));
    },
    [patchOverlay],
  );

  const deleteCustomMetric = useCallback(
    (employeeId: string, key: string) => {
      patchOverlay(employeeId, (ov) => ({
        ...ov,
        custom: ov.custom.filter((c) => c.key !== key),
      }));
    },
    [patchOverlay],
  );

  const importCustomMetrics = useCallback(
    (
      employeeId: string,
      inits: Array<Omit<EmployeeMetricTemplate, "key">>,
    ): string[] => {
      const builtins = findDisplayEmployee(employeeId)?.specificMetricTemplates ?? [];
      const createdKeys: string[] = [];
      setEmployeeMetrics((prev) => {
        createdKeys.length = 0; // StrictMode 双调用安全(同 importFloorCandidates)
        const cur = prev[employeeId] ?? EMPTY_OVERLAY;
        const existingLabels = resolveEmployeeMetrics(builtins, cur).map((m) => m.label);
        const fresh = dedupeMetricInits(existingLabels, inits);
        if (fresh.length === 0) return prev;
        const added = fresh.map((m) => {
          const key = `${employeeId}.custom-${shortId()}`;
          createdKeys.push(key);
          return { ...m, key };
        });
        return { ...prev, [employeeId]: { ...cur, custom: [...cur.custom, ...added] } };
      });
      return createdKeys;
    },
    [],
  );

  const resetEmployeeMetrics = useCallback((employeeId: string) => {
    setEmployeeMetrics((prev) => {
      if (!prev[employeeId]) return prev;
      const out = { ...prev };
      delete out[employeeId];
      return out;
    });
  }, []);

  /* ------------------------- User profile ------------------------------- */

  const setUser = useCallback((patch: Partial<UserProfile>) => {
    setUserState((prev) => {
      const next: UserProfile = { ...prev, ...patch };
      // Normalize: trim strings, drop empty optionals.
      next.name = (next.name ?? "").trim();
      next.email = next.email?.trim() || undefined;
      next.role = next.role?.trim() || undefined;
      next.avatarUrl = next.avatarUrl?.trim() || undefined;
      return next;
    });
  }, []);

  const clearUser = useCallback(() => {
    setUserState({ name: "" });
  }, []);

  /* ------------------------- Default scoring criteria ------------------- */

  const setDefaultCriteria = useCallback((next: ScoringCriterion[]) => {
    // Normalize: drop blank rows, ensure at least one entry, then renormalize
    // weights so they sum to 1 (matches per-question normalization).
    const cleaned = next
      .map((c) => ({
        ...c,
        label: (c.label ?? "").trim(),
        key: (c.key ?? "").trim() || `crit-${Math.random().toString(36).slice(2, 7)}`,
        description: c.description?.trim() || undefined,
        weight: Math.max(0, c.weight || 0),
      }))
      .filter((c) => c.label);
    if (cleaned.length === 0) return;
    const sum = cleaned.reduce((s, c) => s + c.weight, 0);
    const normalized =
      sum === 0
        ? cleaned.map((c) => ({ ...c, weight: 1 / cleaned.length }))
        : cleaned.map((c) => ({ ...c, weight: c.weight / sum }));
    setDefaultCriteriaState(normalized);
  }, []);

  const resetDefaultCriteria = useCallback(() => {
    setDefaultCriteriaState(DEFAULT_CRITERIA.map((c) => ({ ...c })));
  }, []);

  const deleteCategory = useCallback(
    (name: string) => {
      const t = name.trim();
      if (!t) return;
      // Pick a fallback for re-bucketing: first remaining non-hidden category.
      const hiddenAfter = new Set([...hiddenCategories, t]);
      const candidates = [
        ...BUILTIN_CATEGORIES,
        ...customCategories.filter((c) => c !== t),
      ];
      const fallback = candidates.find((c) => !hiddenAfter.has(c)) ?? "未分类";

      setQuestions((qs) =>
        qs.map((q) => {
          const cats = Array.isArray(q.categories) ? q.categories : [];
          if (!cats.includes(t)) return q;
          const next = cats.filter((c) => c !== t);
          return {
            ...q,
            categories: next.length > 0 ? next : [fallback],
          };
        }),
      );
      setCustomCategories((prev) => prev.filter((c) => c !== t));
      // Always remember the deletion so it doesn't reappear from BUILTIN seeds.
      setHiddenCategories((prev) =>
        prev.includes(t) ? prev : [...prev, t],
      );
    },
    [customCategories, hiddenCategories],
  );

  /* ------------------------- Selection ---------------------------------- */
  // Selection is scoped to the active conversation — every setter mutates
  // only that conv's slot in `selectionByConv`.

  const mutateActiveSelection = useCallback(
    (mutate: (current: Set<string>) => Set<string>) => {
      const convId = activeConversationId;
      if (!convId) return;
      setSelectionByConv((prev) => {
        const next = new Map(prev);
        const cur = next.get(convId) ?? new Set<string>();
        next.set(convId, mutate(cur));
        return next;
      });
    },
    [activeConversationId],
  );

  const toggleSelection = useCallback(
    (id: string) => {
      mutateActiveSelection((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [mutateActiveSelection],
  );

  const setSelection = useCallback(
    (ids: string[]) => {
      mutateActiveSelection(() => new Set(ids));
    },
    [mutateActiveSelection],
  );

  // 给指定会话设选择(不依赖 activeConversationId 闭包)。用于「新建会话再答题」:
  // newConversation() 返回新 id 后立刻把选中题塞进新会话的 selection,避免 setSelection
  // 因 active 切换的异步时序写到旧会话上。
  const setSelectionForConv = useCallback((convId: string, ids: string[]) => {
    setSelectionByConv((prev) => {
      const next = new Map(prev);
      next.set(convId, new Set(ids));
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    mutateActiveSelection(() => new Set());
  }, [mutateActiveSelection]);

  /* ------------------------- Dispatch turn ------------------------------ */

  const dispatchTurn = useCallback(
    (
      prompt: string,
      profileId: string | null,
      opts: {
        /** Target conversation. Falls back to current active. */
        convId?: string;
        questionId?: string;
        turnIndex?: number;
        turnTotal?: number;
        /**
         * 「编辑并重发」用:重发前把该消息及其之后的所有消息从目标会话移除,
         * 从这条重新生成(分叉)。messages 追加与 history 构建对同一切点取值。
         */
        forkBeforeMessageId?: string;
        /** 多 trial 隔离:出站 history 置空、sessionId 置空、且不回写返回的 sid。 */
        freshSession?: boolean;
        /** 多 trial:本条试跑序号(打到消息上,用于「第 i/K 次」标签)。 */
        trialIndex?: number;
        /** 多 trial:试跑总数 K。 */
        trialTotal?: number;
        /**
         * 题级上下文隔离 key。设了之后:① history 只取本会话里**同 questionId + 同 trialIndex**
         * 的消息(题间互不可见);② gateway session 按 `${convId}::${contextKey}` 独立维护
         * (turn0 起新 session 并回写到该 key、后续轮复用 → 题内多轮串、题间隔离)。
         * 这样"批量进一个会话"也能保证隔离,不必每题开新会话。
         */
        contextKey?: string;
        /** 自适应追问:答完别自动跳「打分」tab(用户在题目 tab 继续追问)。 */
        suppressAutoTab?: boolean;
        /** 本轮附带的图片(data URL,base64):挂到 user 消息回显,并随 sendMessage 发给视觉 provider。 */
        images?: string[];
        /** 本轮用户上传的文本文件:气泡显示芯片,内联文本并入发给 agent 的 prompt。 */
        files?: AttachedFile[];
      },
    ) => {
      const { questionId, turnIndex, turnTotal, trialIndex, trialTotal } = opts;
      // Lock the target conversation at dispatch time so subsequent user
      // switches do NOT redirect chunks to a different conversation.
      const targetConvId = opts.convId ?? activeConversationId;
      if (!targetConvId) return;
      const client = profileId ? getClient(profileId) : null;
      if (!client) {
        const msg: ChatMessage = {
          id: shortId("m"),
          role: "system",
          content: `没有可用的 Agent — 请先在右上「Agent」里添加一个 profile`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, msg]);
        return;
      }

      // 上传的文本文件:气泡只显示芯片(userMsg.files),但内联全文并入发给 agent 的 prompt。
      const attachedFiles = opts.files && opts.files.length ? opts.files : undefined;
      const agentPrompt = attachedFiles
        ? prompt + inlineAttachments(attachedFiles)
        : prompt;

      const userMsg: ChatMessage = {
        id: shortId("m"),
        role: "user",
        content: prompt,
        images: opts.images && opts.images.length ? opts.images : undefined,
        files: attachedFiles,
        questionId,
        agentProfileId: profileId ?? undefined,
        turnIndex,
        turnTotal,
        trialIndex,
        trialTotal,
        createdAt: new Date().toISOString(),
      };

      const assistantId = shortId("m");
      const assistantStub: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        questionId,
        agentProfileId: profileId ?? undefined,
        turnIndex,
        turnTotal,
        trialIndex,
        trialTotal,
        createdAt: new Date().toISOString(),
        isStreaming: true,
        modelVersion: client.modelVersion,
      };

      // Append user + assistant stub to the TARGET conversation (which may
      // differ from the currently-viewed one in multi-turn / background streams).
      const { forkBeforeMessageId } = opts;
      updateConversation(targetConvId, (c) => {
        const base = forkBeforeMessageId
          ? prefixBeforeMessage(c.messages, forkBeforeMessageId)
          : c.messages;
        return { ...c, messages: [...base, userMsg, assistantStub] };
      });
      // 起本会话的流(纯内存,按会话隔离)。消息 stub 的 isStreaming:true 保持不变。
      // Don't change connection status — we're already connected. Just signal
      // that this conversation's agent is now busy.
      abortByConv.current.get(targetConvId)?.abort(); // 只中断本会话上一路
      const controller = new AbortController();
      abortByConv.current.set(targetConvId, controller);
      setConvRun(targetConvId, {
        activity: "thinking",
        startedAt: Date.now(),
        stage: null,
      });

      // Build history from the TARGET conversation, not whichever is active.
      const targetConv = conversations.find((c) => c.id === targetConvId);
      const allMsgs = targetConv?.messages ?? [];
      const targetMsgs = forkBeforeMessageId
        ? prefixBeforeMessage(allMsgs, forkBeforeMessageId)
        : allMsgs;
      // 题级隔离:contextKey 设了 → history 只取本题(同 questionId + 同 trialIndex)的消息;
      // turn0(turnIndex 0/缺省)一律视为干净开场(history=[],新 session)。
      const ck = opts.contextKey;
      const isFirstTurn = (opts.turnIndex ?? 0) === 0;
      const scopedMsgs = ck
        ? [...targetMsgs, userMsg].filter(
            (m) =>
              m.questionId === questionId &&
              (m.trialIndex ?? null) === (trialIndex ?? null),
          )
        : [...targetMsgs, userMsg];
      const history =
        opts.freshSession || (ck && isFirstTurn)
          ? []
          : scopedMsgs
              .filter((m) => m.role !== "system" && !m.isStreaming)
              .map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              }));

      let firstChunk = true;
      let answerText = "";

      // session:contextKey 设了 → 按 `${conv}::${key}` 独立维护(题间隔离);否则用会话级。
      const sessionKey = ck ? `${targetConvId}::${ck}` : null;
      const targetSessionId =
        opts.freshSession || (ck && isFirstTurn)
          ? null
          : sessionKey
            ? (sessionByKeyRef.current.get(sessionKey) ?? null)
            : (targetConv?.gatewaySessionId ?? null);

      // Helper: mutate just the in-flight assistant message in the target conv.
      const patchAssistant = (patch: (m: ChatMessage) => ChatMessage) => {
        updateConversation(targetConvId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === assistantId ? patch(m) : m)),
        }));
      };

      // Per-question timeout. Reads from latest questions ref so edits apply
      // on the next dispatch without recreating this callback. The bridge
      // swallows AbortError (returns silently), so on timeout we do the full
      // teardown inline rather than relying on onError to fire.
      const question = questionId
        ? questionsRef.current.find((q) => q.id === questionId)
        : undefined;
      const timeoutMs = question?.timeoutMs;
      let done = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const clearTimer = () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      };
      if (typeof timeoutMs === "number" && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          if (done) return;
          done = true;
          patchAssistant((m) => ({
            ...m,
            isStreaming: false,
            interrupted: true,
            interruptKind: "timeout",
            content:
              m.content +
              (m.content ? "\n\n" : "") +
              `> **已超时**：超过 ${(timeoutMs / 1000).toFixed(1)}s 仍未完成，已自动中断`,
          }));
          if (questionId) {
            setQuestions((qs) =>
              qs.map((q) =>
                q.id === questionId ? { ...q, status: "untested" } : q,
              ),
            );
          }
          setConvRun(targetConvId, null);
          abortByConv.current.delete(targetConvId);
          setPendingTurnsByConv((prev) => {
            const cur = prev.get(targetConvId);
            if (!cur) return prev;
            const next = new Map(prev);
            next.set(targetConvId, { ...cur, errored: true });
            return next;
          });
          // 只有"本次报错/超时的流就是批量 run 会话的流"时,才把批量当前项记 errored。
          // 并行后别的手动会话报错不能污染批量记账(否则成功的批量题被误记失败)。
          setQueue((qs) =>
            qs.current && qs.running && qs.conversationId === targetConvId
              ? { ...qs, errored: [...qs.errored, qs.current] }
              : qs,
          );
          // 报错保留:本会话的待发送标 held,暂停自动发(等用户点击补发)。
          setPendingSendByConv((prev) => {
            const cur = prev.get(targetConvId);
            if (!cur) return prev;
            const next = new Map(prev);
            next.set(targetConvId, { ...cur, held: true });
            return next;
          });
          controller.abort();
        }, timeoutMs);
      }

      client.sendMessage({
        prompt: agentPrompt,
        images: opts.images,
        questionId,
        turnIndex,
        history,
        sessionId: targetSessionId,
        signal: controller.signal,
        onStage: (stage) => {
          setConvRun(targetConvId, { stage });
        },
        onSession: (sid) => {
          if (opts.freshSession) return; // 隔离:不把本 trial 的 sid 留给下一个 trial
          if (sessionKey) {
            // 题级隔离:sid 只存进本题的 key,后续轮复用、不污染会话级 / 别的题。
            sessionByKeyRef.current.set(sessionKey, sid);
            return;
          }
          updateConversation(targetConvId, (c) =>
            c.gatewaySessionId === sid
              ? c
              : { ...c, gatewaySessionId: sid },
          );
        },
        onChunk: (delta) => {
          answerText += delta;
          if (firstChunk) {
            setConvRun(targetConvId, { activity: "streaming", stage: null });
            firstChunk = false;
          }
          patchAssistant((m) => ({ ...m, content: m.content + delta }));
        },
        onComplete: ({ durationMs, tokens, tokensIn, tokensOut, modelVersion: mv, transcript, interrupted }) => {
          if (done) return;
          done = true;
          clearTimer();
          patchAssistant((m) => {
            // provider 给了真实 in/out → measured(直接用)。
            // 既无拆分也无总数(如 platform)→ 估算我方发出的输入(prompt+history)
            // + 回复输出,标 estimated(不含 platform 内部开销,故偏低)。
            // 只有总数、无拆分 → 不估算,保留真实总数走 legacy(70/30),不误标偏低。
            const measured = tokensIn != null && tokensOut != null;
            const hasProviderTotal = tokens != null && tokens > 0;
            const shouldEstimate = !measured && !hasProviderTotal;
            const estIn =
              estimateTokens(prompt) +
              history.reduce((s, h) => s + estimateTokens(h.content), 0);
            const estOut = estimateTokens(m.content);
            return {
              ...m,
              isStreaming: false,
              durationMs,
              tokens: tokens ?? (measured ? tokensIn! + tokensOut! : estIn + estOut),
              tokensIn: measured ? tokensIn : shouldEstimate ? estIn : undefined,
              tokensOut: measured ? tokensOut : shouldEstimate ? estOut : undefined,
              tokensEstimated: shouldEstimate ? true : undefined,
              modelVersion: mv ?? m.modelVersion,
              ...(transcript ? { transcript } : {}),
              // provider 只在「agent 主动反问/暂停等用户(present_options 等)」时报 interrupted。
              // 这是完整的一轮,计入评测(区别于超时/失败的部分文本)。
              ...(interrupted ? { interrupted: true, interruptKind: "agent-pause" as const } : {}),
            };
          });
          setConvRun(targetConvId, null);
          abortByConv.current.delete(targetConvId);
          // 一轮成功收尾 = 这个 agent 确实通——把它标成已连接(保留上次探活详情)。
          if (profileId) setProfileConn(profileId, "connected");
          // 与「运行」对齐:手动发送的题(非批量队列、非多 trial)答完最后一轮,
          // 且用户正看着这个会话 → 自动切到「打分」tab,马上能打分。
          const isFinalTurn =
            turnTotal == null || (turnIndex ?? 0) >= turnTotal - 1;
          if (
            questionId &&
            isFinalTurn &&
            trialIndex == null &&
            !opts.suppressAutoTab &&
            !queueRef.current.running &&
            targetConvId === activeConvIdRef.current
          ) {
            setRightTab("evaluation");
          }
          // 确定性 ground-truth 判分:该题挂了 check 就自动判,产出与 LLM judge 同构的 Evaluation。
          // 到这里(onComplete)的中断只会是 agent 主动反问(present_options 等)—— 完整一轮、非半截
          // 文本,可以判(超时/失败走各自分支、不会进 onComplete)。故反问轮也计入,pass^k 分母凑满 K。
          // 【暂时下线·可恢复】ground-truth 确定性判分整套已停用,置回 true 即重新启用(skill 评测也回到确定性自动判分)。
          if (GROUND_TRUTH_GRADING_ENABLED && questionId) {
            const gq = questionsRef.current.find((q) => q.id === questionId);
            const checks = gq?.groundTruthChecks;
            if (checks && checks.length > 0) {
              const grade = runGroundTruthChecks(checks, {
                answerText,
                userMessageText: prompt,
                toolEvents: transcript ? summarizeToolEvents(transcript.steps) : null,
              });
              const detEval: Evaluation = {
                id: shortId("e"),
                questionId,
                messageId: assistantId,
                scores: grade.perCheck.map((c) => ({
                  key: c.kind,
                  label: GROUND_TRUTH_CHECK_LABEL[c.kind] ?? c.kind,
                  value: c.passed ? 10 : 0,
                  max: 10,
                })),
                autoScore: Number((grade.score * 10).toFixed(2)),
                notes: grade.notes,
                verdict: grade.verdict,
                submittedAt: new Date().toISOString(),
                modelVersion: mv ?? undefined,
                agentProfileId: profileId ?? undefined,
                evaluator: DETERMINISTIC_EVALUATOR,
              };
              setEvaluations((prev) => [detEval, ...prev]);
              updateQuestionStatus(questionId, grade.verdict, detEval.autoScore);
            }
          }
        },
        onError: (err) => {
          if (done) return;
          done = true;
          clearTimer();
          patchAssistant((m) => ({
            ...m,
            isStreaming: false,
            interrupted: true,
            interruptKind: "error",
            content:
              m.content +
              (m.content ? "\n\n" : "") +
              `> **请求失败**：${err.message}`,
          }));
          // Failed answers don't count as tested — restore "未测" status.
          if (questionId) {
            setQuestions((qs) =>
              qs.map((q) =>
                q.id === questionId ? { ...q, status: "untested" } : q,
              ),
            );
          }
          setConvRun(targetConvId, null);
          abortByConv.current.delete(targetConvId);
          // 这一轮发失败 = 这个 agent 当前不通,标成断开(保留上次探活详情)。
          if (profileId) setProfileConn(profileId, "disconnected");
          setPendingTurnsByConv((prev) => {
            const cur = prev.get(targetConvId);
            if (!cur) return prev;
            const next = new Map(prev);
            next.set(targetConvId, { ...cur, errored: true });
            return next;
          });
          // 只有"本次报错/超时的流就是批量 run 会话的流"时,才把批量当前项记 errored。
          // 并行后别的手动会话报错不能污染批量记账(否则成功的批量题被误记失败)。
          setQueue((qs) =>
            qs.current && qs.running && qs.conversationId === targetConvId
              ? { ...qs, errored: [...qs.errored, qs.current] }
              : qs,
          );
          // 报错保留:本会话的待发送标 held,暂停自动发(等用户点击补发)。
          setPendingSendByConv((prev) => {
            const cur = prev.get(targetConvId);
            if (!cur) return prev;
            const next = new Map(prev);
            next.set(targetConvId, { ...cur, held: true });
            return next;
          });
        },
      });
    },
    [
      getClient,
      activeConversationId,
      conversations,
      updateConversation,
      setProfileConn,
      setConvRun,
    ],
  );

  /* ------------------------- sendQuestion ------------------------------- */

  const sendQuestion = useCallback(
    (
      q: Question,
      profileIdOverride?: string,
      opts?: {
        trialIndex?: number;
        trialTotal?: number;
        freshSession?: boolean;
        convId?: string;
        /** 题级隔离 key(默认 q.id):同一会话里按题切分上下文,不必每题开新会话。 */
        contextKey?: string;
      },
    ) => {
      // 只判「目标会话」忙不忙:切到别的空闲会话发不会被这里挡(并行的关键)。
      const targetConv = opts?.convId ?? activeConversationId ?? null;
      if (isConvBusy(runsByConv, pendingTurnsByConv, targetConv)) {
        // 忙碌中别静默吞掉点击 —— 给一条系统提示,用户才知道为什么没发出去。
        setMessages((prev) => [
          ...prev,
          {
            id: shortId("m"),
            role: "system",
            content: "上一条回答还在生成中,等它完成后再发送这道题。",
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }
      // 技能题(kind=skill)只用于 Skill 评测,绝不发给 agent —— 权威闸口(单发 + 批量队列
      // 都经此)。UI 层已不展示,这里是兜底,任何路径都拦住。
      if (isSkillQuestion(q)) return;

      const profileId = profileIdOverride ?? resolveProfileForQuestion(q);

      // 专属题限制:指定了具体员工的题,只能发给该员工绑定的 agent,不能发给别的。
      const empId =
        q.targetEmployeeId && q.targetEmployeeId !== "_all_"
          ? q.targetEmployeeId
          : null;
      if (empId) {
        const bound = agentForEmployee(empId);
        const empName = findDisplayEmployee(empId)?.name ?? empId;
        if (!bound) {
          setMessages((prev) => [
            ...prev,
            {
              id: shortId("m"),
              role: "system",
              content: `「${empName}」还没绑定 agent —— 这道专属题不能发给别的 agent。请先在「标准员工 / Agent 管理」里给它绑定一个 agent 再发。`,
              createdAt: new Date().toISOString(),
            },
          ]);
          return;
        }
        if (profileId !== bound) {
          const boundName = profiles.find((p) => p.id === bound)?.name ?? bound;
          setMessages((prev) => [
            ...prev,
            {
              id: shortId("m"),
              role: "system",
              content: `这道题指定由「${empName}」作答(绑定 agent:${boundName}),不能发给别的 agent。请切换到该 agent 再发。`,
              createdAt: new Date().toISOString(),
            },
          ]);
          return;
        }
      }

      if (!profileId) {
        setMessages((prev) => [
          ...prev,
          {
            id: shortId("m"),
            role: "system",
            content:
              "无可用 Agent profile — 请先在右上「Agent」添加一个，并加入此题的允许列表。",
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }

      const turns = [q.prompt, ...(q.subPrompts ?? [])];
      // Initialize this question's drafts (fresh defaults for a new run).
      // Other questions' drafts in `draftsByQ` are left untouched so users
      // can come back to evaluate them later.
      patchDraftForQ(q.id, makeInitialDraft(q));
      updateQuestionStatus(q.id, "tested");

      // 隔离不再靠"每题开新会话"(那会导致会话爆炸),改成**题级上下文隔离**:
      // 复用一个会话(批量=同一个 run 会话 / 单发=当前会话),靠 contextKey 在会话内
      // 按题切分 history + 每题独立 gateway session。题间互不可见,题内多轮仍串。
      // 多 trial 走 opts.convId + 带 trialIndex 的 contextKey(每 trial 独立 session,不再用 freshSession)。
      const convId = opts?.convId ?? activeConversationId ?? newConversation();
      if (!convId) return;
      // 选中/活动题写到**派发目标会话**(批量=run 会话),不污染用户正看的别的会话。
      setSelectedQuestionIdFor(convId, q.id);
      updateConversation(convId, (c) => ({ ...c, activeQuestionId: q.id }));
      const contextKey = opts?.contextKey ?? q.id;
      // 会话名 = 本会话最近一次测的题目名:每次派发都改(批量跑完即停在最后一题)。
      // 临时题无库号 → 标题不带空号前缀。
      updateConversation(convId, (c) => ({
        ...c,
        title: (q.number ? `${q.number} ${q.title}` : q.title).slice(0, 40),
      }));

      const sendAttach = attachmentsToSendPayload(q.attachments);
      dispatchTurn(turns[0], profileId, {
        convId,
        questionId: q.id,
        turnIndex: 0,
        turnTotal: turns.length,
        freshSession: opts?.freshSession,
        trialIndex: opts?.trialIndex,
        trialTotal: opts?.trialTotal,
        contextKey,
        files: sendAttach.files.length ? sendAttach.files : undefined,
        images: sendAttach.images.length ? sendAttach.images : undefined,
      });
      if (turns.length > 1) {
        setConvPendingTurns(convId, {
          convId,
          questionId: q.id,
          profileId,
          prompts: turns.slice(1),
          initialTotal: turns.length,
          errored: false,
          contextKey,
          // 多 trial 多步题:续轮必须沿用本 trial 的序号(见 TurnDispatch 注释)。
          trialIndex: opts?.trialIndex,
          trialTotal: opts?.trialTotal,
        });
      }
    },
    [
      runsByConv,
      pendingTurnsByConv,
      activeConversationId,
      activeConversation,
      newConversation,
      updateConversation,
      resolveProfileForQuestion,
      agentForEmployee,
      profiles,
      dispatchTurn,
      updateQuestionStatus,
      setSelectedQuestionIdFor,
    ],
  );

  // Auto-advance multi-turn —— 每条会话的续发管线独立推进(并行)。
  useEffect(() => {
    for (const [convId, pt] of pendingTurnsByConv) {
      if (isConvStreaming(runsByConv, convId)) continue; // 该会话还在流式,等它
      if (pt.errored) {
        setConvPendingTurns(convId, null);
        continue;
      }
      if (pt.prompts.length === 0) {
        setConvPendingTurns(convId, null);
        continue;
      }
      const q = questionsRef.current.find((qq) => qq.id === pt.questionId);
      if (!q) {
        setConvPendingTurns(convId, null);
        continue;
      }
      const nextPrompt = pt.prompts[0];
      const turnIndex = pt.initialTotal - pt.prompts.length;
      setConvPendingTurns(convId, { ...pt, prompts: pt.prompts.slice(1) });
      // 不同 convId → 不同控制器,一次 effect 里的多会话派发互不 abort。
      dispatchTurn(nextPrompt, pt.profileId, {
        convId: pt.convId,
        questionId: q.id,
        turnIndex,
        turnTotal: pt.initialTotal,
        contextKey: pt.contextKey,
        trialIndex: pt.trialIndex,
        trialTotal: pt.trialTotal,
      });
    }
  }, [runsByConv, pendingTurnsByConv, dispatchTurn, setConvPendingTurns]);

  const sendRawPrompt = useCallback(
    (
      prompt: string,
      images?: string[],
      files?: AttachedFile[],
      // 后台自动补发用:指定要发到哪条会话 + 用哪个 agent(不传 = 发到当前 active)。
      target?: { convId?: string; profileId?: string },
    ) => {
      const trimmed = prompt.trim();
      const hasImages = !!(images && images.length);
      const hasFiles = !!(files && files.length);
      // 只发图 / 只发文件(无文字)也允许:发给 agent 的显示正文保持空,
      // 但评测题需要一个可读标题/prompt → 用 label 占位。
      if (!trimmed && !hasImages && !hasFiles) return;
      const label = trimmed || "[图片]";
      const profileId = target?.profileId ?? activeProfileId;
      // 只判「目标会话」忙不忙(默认 active);后台补发判它自己那条。
      if (
        isConvBusy(
          runsByConv,
          pendingTurnsByConv,
          target?.convId ?? activeConversationId ?? null,
        )
      )
        return;
      if (!profileId) return;

      // 目标会话必须真实存在于列表里;activeConversationId 悬空(指向已删/已丢弃的会话)
      // 时另开新会话,否则 updateConversation 找不到目标 → 消息静默丢失(发完就没了)。
      const convId = target?.convId
        ? target.convId
        : activeConversationId &&
            conversations.some((c) => c.id === activeConversationId)
          ? activeConversationId
          : newConversation();
      const conv = conversations.find((c) => c.id === convId);
      const titleOf = (s: string) => (s.length > 32 ? s.slice(0, 32) + "…" : s);

      // 自由对话也计入评分:为这段对话建 / 复用一道「自由对话」能力题,手动轮全挂到它
      //(整段对话 = 一道多轮题)。派生"本会话的手动题":本会话消息里指向某道带本标记的题。
      let manualQid =
        conv?.messages
          .map((m) => m.questionId)
          .find((qid) => {
            if (!qid) return false;
            const q = questionsRef.current.find((x) => x.id === qid);
            return !!q && (q.tags ?? []).includes(FREE_TALK_TAG);
          }) ?? null;
      let turnIndex = 0;

      if (!manualQid) {
        // 首句 → 建题。能力题(无 GT / passForm,judge 按能力题首要判据判);逐轮单评。
        // 能确定的字段就填上:答题员工(由作答 agent 反查)、样本意图(真实用户问 = typical)。
        const empId = employeeForProfile(profileId);
        const draft: QuestionDraft = {
          kind: "agent",
          // 临时题:能在打分里评,但**不进题库**;用户点「保存到题库」才转正(见 saveQuestionToLibrary)。
          transient: true,
          title: titleOf(label),
          prompt: label,
          subPrompts: [],
          scoringMode: "per-sub",
          categories: [FREE_TALK_TAG],
          difficulty: "medium",
          tags: [FREE_TALK_TAG],
          referenceAnswer: "",
          agentIds: [profileId],
          ...(empId ? { targetEmployeeId: empId } : {}),
          intent: "typical",
          criteria: criteriaForQuestion({}, floorElements),
        };
        manualQid = addQuestion(draft).id;
      } else {
        // 后续手动轮 → 挂到同一题,追加 subPrompts;turnIndex = 本会话该题已答轮数。
        const q = questionsRef.current.find((x) => x.id === manualQid);
        updateQuestion(manualQid, {
          subPrompts: [...(q?.subPrompts ?? []), label],
        });
        turnIndex = answeredTurns(conv?.messages ?? [], manualQid).length;
      }
      // 选中这道题 → 打分 tab 立刻有题可评(本会话维度)。
      setSelectedQuestionIdFor(convId, manualQid);

      // 自动给新对话起标题(沿用原逻辑)。
      updateConversation(convId, (c) =>
        c.title === "新对话" ? { ...c, title: titleOf(label) } : c,
      );

      // 发给 agent 的正文用 trimmed(可为空 = 只发图);label 只用于题目元数据。
      dispatchTurn(trimmed, profileId, {
        convId,
        questionId: manualQid,
        contextKey: manualQid,
        turnIndex,
        images,
        files,
      });
    },
    [
      runsByConv,
      pendingTurnsByConv,
      dispatchTurn,
      activeProfileId,
      activeConversationId,
      conversations,
      newConversation,
      addQuestion,
      updateQuestion,
      updateConversation,
      setSelectedQuestionIdFor,
      floorElements,
      employeeForProfile,
    ],
  );

  /** 忙碌时把手动自由发送排入本会话的排队槽(每会话一份,覆盖旧的)。 */
  const queueSend = useCallback(
    (prompt: string, images?: string[], files?: AttachedFile[]) => {
      const trimmed = prompt.trim();
      const hasImages = !!(images && images.length);
      const hasFiles = !!(files && files.length);
      if (!trimmed && !hasImages && !hasFiles) return; // 与 sendRawPrompt 同守卫
      const convId = activeConversationId;
      if (!convId) return;
      setConvPendingSend(convId, { convId, prompt: trimmed, images, files });
    },
    [activeConversationId, setConvPendingSend],
  );

  const cancelPendingSend = useCallback(() => {
    if (activeConversationId) setConvPendingSend(activeConversationId, null);
  }, [activeConversationId, setConvPendingSend]);

  /** 手动补发(报错保留后点击「已暂停 · 点击发送」);仅当前会话空闲时生效(用户正看着它)。 */
  const flushPendingSend = useCallback(() => {
    const p = activeConversationId
      ? pendingSendByConv.get(activeConversationId)
      : undefined;
    if (!p) return;
    if (isConvBusy(runsByConv, pendingTurnsByConv, p.convId)) return;
    setConvPendingSend(p.convId, null);
    sendRawPrompt(p.prompt, p.images, p.files);
  }, [
    activeConversationId,
    pendingSendByConv,
    runsByConv,
    pendingTurnsByConv,
    setConvPendingSend,
    sendRawPrompt,
  ]);

  // 排队消息自动发送:每条会话一空闲(不流式、无多轮题)就发出它自己的排队消息。
  // 并行:后台会话也自动发(不再要求"正看着它");发到该会话、用该会话的 agent。
  useEffect(() => {
    for (const [convId, p] of pendingSendByConv) {
      if (p.held) continue; // 报错保留中,等用户点补发
      if (isConvBusy(runsByConv, pendingTurnsByConv, convId)) continue;
      // 派生该会话的 agent:取最近一条带 profile 的消息,回退当前 active。
      const conv = conversations.find((c) => c.id === convId);
      let profileId: string | undefined;
      for (let i = (conv?.messages.length ?? 0) - 1; i >= 0; i--) {
        const pid = conv!.messages[i].agentProfileId;
        if (pid) {
          profileId = pid;
          break;
        }
      }
      profileId = profileId ?? activeProfileId ?? undefined;
      if (!profileId) continue; // 派生不出 agent → 留着排队,别在清空后丢消息
      setConvPendingSend(convId, null);
      sendRawPrompt(p.prompt, p.images, p.files, { convId, profileId });
    }
  }, [
    pendingSendByConv,
    runsByConv,
    pendingTurnsByConv,
    conversations,
    activeProfileId,
    setConvPendingSend,
    sendRawPrompt,
  ]);

  /**
   * 编辑一条已发的**用户消息**并重发:从该消息处分叉 —— 删掉它原来的回复及其之后
   * 的所有消息,以编辑后的内容从这里重新生成。重发的轮按**自由 prompt** 处理
   * (不带 questionId / 多轮元数据),上下文靠 history 完整保留。
   */
  const editAndResendMessage = useCallback(
    (messageId: string, newContent: string) => {
      const trimmed = newContent.trim();
      if (!trimmed) return;
      // 编辑/重试的是当前查看会话:判它忙不忙。
      if (isConvBusy(runsByConv, pendingTurnsByConv, activeConversationId))
        return;
      const convId = activeConversationId;
      if (!convId) return;
      const conv = conversations.find((c) => c.id === convId);
      const target = conv?.messages.find((m) => m.id === messageId);
      if (!target) return;
      const profileId = target.agentProfileId ?? activeProfileId;
      if (!profileId) return;
      dispatchTurn(trimmed, profileId, {
        convId,
        forkBeforeMessageId: messageId,
        // 编辑的是文字,原图保留一起重发(否则带图消息一编辑就丢图)。
        images: target.images,
        files: target.files,
      });
    },
    [
      runsByConv,
      pendingTurnsByConv,
      activeConversationId,
      conversations,
      activeProfileId,
      dispatchTurn,
    ],
  );

  /**
   * 重试一条已发的**用户消息**:用**完全相同**的内容(含图片)从该消息分叉重发,
   * 丢弃其原回复及之后的所有消息,重新生成一份回答(替换,不保留旧版本)。
   */
  const retryMessage = useCallback(
    (messageId: string) => {
      if (isConvBusy(runsByConv, pendingTurnsByConv, activeConversationId))
        return;
      const convId = activeConversationId;
      if (!convId) return;
      const conv = conversations.find((c) => c.id === convId);
      const target = conv?.messages.find((m) => m.id === messageId);
      if (!target || target.role !== "user") return;
      const profileId = target.agentProfileId ?? activeProfileId;
      if (!profileId) return;
      dispatchTurn(target.content, profileId, {
        convId,
        forkBeforeMessageId: messageId,
        images: target.images,
        files: target.files,
      });
    },
    [
      runsByConv,
      pendingTurnsByConv,
      activeConversationId,
      conversations,
      activeProfileId,
      dispatchTurn,
    ],
  );

  /* ------------------------- Bulk queue --------------------------------- */

  const runQueue = useCallback(
    (
      rawQuestionIds: string[],
      opts?: {
        trials?: number;
        autoJudge?: AutoJudgeConfig;
        subjectProfileId?: string;
        skipAnswered?: boolean;
      },
    ): string | null => {
      // 同一时刻只允许一个批量队列(共享同一条派发管线)——已有在跑的直接忽略。
      if (queueRef.current.running) return null;
      // 技能题不进 agent 批量运行队列(只用于 Skill 评测)。
      const questionIds = rawQuestionIds.filter((id) => {
        const q = questionsRef.current.find((qq) => qq.id === id);
        return q != null && !isSkillQuestion(q);
      });
      if (questionIds.length === 0) return null;
      const trials = Math.max(1, Math.floor(opts?.trials ?? 1));
      const isMultiTrial = trials >= 2;
      const allAgentProfileIds = profiles
        .filter((p) => getProfileKind(p.providerId) === "agent")
        .map((p) => p.id);

      // 解析一道题应发给哪些 agent。有 subjectProfileId 时钉死该被测,忽略绑定与 active。
      const resolveTargets = (q: Question): string[] => {
        if (opts?.subjectProfileId) return [opts.subjectProfileId];
        return q.targetEmployeeId === "_all_"
          ? allAgentProfileIds
          : q.targetEmployeeId
            ? (() => {
                const bound = agentForEmployee(q.targetEmployeeId);
                return bound && bound === activeProfileId ? [bound] : [];
              })()
            : activeProfileId
              ? [activeProfileId]
              : [];
      };

      if (isMultiTrial) {
        // 多 trial:单 prompt 题与多步题都支持。建独立 run 会话,每题每 trial 跑一遍
        // (多步题一个 trial 会跑完全部 subPrompts 轮)。trial 间靠 contextKey 的 #t${t}
        // 隔离 session,history 靠 (questionId, trialIndex) 隔离(见 dispatchTurn)。
        const trialQs = questionIds
          .map((qid) => questionsRef.current.find((qq) => qq.id === qid))
          .filter((q): q is Question => !!q);
        if (trialQs.length === 0) return null;
        const runConvId = newConversation();
        updateConversation(runConvId, (c) => ({
          ...c,
          title: `多trial · ${trialQs.length}题×${trials}次`,
        }));
        const items: QueueItem[] = [];
        for (const q of trialQs) {
          for (const pid of resolveTargets(q)) {
            for (let t = 0; t < trials; t++) {
              items.push({
                questionId: q.id,
                profileId: pid,
                trialIndex: t,
                trialTotal: trials,
                // 每 trial 独立上下文隔离 key:turn0 起新 session 并回写到此 key,
                // 同 trial 的 subPrompts 轮复用;trial 间因 #t${t} 不同而隔离。
                // 取代旧的 freshSession(单 prompt 单轮时对 turn0 等价,但 freshSession
                // 不回写 sid → 多步题 turn1 会断上下文)。
                contextKey: `${q.id}#t${t}`,
                convId: runConvId,
              });
            }
          }
        }
        if (items.length === 0) return null;
        setQueue({
          running: true,
          conversationId: runConvId,
          pending: items,
          current: null,
          completed: [],
          errored: [],
          total: items.length,
          autoJudge: opts?.autoJudge ?? null,
        });
        setRightTab("current");
        return runConvId;
      }

      // 「跳过已答」:某题被某 agent 在**任意会话**里已完成回答(非流式、非中断)→ 不再重跑那条。
      // 按 (questionId, profileId) 粒度,全体员工题只跳已答过的那几个 agent。
      const answeredPairs: Set<string> | null = opts?.skipAnswered
        ? (() => {
            const s = new Set<string>();
            for (const conv of conversationsRef.current) {
              for (const m of conv.messages ?? []) {
                if (
                  m.role === "assistant" &&
                  m.questionId &&
                  m.agentProfileId &&
                  !m.isStreaming &&
                  !m.interrupted
                ) {
                  s.add(`${m.questionId} ${m.agentProfileId}`);
                }
              }
            }
            return s;
          })()
        : null;

      // 普通批量:全部题进**同一个 run 会话**,靠 contextKey(题 id)在会话内按题隔离。
      // 不再每题开新会话 → 一批只产生一个会话。
      const items: QueueItem[] = [];
      for (const qid of questionIds) {
        const q = questionsRef.current.find((qq) => qq.id === qid);
        if (!q) continue;
        for (const pid of resolveTargets(q)) {
          if (answeredPairs && answeredPairs.has(`${qid} ${pid}`)) continue;
          items.push({ questionId: qid, profileId: pid });
        }
      }
      if (items.length === 0) return null;
      const runConvId = newConversation();
      updateConversation(runConvId, (c) => ({
        ...c,
        title: `批量 · ${questionIds.length} 题`,
      }));
      setQueue({
        running: true,
        conversationId: runConvId,
        pending: items.map((it) => ({ ...it, convId: runConvId })),
        current: null,
        completed: [],
        errored: [],
        total: items.length,
        autoJudge: opts?.autoJudge ?? null,
      });
      setRightTab("current");
      return runConvId;
    },
    [
      profiles,
      activeProfileId,
      agentForEmployee,
      newConversation,
      updateConversation,
    ],
  );

  // evaluationRunsRef:仿照 queueRef 模式,供 effect/异步里读到最新值。
  const evaluationRunsRef = useRef<EvaluationRun[]>(evaluationRuns);
  useEffect(() => { evaluationRunsRef.current = evaluationRuns; }, [evaluationRuns]);

  const startEvaluationRun = useCallback(
    (init: {
      subjectProfileId: string;
      versionLabel: string;
      config: EvaluationRunConfig;
      rerunOfRunId?: string;
      onlyFailedFromRunId?: string;
    }): string => {
      const id = addEvaluationRun(init);
      // 活动 agent ≠ 被测 → 主动切到被测,避免"会话/头部 agent 与被测不一致"。
      // 在 runQueue 之前切:run 会话会建在正确被测下(setActiveProfile 复用空会话,
      // 随后 runQueue 的 newConversation 复用同一条,不堆积)。
      const needSwitch = activeProfileId !== init.subjectProfileId;
      if (needSwitch) setActiveProfile(init.subjectProfileId);
      // 钉死被测 + 不开 autoJudge(编排器自己串评分)。
      const convId = runQueue(init.config.questionIds, {
        ...(init.config.trialsPerQuestion >= 2 ? { trials: init.config.trialsPerQuestion } : {}),
        subjectProfileId: init.subjectProfileId,
      });
      if (convId == null) {
        // 没入队(无题/队列占用)→ 直接失败,不留半截运行。
        updateEvaluationRun(id, { status: "failed", error: "无可运行的题或已有批量在跑" });
        return id;
      }
      updateEvaluationRun(id, { status: "answering", runConversationId: convId });
      setActiveEvaluationRunId(id);
      if (needSwitch) {
        const name = profiles.find((p) => p.id === init.subjectProfileId)?.name ?? init.subjectProfileId;
        showNotice({ kind: "success", message: `已切换至对应被测「${name}」` });
      }
      return id;
    },
    [addEvaluationRun, updateEvaluationRun, runQueue, activeProfileId, setActiveProfile, profiles, showNotice],
  );

  const stopQueue = useCallback(() => {
    // 批量单槽:停掉批量 run 会话那条流(不动别处的手动会话)。
    const runConv = queueRef.current.conversationId;
    if (runConv) teardownConvStream(runConv);
    // 保留剩余队列供「继续」从断点接上:被中断的 current(流已 teardown、没跑完)退回队首,
    // 续跑时重答它;其余 pending 原样保留。running 置 false、current 清空。
    setQueue((q) => ({
      ...q,
      running: false,
      pending: q.current ? [q.current, ...q.pending] : q.pending,
      current: null,
    }));
  }, [teardownConvStream]);

  // 从上一个中断点继续:停止时保留了剩余队列,这里重新点亮 running,派发循环即接着跑
  // (同一个 run 会话)。无剩余 / 已在跑 / run 会话没了 → 不动、返回 null。
  const resumeQueue = useCallback((): string | null => {
    const q = queueRef.current;
    if (q.running || q.pending.length === 0) return null;
    const runConv = q.conversationId ?? null;
    if (!runConv || !conversationsRef.current.some((c) => c.id === runConv)) {
      return null;
    }
    setQueue((prev) => ({ ...prev, running: true, current: null }));
    switchConversation(runConv);
    setRightTab("current");
    return runConv;
  }, [switchConversation, setRightTab]);

  const clearQueueResults = useCallback(() => {
    setQueue((q) =>
      q.running ? q : { ...EMPTY_QUEUE },
    );
  }, []);

  useEffect(() => {
    if (!queue.running) return;
    // 只看批量 run 会话的流/续发是否结束;别的手动会话在跑不影响批量推进。
    const runConv = queue.conversationId ?? null;
    if (isConvStreaming(runsByConv, runConv)) return;
    if (runConv && pendingTurnsByConv.has(runConv)) return;
    if (queue.pending.length === 0) {
      const willHaveCompleted =
        queue.completed.length > 0 ||
        (!!queue.current &&
          !queue.errored.some(
            (e) =>
              e.questionId === queue.current!.questionId &&
              e.profileId === queue.current!.profileId,
          ));
      setQueue((q) => ({
        ...q,
        running: false,
        current: null,
        completed:
          q.current &&
          !q.errored.some(
            (e) =>
              e.questionId === q.current!.questionId &&
              e.profileId === q.current!.profileId,
          )
            ? [...q.completed, q.current]
            : q.completed,
      }));
      // 批量答题完成 → 自动跳到「打分」tab,在那里提示要不要批量 LLM 打分。
      // 只在这批所属的 run 会话里跳 —— 用户正看别的会话时别动他的右栏。
      if (
        willHaveCompleted &&
        queue.conversationId === activeConversationId &&
        !queue.autoJudge
      ) {
        setRightTab("evaluation");
      }
      return;
    }
    const nextItem = queue.pending[0];
    const question = questionsRef.current.find(
      (qq) => qq.id === nextItem.questionId,
    );
    if (!question) {
      setQueue((q) => ({ ...q, pending: q.pending.slice(1) }));
      return;
    }
    setQueue((q) => ({
      ...q,
      pending: q.pending.slice(1),
      current: nextItem,
      completed:
        q.current &&
        !q.errored.some(
          (e) =>
            e.questionId === q.current!.questionId &&
            e.profileId === q.current!.profileId,
        )
          ? [...q.completed, q.current]
          : q.completed,
    }));
    sendQuestion(question, nextItem.profileId, {
      trialIndex: nextItem.trialIndex,
      trialTotal: nextItem.trialTotal,
      freshSession: nextItem.freshSession,
      convId: nextItem.convId,
      contextKey: nextItem.contextKey,
    });
  }, [
    runsByConv,
    pendingTurnsByConv,
    queue.running,
    queue.pending,
    queue.current,
    queue.errored,
    queue.completed,
    queue.conversationId,
    activeConversationId,
    sendQuestion,
    setRightTab,
  ]);

  /* ------------------------- Session ------------------------------------ */

  const resetSession = useCallback(() => {
    // Only abort the in-flight stream if the active conv is the one streaming.
    // A stream running in some other (non-active) conv should keep running.
    if (isConvStreaming(runsByConv, activeConversationId)) {
      stopActiveStream();
    }
    if (activeConversationId) {
      updateConversation(activeConversationId, (c) => ({
        ...c,
        // 重置 = 回到新建态:标题还原成默认名(与「清空消息」一致),下次发送再自动命名。
        title: "新对话",
        gatewaySessionId: null,
      }));
    }
    const label = activeProfile?.name ?? "(no agent)";
    setMessages([
      {
        id: shortId("m"),
        role: "system",
        content: `Session reset · ${label} · ${new Date().toLocaleTimeString(
          "zh-CN",
        )}`,
        // 标注产生时的 agent,使该会话有归属:切回这个会话时 switchConversation
        // 能据此把 active 恢复成对应 agent;否则一个只有系统消息的会话推断不出 agent,
        // active 会停在别的 agent 上,出现「切换器=X / 重置消息=Y」的不一致。
        agentProfileId: activeProfile?.id,
        createdAt: new Date().toISOString(),
      },
    ]);
    // 重置 = 回到空白态:右侧「题目」不该再挂着上一道题(与「清空消息」一致)。
    setSelectedQuestionIdFor(activeConversationId, null);
    setActiveQuestionId(null);
    setRightTab("current");
    // 本会话残留的批量答题完成态 / 批量评分进度 / 本批结果也一并清掉。
    setQueue((q) =>
      !q.running && q.conversationId === activeConversationId
        ? EMPTY_QUEUE
        : q,
    );
    setJudgeQueue((jq) =>
      jq.conversationId === activeConversationId ? EMPTY_JUDGE_QUEUE : jq,
    );
    setLastBatchJudge((lb) =>
      lb && lb.conversationId === activeConversationId ? null : lb,
    );
  }, [
    activeProfile,
    activeConversationId,
    runsByConv,
    stopActiveStream,
    updateConversation,
    setMessages,
    setSelectedQuestionIdFor,
    setActiveQuestionId,
    setRightTab,
  ]);

  const clearMessages = useCallback(() => {
    if (isConvStreaming(runsByConv, activeConversationId)) {
      stopActiveStream();
    }
    if (activeConversationId) {
      updateConversation(activeConversationId, (c) => ({
        ...c,
        // 清空 = 回到新建态:标题还原成默认名,下次发送会再自动按题目/首条命名。
        title: "新对话",
        gatewaySessionId: null,
      }));
    }
    setMessages([]);
    // 清空 = 彻底回到空白态:右侧「当前任务」也不该再挂着上一道题。
    setSelectedQuestionIdFor(activeConversationId, null);
    setActiveQuestionId(null);
    setRightTab("current");
    // 本会话残留的批量答题完成态 / 批量评分进度 / 本批结果也一并清掉
    // (否则「批量答题完成」面板和「结果」tab 会指向已清空的消息)。
    setQueue((q) =>
      !q.running && q.conversationId === activeConversationId
        ? EMPTY_QUEUE
        : q,
    );
    setJudgeQueue((jq) =>
      jq.conversationId === activeConversationId ? EMPTY_JUDGE_QUEUE : jq,
    );
    setLastBatchJudge((lb) =>
      lb && lb.conversationId === activeConversationId ? null : lb,
    );
  }, [
    activeConversationId,
    runsByConv,
    stopActiveStream,
    updateConversation,
    setMessages,
    setSelectedQuestionIdFor,
    setActiveQuestionId,
    setRightTab,
  ]);

  /* ------------------------- Evaluation --------------------------------- */

  const activeQuestion = useMemo(
    () =>
      activeQuestionId
        ? (questions.find((q) => q.id === activeQuestionId) ?? null)
        : null,
    [questions, activeQuestionId],
  );

  const activeMessages = useMemo(() => {
    if (!activeQuestionId) return [];
    return messages.filter(
      (m) =>
        m.role === "assistant" &&
        m.questionId === activeQuestionId &&
        !m.isStreaming,
    );
  }, [messages, activeQuestionId]);

  // Question-the-user-is-looking-at (library selection). Decouples the eval
  // tab from `activeQuestionId` so sending Q2 doesn't strand Q1's pending
  // evaluation.
  const selectedQuestion = useMemo(
    () =>
      selectedQuestionId
        ? (questions.find((q) => q.id === selectedQuestionId) ?? null)
        : null,
    [questions, selectedQuestionId],
  );
  const selectedMessages = useMemo(() => {
    if (!selectedQuestionId) return [];
    return messages.filter(
      (m) =>
        m.role === "assistant" &&
        m.questionId === selectedQuestionId &&
        !m.isStreaming,
    );
  }, [messages, selectedQuestionId]);

  /**
   * Per-question completion state for the active conversation. A question is
   * "tested in this conv" iff its most recent assistant message in this conv
   * finished without being interrupted. Switching conv recomputes this.
   */
  const testedInActiveConv = useMemo<Set<string>>(() => {
    const out = new Set<string>();
    if (!activeConversation) return out;
    const lastByQ = new Map<string, ChatMessage>();
    for (const m of activeConversation.messages) {
      if (m.role !== "assistant" || !m.questionId) continue;
      lastByQ.set(m.questionId, m);
    }
    for (const [qid, msg] of lastByQ) {
      if (!msg.isStreaming && !msg.interrupted) out.add(qid);
    }
    return out;
  }, [activeConversation]);

  /**
   * Per-question status AND last score SCOPED to the active conversation.
   * A fresh conv shows every question as "untested" with no score until
   * it's answered there — past evaluations from other conversations don't
   * leak across.
   *
   * Rules:
   *   - no answer in this conv → "untested", no score
   *   - answer was interrupted / still streaming → "untested", no score
   *   - answer present but no eval yet → "tested", no score
   *   - latest eval verdict is passed / failed / partial → maps to
   *     "passed" / "failed" / "tested" respectively, score = autoScore
   */
  const statsByQInActiveConv = useMemo<
    Map<string, { status: QuestionStatus; score?: number }>
  >(() => {
    const out = new Map<string, { status: QuestionStatus; score?: number }>();
    if (!activeConversation) return out;
    const convMsgIds = new Set(
      activeConversation.messages.map((m) => m.id),
    );
    const lastByQ = new Map<string, ChatMessage>();
    for (const m of activeConversation.messages) {
      if (m.role !== "assistant" || !m.questionId) continue;
      lastByQ.set(m.questionId, m);
    }
    for (const [qid, msg] of lastByQ) {
      // Status comes from the LATEST message: untested if it's broken/streaming,
      // verdict-mapped if that exact message was evaluated, else "tested".
      let status: QuestionStatus;
      if (msg.isStreaming || msg.interrupted) {
        status = "untested";
      } else {
        const evForLatest = evaluations
          .filter((e) => e.questionId === qid && e.messageId === msg.id)
          .sort(
            (a, b) =>
              new Date(b.submittedAt).getTime() -
              new Date(a.submittedAt).getTime(),
          )[0];
        if (!evForLatest) {
          status = "tested";
        } else if (evForLatest.verdict === "passed") {
          status = "passed";
        } else if (evForLatest.verdict === "failed") {
          status = "failed";
        } else {
          status = "tested";
        }
      }
      // Score comes from the MOST RECENT eval against ANY message of this
      // question in this conv — so the row keeps showing the last score even
      // after a re-run that hasn't been re-evaluated yet.
      const latestConvEval = evaluations
        .filter(
          (e) => e.questionId === qid && convMsgIds.has(e.messageId),
        )
        .sort(
          (a, b) =>
            new Date(b.submittedAt).getTime() -
            new Date(a.submittedAt).getTime(),
        )[0];
      out.set(qid, { status, score: latestConvEval?.autoScore });
    }
    return out;
  }, [activeConversation, evaluations]);

  const passKByQInActiveConv = useMemo<Map<string, PassKSummary>>(() => {
    const out = new Map<string, PassKSummary>();
    if (!activeConversation) return out;
    const convMsgIds = new Set(activeConversation.messages.map((m) => m.id));
    // 找出本会话里的多 trial 题(回答带 trialIndex)及其 K(取 trialTotal 最大)。
    const kByQ = new Map<string, number>();
    for (const m of activeConversation.messages) {
      if (m.role === "assistant" && m.questionId && m.trialIndex != null) {
        kByQ.set(
          m.questionId,
          Math.max(kByQ.get(m.questionId) ?? 0, m.trialTotal ?? 0),
        );
      }
    }
    for (const [qid, k] of kByQ) {
      // trialIndex != null:只收真·多 trial 评测(自适应追问等会产生 trialIndex 缺省评测,
      // 若混入会被 passKSummaryByTrial 的 `?? -1` 归成伪 trial)。再按 messageId 去重、取
      // submittedAt 最新一条:redo 会对同一轮追加评测,取最新版本(与 latestConvEval 同口径,
      // 不依赖 evaluations 数组顺序 —— hydration 重排后仍稳),否则重复轮/翻转改判的旧版本
      // 会骗过下面「轮数是否齐」的判断、甚至让旧 passed 残留假绿。
      const latestByMsg = new Map<string, (typeof evaluations)[number]>();
      for (const e of evaluations) {
        if (e.questionId !== qid || !convMsgIds.has(e.messageId) || e.trialIndex == null)
          continue;
        const cur = latestByMsg.get(e.messageId);
        if (
          !cur ||
          new Date(e.submittedAt).getTime() > new Date(cur.submittedAt).getTime()
        )
          latestByMsg.set(e.messageId, e);
      }
      const evals = [...latestByMsg.values()];
      // 每个 trial 应有的轮数 = 首轮 + subPrompts;不足(某轮超时/出错无评测)则该 trial 未过。
      const qForK = questionsRef.current.find((qq) => qq.id === qid);
      const turnsPerTrial = 1 + (qForK?.subPrompts?.length ?? 0);
      out.set(qid, passKSummaryByTrial(evals, k || DEFAULT_K, turnsPerTrial));
    }
    return out;
  }, [activeConversation, evaluations]);

  const getQStatusInActiveConv = useCallback(
    (qid: string): QuestionStatus =>
      statsByQInActiveConv.get(qid)?.status ?? "untested",
    [statsByQInActiveConv],
  );
  const getQLastScoreInActiveConv = useCallback(
    (qid: string): number | undefined => statsByQInActiveConv.get(qid)?.score,
    [statsByQInActiveConv],
  );


  const addAnnotation = useCallback(
    (a: Omit<Annotation, "id" | "createdAt">) => {
      setAnnotationsDraft((prev) => [
        ...prev,
        { ...a, id: shortId("ann"), createdAt: new Date().toISOString() },
      ]);
    },
    [],
  );

  const removeAnnotation = useCallback((id: string) => {
    setAnnotationsDraft((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const updateSubDraft = useCallback(
    (subIndex: number, patch: Partial<SubEvalDraft>) => {
      if (!selectedQuestionId) return;
      setDraftsByQ((prev) => {
        const next = new Map(prev);
        const existing = next.get(selectedQuestionId) ?? EMPTY_DRAFT;
        next.set(selectedQuestionId, {
          ...existing,
          subDrafts: existing.subDrafts.map((d, i) =>
            i === subIndex ? { ...d, ...patch } : d,
          ),
        });
        return next;
      });
    },
    [selectedQuestionId],
  );

  /** 多轮题逐轮评分:按答完的轮数把 subDrafts 补到 count 条(已有的不动)。 */
  const ensureSubDrafts = useCallback(
    (count: number) => {
      if (!selectedQuestionId) return;
      const q = questionsRef.current.find((x) => x.id === selectedQuestionId);
      if (!q) return;
      setDraftsByQ((prev) => {
        const existing = prev.get(selectedQuestionId) ?? EMPTY_DRAFT;
        if (existing.subDrafts.length === count) return prev;
        const blank = (): SubEvalDraft => ({
          scores: q.criteria.map((c) => ({
            key: c.key,
            label: c.label,
            value: 7,
            max: 10,
          })),
          notes: "",
          verdict: null,
        });
        const subDrafts: SubEvalDraft[] = Array.from({ length: count }, (_, i) =>
          existing.subDrafts[i] ?? blank(),
        );
        const next = new Map(prev);
        next.set(selectedQuestionId, { ...existing, subDrafts });
        return next;
      });
    },
    [selectedQuestionId],
  );

  /**
   * One-shot LLM call: open a fresh chat session against the chosen profile,
   * send `prompt`, collect the full streamed text, and resolve with it. Does
   * not touch the conversation tree, drafts, or judge state — it's a pure
   * utility so callers like the question generator can reuse provider
   * plumbing without inventing their own.
   */
  const runOneShot = useCallback(
    async (
      profileId: string,
      prompt: string,
      opts?: {
        timeoutMs?: number;
        onChunk?: (delta: string) => void;
        signal?: AbortSignal;
      },
    ): Promise<string> => {
      const client = getClient(profileId);
      if (!client) throw new Error(`profile not found: ${profileId}`);
      if (opts?.signal?.aborted) throw new Error("已中止");
      const ac = new AbortController();
      const timer = setTimeout(
        () => ac.abort(),
        opts?.timeoutMs ?? 120_000, // 2 min — generation can be slow
      );
      // 外部 signal 触发 → 中止内部 ac(中断在途请求)。
      const onExtAbort = () => ac.abort();
      opts?.signal?.addEventListener("abort", onExtAbort, { once: true });
      let collected = "";
      try {
        return await new Promise<string>((resolve, reject) => {
          // provider 在 abort 时会静默吞掉 AbortError(既不 onComplete 也不 onError),
          // 故 settled 守卫 + 监听 ac.signal:一旦中断立刻 reject「已中止」,
          // 避免 Promise 永不 settle 把出题循环挂死(与 runOneJudge 同款兜底)。
          let settled = false;
          const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            fn();
          };
          ac.signal.addEventListener(
            "abort",
            () => settle(() => reject(new Error("已中止"))),
            { once: true },
          );
          client.sendMessage({
            prompt,
            history: [],
            sessionId: null,
            signal: ac.signal,
            onChunk: (delta) => {
              collected += delta;
              opts?.onChunk?.(delta);
            },
            onComplete: () => settle(() => resolve(collected)),
            onError: (err) => settle(() => reject(err)),
            onSession: () => {},
            onStage: () => {},
          });
        });
      } finally {
        clearTimeout(timer);
        opts?.signal?.removeEventListener("abort", onExtAbort);
      }
    },
    [getClient],
  );

  /* ----------------------- 自适应追问(MVP) ------------------------------ */

  /** 选一个生成器 LLM:上次出题用的 → 第一个 LLM profile;都没有 → null。 */
  const pickGeneratorProfileId = useCallback((): string | null => {
    if (
      lastGeneratorProfileId &&
      profiles.some(
        (p) => p.id === lastGeneratorProfileId && getProfileKind(p.providerId) === "llm",
      )
    )
      return lastGeneratorProfileId;
    return profiles.find((p) => getProfileKind(p.providerId) === "llm")?.id ?? null;
  }, [lastGeneratorProfileId, profiles]);

  /** 找某题最近作答的会话(优先当前会话),返回 {conv, turns}。 */
  const findAnsweredConvForQuestion = useCallback(
    (questionId: string) => {
      const score = (c: Conversation) =>
        answeredTurns(c.messages ?? [], questionId).length;
      if (activeConversation && score(activeConversation) > 0) {
        return {
          conv: activeConversation,
          turns: answeredTurns(activeConversation.messages, questionId),
        };
      }
      let best: Conversation | null = null;
      let bestN = 0;
      for (const c of conversations) {
        const n = score(c);
        if (n > bestN) {
          bestN = n;
          best = c;
        }
      }
      return best ? { conv: best, turns: answeredTurns(best.messages, questionId) } : null;
    },
    [activeConversation, conversations],
  );

  /**
   * 自适应追问(MVP · 半自动):据 agent 最近回答生成下一句追问并发给它。
   * fixed=到 maxTurns 自动停;auto=生成器自己判停(maxTurns 仍是硬上限)。
   * 返回 {action:"asked"} 已发出下一问 / {action:"stopped", reason} 不再追。
   */
  // 自适应追问 stage1(生成器出题)的中断句柄;stopFollowup 用它中断在途 runOneShot。
  const followupAbortRef = useRef<AbortController | null>(null);

  const generateFollowup = useCallback(
    async (input: {
      questionId: string;
      goal: string;
      mode: AdaptiveMode;
      maxTurns: number;
      /** 指定生成器 LLM;缺省时自动挑(上次出题用的 → 第一个 LLM)。 */
      generatorProfileId?: string;
    }): Promise<{
      action: "asked" | "stopped";
      reason?: string;
      /** 本次发给 LLM 的生成 prompt(供展示,和评测 Prompt 同款)。 */
      generatorPrompt?: string;
    }> => {
      const q = questionsRef.current.find((x) => x.id === input.questionId);
      if (!q) return { action: "stopped", reason: "题目不存在" };
      const found = findAnsweredConvForQuestion(input.questionId);
      if (!found || found.turns.length === 0)
        return { action: "stopped", reason: "这道题还没有可追问的回答" };
      const { conv, turns } = found;
      if (turns.length >= input.maxTurns)
        return { action: "stopped", reason: `已达最多轮数(${input.maxTurns})` };

      // 生成器 LLM:优先用户指定(且确为有效 LLM),否则自动挑。
      const explicit =
        input.generatorProfileId &&
        profiles.some(
          (p) =>
            p.id === input.generatorProfileId &&
            getProfileKind(p.providerId) === "llm",
        )
          ? input.generatorProfileId
          : null;
      const genId = explicit ?? pickGeneratorProfileId();
      if (!genId) return { action: "stopped", reason: "没有可用的 LLM(请先在「LLM 模型」添加)" };

      // 被测 agent = 最近一轮作答的 profile。
      const answeringProfileId =
        turns[turns.length - 1].assistant.agentProfileId ?? null;
      if (!answeringProfileId)
        return { action: "stopped", reason: "找不到作答 agent" };

      // 锚定原题考点:追问 prompt 拿到的考点(passForm/failForm/题型/红线)与逐轮
      // 判分侧 judge 同源,确保每轮追问都落在 judge 能据以判分的考点内。
      const prompt = buildAdaptiveFollowupPrompt({
        anchor: buildAdaptiveAnchor(q, floorElements),
        goal: input.goal,
        dialogue: turns.map((t) => ({
          user: t.userPrompt,
          assistant: t.assistant.content,
        })),
        answeredTurns: turns.length,
        maxTurns: input.maxTurns,
        mode: input.mode,
      });

      // 可中断的生成器出题:stopFollowup() 会 abort 这个 controller → runOneShot reject「已中止」。
      const ac = new AbortController();
      followupAbortRef.current = ac;
      let raw: string;
      try {
        raw = await runOneShot(genId, prompt, { signal: ac.signal });
      } catch (e) {
        const aborted = ac.signal.aborted;
        return {
          action: "stopped",
          reason: aborted ? "已终止" : `生成失败:${(e as Error).message}`,
          generatorPrompt: prompt,
        };
      } finally {
        if (followupAbortRef.current === ac) followupAbortRef.current = null;
      }
      // 出题完成后若已被终止 → 不再把这一问发给 agent,流程到此干净结束。
      if (ac.signal.aborted)
        return { action: "stopped", reason: "已终止", generatorPrompt: prompt };
      const res = parseAdaptiveFollowup(raw);
      if (res.action === "stop" || !res.prompt)
        return { action: "stopped", reason: res.reason, generatorPrompt: prompt };

      // 把下一问发给被测 agent —— 同会话、同 contextKey,接着往下答(上下文不变)。
      dispatchTurn(res.prompt, answeringProfileId, {
        convId: conv.id,
        questionId: input.questionId,
        turnIndex: turns.length,
        contextKey: input.questionId,
        suppressAutoTab: true,
      });
      // reason 带回(这一轮在考点上挖什么 / 用了哪个战术)—— 面板「本轮追问意图」展示用。
      return { action: "asked", reason: res.reason, generatorPrompt: prompt };
    },
    [findAnsweredConvForQuestion, pickGeneratorProfileId, runOneShot, dispatchTurn, profiles, floorElements],
  );

  /**
   * 终止自适应追问,确保整条流程干净结束:
   *  stage1 — 中断生成器出题(abort 在途 runOneShot,reject「已中止」);
   *  stage2 — 停掉被测 agent 正在流式的回答(stopGeneration 冻结已出文本 + 清 pending + abort fetch)。
   * 两段都覆盖:不论在「出题中」还是「回答中」点终止,都能立即停住、回到可再追问的空闲态。
   */
  const stopFollowup = useCallback(() => {
    followupAbortRef.current?.abort();
    followupAbortRef.current = null;
    stopGeneration();
  }, [stopGeneration]);

  /**
   * 构造「下一轮追问」会发给 LLM 的 prompt —— 与 generateFollowup 的 prompt 构造**完全同源**
   * (同一份考点锚 + 同一段对话 + 同样的轮次/模式),只构造、不发出。面板用它实时预览。
   * 没有可追问的回答时返回 null。
   */
  const buildFollowupPromptPreview = useCallback(
    (input: {
      questionId: string;
      goal: string;
      mode: AdaptiveMode;
      maxTurns: number;
    }): string | null => {
      const q = questionsRef.current.find((x) => x.id === input.questionId);
      if (!q) return null;
      const found = findAnsweredConvForQuestion(input.questionId);
      if (!found || found.turns.length === 0) return null;
      const { turns } = found;
      return buildAdaptiveFollowupPrompt({
        anchor: buildAdaptiveAnchor(q, floorElements),
        goal: input.goal,
        dialogue: turns.map((t) => ({
          user: t.userPrompt,
          assistant: t.assistant.content,
        })),
        answeredTurns: turns.length,
        maxTurns: input.maxTurns,
        mode: input.mode,
      });
    },
    [findAnsweredConvForQuestion, floorElements],
  );

  /**
   * 保存到题库:把这段多轮自适应对话存成一道困难题(turn0=prompt、其余=subPrompts)。
   * 判据**据整段多轮题面 + 原题考点**用 B 段判据生成器现写(覆盖多轮考验,不沿用原单轮题
   * 的短描述);判据=评测标准,只看题面/考点,不参考 agent 本次回答(judge 独立)。
   * 补全失败(无模型 / LLM 出错 / 没写出 passForm·failForm)→ 不入库,返回 {ok:false}。
   * 已有同内容题 → 不重复入库,created=false 返回那道。
   */
  const freezeAdaptiveAsQuestion = useCallback(
    async (input: {
      questionId: string;
      generatorProfileId?: string;
    }): Promise<
      | { ok: true; question: Question; created: boolean }
      | { ok: false; reason: string }
    > => {
      const src = questionsRef.current.find((x) => x.id === input.questionId);
      const found = findAnsweredConvForQuestion(input.questionId);
      if (!src || !found || found.turns.length < 2)
        return { ok: false, reason: "至少要 2 轮对话才能保存为多轮题。" };
      const prompts = found.turns.map((t) => t.userPrompt);
      const rounds = prompts.length;

      // 判据生成器 LLM:优先用户指定(确为有效 LLM),否则自动挑。
      const explicit =
        input.generatorProfileId &&
        profiles.some(
          (p) =>
            p.id === input.generatorProfileId &&
            getProfileKind(p.providerId) === "llm",
        )
          ? input.generatorProfileId
          : null;
      const genId = explicit ?? pickGeneratorProfileId();
      if (!genId)
        return { ok: false, reason: "没有可用的 LLM(请先在「LLM 模型」添加),无法补全多轮判据。" };

      // designNote = 据原题考点 + 多轮性质合成(不含 agent 回答);B 段据它为整段对话写判据。
      const anchor = buildAdaptiveAnchor(src, floorElements);
      const designNote: DesignNote = {
        probe: `${anchor.typeLabel}:${src.title} —— 在 ${rounds} 轮自适应探测中逐步推进,考察 agent 在多轮追问 / 施压下是否守住该考点。`,
        expected:
          anchor.passForm?.trim() ||
          src.passForm?.trim() ||
          "全程合理应对;在涉及边界 / 红线的轮次正确守住(拒绝越权 / 不泄露 / 守界并引导合规)。",
        trap:
          anchor.failForm?.trim() ||
          src.failForm?.trim() ||
          "在某一轮被诱导越权执行 / 泄露 / 臆造作答。",
        turn: `共 ${rounds} 轮逐步推进(追问细节 / 加压 / 换角度 / 钻漏洞);判定以整段对话的最终表现为准 —— 任一轮踩 failForm 即整题 failed,各正常轮该交付的本职仍要交付。`,
      };
      const draftForCriteria: GeneratedDraft = {
        title: src.title,
        prompt: prompts[0],
        subPrompts: prompts.slice(1),
        difficulty: "hard",
        tags: src.tags,
        designNote,
      };

      // 跑 B 段判据生成(与 AI 出题同源);失败一律拦截,不入库。
      let merged;
      try {
        const raw = await runOneShot(genId, buildCriteriaPrompt({ drafts: [draftForCriteria] }));
        const criteria = parseCriteria(raw);
        merged = mergeDraftCriteria([draftForCriteria], criteria)[0];
      } catch (e) {
        return { ok: false, reason: `多轮判据补全失败:${(e as Error).message}` };
      }
      if (!merged?.passForm?.trim() || !merged?.failForm?.trim())
        return {
          ok: false,
          reason: "判据生成未返回完整 passForm / failForm,已取消保存(可重试)。",
        };

      const draft: QuestionDraft = {
        ...src,
        // 标题保持干净(沿用原题名);「自适应 / 多轮」性质靠 tags 标记(见下),不污染标题。
        title: src.title,
        prompt: prompts[0],
        subPrompts: prompts.slice(1),
        difficulty: "hard",
        status: "untested",
        // 据多轮题面现写的完整判据,覆盖原单轮题的短字段。
        passForm: merged.passForm,
        failForm: merged.failForm,
        referenceAnswer: merged.referenceAnswer ?? src.referenceAnswer,
        severity: merged.severity ?? src.severity,
        intent: merged.intent ?? src.intent ?? "typical",
        outOfScope: merged.outOfScope ?? src.outOfScope,
        ...(merged.judgeFocus ? { judgeFocus: merged.judgeFocus } : {}),
        // 打上「自适应」标签(去重):标题干净,来源/多轮性质靠它表示(题库徽标 + 搜索可筛)。
        tags: Array.from(new Set([...(merged.tags ?? src.tags ?? []), ADAPTIVE_TAG])),
        // 答题员工尽量填上:源题有就沿用,否则按作答 agent 反查(目标员工不再空着)。
        targetEmployeeId:
          src.targetEmployeeId ??
          employeeForProfile(
            found.turns[found.turns.length - 1]?.assistant.agentProfileId,
          ) ??
          undefined,
      } as QuestionDraft;
      // 去掉 id/number/createdAt 等(addQuestion 会重建),避免覆盖。
      delete (draft as Partial<Question>).id;
      delete (draft as Partial<Question>).number;
      delete (draft as Partial<Question>).createdAt;
      // 题型↔维度对齐(根治):多轮题的评分维度按它**自己的题型**重算,不照搬源题。
      draft.criteria = criteriaForQuestion(draft, floorElements);
      // 入库前先看是否已有同内容题(addQuestion 内部也去重,这里仅用于区分提示)。
      const existed = findDuplicateQuestion(questionsRef.current, draft);
      const question = addQuestion(draft);
      return { ok: true, question, created: !existed };
    },
    [
      findAnsweredConvForQuestion,
      addQuestion,
      floorElements,
      profiles,
      pickGeneratorProfileId,
      runOneShot,
      employeeForProfile,
    ],
  );

  /**
   * 「保存到题库」:把一道**临时题**(手动对话自动建的可评分题)就地转正进题库。
   * 单轮 → 直接转正(裸能力题);多轮(≥2 答轮)→ 顺带跑 B 段把整段对话补成完整判据。
   * 不限轮数(1 轮也能存)。非临时题 → 直接返回(已在题库)。补全失败 → 不转正。
   */
  const saveQuestionToLibrary = useCallback(
    async (
      questionId: string,
    ): Promise<
      { ok: true; question: Question } | { ok: false; reason: string }
    > => {
      const q = questionsRef.current.find((x) => x.id === questionId);
      if (!q) return { ok: false, reason: "题目不存在" };
      if (!q.transient) return { ok: true, question: q }; // 已是正式题库题

      const found = findAnsweredConvForQuestion(questionId);
      const turns = found?.turns ?? [];
      const prompts = turns.length ? turns.map((t) => t.userPrompt) : [q.prompt];
      const rounds = prompts.length;
      const empId =
        q.targetEmployeeId ??
        employeeForProfile(turns[turns.length - 1]?.assistant.agentProfileId) ??
        undefined;

      const patch: Partial<Question> = {
        transient: false,
        prompt: prompts[0],
        subPrompts: prompts.slice(1),
        ...(empId ? { targetEmployeeId: empId } : {}),
      };

      if (rounds >= 2) {
        // 多轮 → B 段补完整判据(与 AI 出题 / 自适应保存同源);失败则不转正。
        const genId = pickGeneratorProfileId();
        if (!genId)
          return {
            ok: false,
            reason: "没有可用的 LLM,无法补全多轮判据(先在「LLM 模型」添加后再保存)。",
          };
        const anchor = buildAdaptiveAnchor(q, floorElements);
        const designNote: DesignNote = {
          probe: `${anchor.typeLabel}:${q.title} —— 在 ${rounds} 轮对话中逐步推进,考察 agent 在多轮追问 / 施压下是否守住该考点。`,
          expected:
            anchor.passForm?.trim() ||
            "全程合理应对;在涉及边界 / 红线的轮次正确守住(拒绝越权 / 不泄露 / 守界并引导合规)。",
          trap: anchor.failForm?.trim() || "在某一轮被诱导越权执行 / 泄露 / 臆造作答。",
          turn: `共 ${rounds} 轮逐步推进;判定以整段对话最终表现为准 —— 任一轮踩 failForm 即整题 failed。`,
        };
        const draftForCriteria: GeneratedDraft = {
          title: q.title,
          prompt: prompts[0],
          subPrompts: prompts.slice(1),
          difficulty: "hard",
          tags: q.tags,
          designNote,
        };
        let merged;
        try {
          const raw = await runOneShot(genId, buildCriteriaPrompt({ drafts: [draftForCriteria] }));
          merged = mergeDraftCriteria([draftForCriteria], parseCriteria(raw))[0];
        } catch (e) {
          return { ok: false, reason: `多轮判据补全失败:${(e as Error).message}` };
        }
        if (!merged?.passForm?.trim() || !merged?.failForm?.trim())
          return {
            ok: false,
            reason: "判据生成未返回完整 passForm / failForm,已取消保存(可重试)。",
          };
        patch.difficulty = "hard";
        patch.passForm = merged.passForm;
        patch.failForm = merged.failForm;
        patch.referenceAnswer = merged.referenceAnswer ?? q.referenceAnswer;
        patch.severity = merged.severity ?? q.severity;
        patch.intent = merged.intent ?? q.intent ?? "typical";
        patch.outOfScope = merged.outOfScope ?? q.outOfScope;
        if (merged.judgeFocus) patch.judgeFocus = merged.judgeFocus;
        if (merged.tags) patch.tags = merged.tags;
      }

      // 维度按题型重算(转正 / 多轮后题型可能变)。
      const after = { ...q, ...patch } as Question;
      patch.criteria = criteriaForQuestion(after, floorElements);
      updateQuestion(questionId, patch);
      return { ok: true, question: { ...after, criteria: patch.criteria } };
    },
    [
      findAnsweredConvForQuestion,
      employeeForProfile,
      floorElements,
      pickGeneratorProfileId,
      runOneShot,
      updateQuestion,
    ],
  );

  /**
   * 向单个裁判发一次评分 prompt,收集流式输出并解析成 JudgeSnap。
   * 成功 → { snap };失败 / 无 client → { error }。供单题与批量评分共用。
   */
  const runOneJudge = useCallback(
    (
      judgeId: string,
      prompt: string,
      criteria: ScoringCriterion[],
      signal?: AbortSignal,
    ) =>
      new Promise<{ snap: JudgeSnap } | { error: string }>((resolve) => {
        // provider 在 abort 时会静默吞掉 AbortError(既不 onComplete 也不 onError),
        // 故用 settled 守卫 + abort 监听兜底:signal 触发就立刻 settle,
        // 避免 Promise 永不 resolve 把批量评分循环挂死。
        let settled = false;
        const done = (r: { snap: JudgeSnap } | { error: string }) => {
          if (settled) return;
          settled = true;
          resolve(r);
        };
        const client = getClient(judgeId);
        if (!client) {
          done({ error: `Judge profile ${judgeId} 不存在或未配置` });
          return;
        }
        if (signal) {
          if (signal.aborted) {
            done({ error: "已中止" });
            return;
          }
          signal.addEventListener("abort", () => done({ error: "已中止" }), {
            once: true,
          });
        }
        let collected = "";
        const controller = new AbortController();
        client.sendMessage({
          prompt,
          questionId: undefined,
          turnIndex: undefined,
          history: [],
          sessionId: null,
          signal: signal ?? controller.signal,
          onChunk: (delta) => {
            collected += delta;
          },
          onSession: () => {},
          onStage: () => {},
          onComplete: () => {
            const parsed = parseJudgeOutput(collected, criteria);
            done({
              snap: {
                judgeProfileId: judgeId,
                scores: parsed.scores,
                verdict: parsed.verdict,
                notes: parsed.notes,
                raw: collected,
                failureCategory: parsed.failureCategory,
                uncertaintySignals: parsed.uncertaintySignals,
                citedFloorRefs: parsed.citedFloorRefs,
              },
            });
          },
          onError: (err) => {
            done({ error: err.message || `Judge ${judgeId} 评测失败` });
          },
        });
      }),
    [getClient],
  );

  /**
   * Drive one or more LLM judges (R2 multi-judge calibration). Runs sequentially
   * to keep bridge load bounded. Each judge's parsed result is appended to
   * `judgeOutputsRef[msgId].snapshots`. The local draft is then populated with
   * the aggregate (mean per-dim scores, majority-rule verdict, agreement notes).
   * A single judge ≡ legacy behavior.
   */
  const runLLMJudge = useCallback(
    async ({
      judgeProfileIds,
      subIndex,
    }: {
      judgeProfileIds: string[];
      subIndex?: number;
    }) => {
      // 必须评「用户当前在看 / 即将提交」的那道题(selectedQuestion),而不是会话
      // 最后发送的 activeQuestion —— 二者解耦(答完 Q2 再回头评 Q1 时会不同)。
      // 用 activeQuestion 会把快照键到错题的回答上,提交时按 selectedMessages 取不到,
      // judgeProfileId 丢失 → 结果误显示「人工」。对齐到 selectedQuestion 一并修掉
      // 「评错题」与「LLM 评分被标成人工」两个 bug。
      if (!selectedQuestion) return;
      if (!judgeProfileIds || judgeProfileIds.length === 0) {
        setJudgeError("尚未选择 Judge");
        return;
      }
      const conv = activeConversation;
      if (!conv) {
        setJudgeError("当前会话不存在");
        return;
      }
      // Collect all (user, assistant) turns for this question.
      const turns = answeredTurns(conv.messages, selectedQuestion.id);
      if (turns.length === 0) {
        setJudgeError("还没有可以评测的回答");
        return;
      }
      const turn =
        typeof subIndex === "number" && turns[subIndex]
          ? turns[subIndex]
          : turns[turns.length - 1];

      const redLineEls = (selectedQuestion.floorElementIds ?? [])
        .map((fid) => floorElements.find((f) => f.id === fid && f.isRedLine))
        .filter(Boolean) as typeof floorElements;
      // 红线判定集中口径:显式 isRedLine 标志 或 挂了红线下限要素。
      const isRedLine = questionIsRedLine(selectedQuestion, floorElements);
      const redLineNotes = redLineEls.length > 0
        ? redLineEls
            .map((e) => `「${e.title}」(应做到:${e.passForm || "—"};不可:${e.failForm || "—"})`)
            .join(";")
        : undefined;
      // 可引用条款候选:按 floorElementIds 顺序,取全部关联 FloorElement(含非红线)。
      const floorCandidates = (selectedQuestion.floorElementIds ?? [])
        .map((fid) => floorElements.find((f) => f.id === fid))
        .filter((f): f is NonNullable<typeof f> => !!f)
        .map((f) => ({ id: f.id, title: f.title, isRedLine: f.isRedLine, passForm: f.passForm, failForm: f.failForm }));

      // 多轮对话(困难题预设的 subPrompts,或自适应追问运行时追加的轮次)的两种判分形态:
      //  - 逐轮单评(subIndex 设了):喂「到第 subIndex 轮为止」的对话作上下文,只评这一轮;
      //  - 整段综合(subIndex 未设、答了 ≥2 轮):喂整段对话,给一个综合判定。
      // 不再要求题目预设 subPrompts —— 自适应题靠实际轮数(turns.length)即可判多轮。
      const perTurn = typeof subIndex === "number" && turns.length > 0;
      const isMultiTurn = typeof subIndex !== "number" && turns.length > 1;
      const dialogue = perTurn
        ? turns.slice(0, subIndex + 1).map((t) => ({
            user: t.userPrompt,
            assistant: t.assistant.content,
          }))
        : isMultiTurn
          ? turns.map((t) => ({
              user: t.userPrompt,
              assistant: t.assistant.content,
            }))
          : undefined;
      const fileTranscripts = isMultiTurn
        ? turns.map((t) => t.assistant.transcript)
        : [turn.assistant.transcript];
      const judgeAttach = collectJudgeFileTexts(fileTranscripts);
      const prompt = buildJudgePrompt({
        question: selectedQuestion,
        userPrompt: turn.userPrompt,
        agentAnswer: turn.assistant.content,
        dialogue,
        subIndex,
        isRedLine,
        redLineNotes,
        floorCandidates,
        toolEvents: turn.assistant.transcript
          ? summarizeToolEvents(turn.assistant.transcript.steps)
          : null,
        attachedFiles: judgeAttach.files,
        attachmentsOmitted: judgeAttach.omittedCount,
      });

      // 戳上本次实际使用的 llm-judge prompt 版本(改坏回退时如实记 1)。
      const judgePromptVersion = getEffectivePromptVersion("llm-judge");
      setIsJudging(true);
      setJudgeError(null);

      // Reset snapshots for this message so re-runs don't compound stale judges.
      judgeOutputsRef.current.set(turn.assistant.id, {
        snapshots: [],
        prompt,
        promptVersion: judgePromptVersion,
      });
      // 键到当前回答、清空旧结果 —— 让「评判过程」面板立刻就位,随后每位裁判返回时
      // 增量追加,用户能实时看到逐个裁判的判定/打分,而不是干等到全部跑完才出现。
      setJudgeSnapshots({
        messageId: turn.assistant.id,
        snaps: [],
        expected: judgeProfileIds.length,
        prompt,
        promptVersion: judgePromptVersion,
      });

      const snapshots: JudgeSnap[] = [];

      try {
        for (const judgeId of judgeProfileIds) {
          const r = await runOneJudge(judgeId, prompt, selectedQuestion.criteria);
          if ("error" in r) {
            setJudgeError(r.error);
            continue;
          }
          snapshots.push(r.snap);
          // 增量发布:每评完一位裁判就刷新面板(过程可见),并同步进 ref 供随时提交。
          judgeOutputsRef.current.set(turn.assistant.id, {
            snapshots: [...snapshots],
            prompt,
            promptVersion: judgePromptVersion,
          });
          setJudgeSnapshots({
            messageId: turn.assistant.id,
            snaps: [...snapshots],
            expected: judgeProfileIds.length,
            prompt,
            promptVersion: judgePromptVersion,
          });
        }

        if (snapshots.length === 0) {
          // 一位裁判都没成功 → 清掉空面板,避免留一个「0 位裁判」的空壳。
          setJudgeSnapshots(null);
          return;
        }
        // 逐裁判已在循环里增量发布到 judgeOutputsRef + judgeSnapshots,这里无需再设。

        // Aggregate via shared pure fn (单题 / 批量同口径)。nameOf 解析裁判模型名。
        const agg = aggregateJudgeSnapshots(
          snapshots,
          selectedQuestion.criteria,
          (jid) => profiles.find((p) => p.id === jid)?.name ?? jid,
        );
        setAttributionDraft(
          agg.verdict === "failed" && agg.primary
            ? { primary: agg.primary, source: "judge" }
            : null,
        );
        if (typeof subIndex === "number") {
          updateSubDraft(subIndex, {
            scores: agg.scores,
            notes: agg.notes,
            verdict: agg.verdict,
          });
        } else {
          setScoreDraft(agg.scores);
          setNotesDraft(agg.notes);
        }
        setLastJudgeProfileIdsState(judgeProfileIds);
      } finally {
        setIsJudging(false);
      }
    },
    [selectedQuestion, activeConversation, runOneJudge, setAttributionDraft, floorElements],
  );

  /**
   * 批量 LLM 评分:对当前会话里多道选中题逐题扇出裁判 → 聚合多数判定 → **自动落库**
   * (本轮不人工)。隔离:自动剔除「自评」裁判;某题无独立裁判 / 裁判全失败 → 计 errored。
   */
  const runBatchJudge = useCallback(
    async ({
      questionIds,
      judgeProfileIds,
      mode,
      overrideConvId,
    }: {
      questionIds: string[];
      judgeProfileIds: string[];
      mode: "skip" | "redo";
      overrideConvId?: string;
    }) => {
      if (judgeProfileIds.length === 0) return;
      const conv = overrideConvId
        ? (conversations.find((c) => c.id === overrideConvId) ?? null)
        : activeConversation;
      if (!conv) return;
      // 跨会话:每题独立会话后,去每道题最近作答的会话里取目标(不再只看当前会话)。
      const part = partitionForBatchJudgeAcrossConvs(
        questionIds,
        conversations,
        evaluations,
      );
      const targets =
        mode === "redo" ? [...part.eligible, ...part.alreadyEvaluated] : part.eligible;
      if (targets.length === 0) return;

      // 困难题(带 subPrompts、非多 trial)→ **逐轮单评**:把该题在其作答会话里的
      // 每一轮展开成一个判分单元(上下文=到该轮为止的对话);其余题=单个单元(整段/单轮)。
      type JudgeUnit = (typeof targets)[number] & {
        subIndex?: number;
        contextDialogue?: { user: string; assistant: string }[];
      };
      const units: JudgeUnit[] = [];
      for (const t of targets) {
        const ti = t.turn.assistant.trialIndex;
        const dconv = t.conversationId
          ? conversations.find((c) => c.id === t.conversationId)
          : conv;
        if (ti == null) {
          // 非多 trial 多步题:整题的连续多轮逐轮单评(现状不变)。
          // 上下文 = 到本轮为止的对话,subIndex 标出被评轮。
          const allTurns = answeredTurns(dconv?.messages ?? [], t.questionId);
          if (allTurns.length > 1) {
            allTurns.forEach((turn, i) =>
              units.push({
                ...t,
                turn,
                subIndex: i,
                contextDialogue: allTurns.slice(0, i + 1).map((x) => ({
                  user: x.userPrompt,
                  assistant: x.assistant.content,
                })),
              }),
            );
            continue;
          }
        } else {
          // 多 trial 多步题:partitionOne 已把每个 trial 的每一轮拆成独立 target,
          // 这里补「本 trial 内到本轮为止的上下文」(subIndex + contextDialogue),
          // 让 subPrompt 轮带着 turn0 的铺垫判分。单轮 trial 不进这一支(落到下方 push(t))。
          const trialTurns =
            answeredTurnsByTrial(dconv?.messages ?? [], t.questionId).get(ti) ?? [];
          if (trialTurns.length > 1) {
            const i = trialTurns.findIndex(
              (x) => x.assistant.id === t.turn.assistant.id,
            );
            if (i >= 0) {
              units.push({
                ...t,
                subIndex: i,
                contextDialogue: trialTurns.slice(0, i + 1).map((x) => ({
                  user: x.userPrompt,
                  assistant: x.assistant.content,
                })),
              });
              continue;
            }
          }
        }
        units.push(t);
      }

      // 按 (questionId, trialIndex) 分组成「作业」:同组 = 上下文相连(多轮题各轮 / 同一 trial
      // 各轮),同一线程按 subIndex 顺序评;不同组(不同题 / 不同 trial)才并行。多轮题绝不拆
      // 到多线程(上下文相连),也避免同题跨线程改状态的竞态。分组逻辑见 groupJudgeUnitsByContext。
      const jobs = groupJudgeUnitsByContext(
        units,
        (u) => `${u.questionId}#${u.turn.assistant.trialIndex ?? -1}`,
        (u) => u.subIndex ?? 0,
      );

      const controller = new AbortController();
      batchAbortRef.current = controller;
      setJudgeQueue({
        running: true,
        conversationId: conv.id,
        total: units.length,
        done: 0,
        completed: [],
        errored: [],
        // 评分计划:逐单元(逐轮题按轮展开),供实时列表区分各轮/子问题。
        plan: units.map((u) => ({
          key: u.turn.assistant.id,
          questionId: u.questionId,
          subIndex: u.subIndex,
          subPrompt: u.subIndex != null ? u.turn.userPrompt : undefined,
        })),
        activeKeys: [],
        doneKeys: [],
      });
      // 开跑批量评分 → 自动切到「结果」tab 看实时进度(与「打分」分开)。
      setRightTab("results");
      // 批量答题完成态让位给评分结果。
      clearQueueResults();

      // 逐 target 条目(含失败 = evaluationId null);多 trial 靠 messageId/trialIndex 区分。
      const entries: BatchJudgeEntry[] = [];
      const entryOf = (
        questionId: string,
        turn: (typeof targets)[number]["turn"],
        evaluationId: string | null,
        subIdx?: number,
      ): BatchJudgeEntry => ({
        questionId,
        messageId: turn.assistant.id,
        evaluationId,
        trialIndex: turn.assistant.trialIndex ?? undefined,
        subIndex: subIdx,
        // 逐轮题:存下该轮用户提问,结果列表才能区分各轮。
        subPrompt: subIdx != null ? turn.userPrompt : undefined,
      });

      // 判一个单元(某题某轮)。多个 worker 并发调用不同单元;setEvaluations/setJudgeQueue
      // 均函数式更新 → 并发安全。同一道多轮题的各轮由同一 worker 顺序调用(见 processJob),
      // 不会并发,故 contextDialogue 顺序与状态更新都无竞态。
      const processUnit = async ({
        questionId,
        turn,
        subIndex: unitSubIndex,
        contextDialogue,
      }: (typeof units)[number]): Promise<void> => {
          if (controller.signal.aborted) return;
          const unitKey = turn.assistant.id;
          // 完成:done+1、记完成 key、从 activeKeys 移除本线程该单元。
          const markDone = (s: JudgeQueueState) => ({
            ...s,
            done: s.done + 1,
            doneKeys: [...(s.doneKeys ?? []), unitKey],
            activeKeys: s.activeKeys.filter((k) => k !== unitKey),
          });
          const question = questionsRef.current.find((q) => q.id === questionId);
          if (!question) {
            entries.push(entryOf(questionId, turn, null, unitSubIndex));
            setJudgeQueue((s) => ({
              ...markDone(s),
              errored: [...s.errored, { questionId, reason: "题目不存在" }],
            }));
            return;
          }
          // 本线程开始评这个单元 → 加入 activeKeys(实时视图按线程显示 N 行进度)。
          setJudgeQueue((s) => ({ ...s, activeKeys: [...s.activeKeys, unitKey] }));

          // 被测对象 = 实际作答的 agent;回退到题目关联员工 profile。
          const subjectProfileId =
            turn.assistant.agentProfileId ??
            (question.targetEmployeeId
              ? (employeeProfileMap[question.targetEmployeeId] ??
                findDisplayEmployee(question.targetEmployeeId)
                  ?.associatedProfileId ??
                null)
              : null);
          const subjectProviderId = subjectProfileId
            ? (profiles.find((p) => p.id === subjectProfileId)?.providerId ?? null)
            : null;

          // 隔离:剔除自评(裁判 == 被测 profile)。
          const safe = judgeProfileIds.filter((id) => {
            const p = profiles.find((x) => x.id === id);
            return (
              p != null &&
              judgeIsolationLevel(p, subjectProfileId, subjectProviderId) !== "self"
            );
          });
          if (safe.length === 0) {
            entries.push(entryOf(questionId, turn, null, unitSubIndex));
            setJudgeQueue((s) => ({
              ...markDone(s),
              errored: [...s.errored, { questionId, reason: "无独立裁判(全部为自评)" }],
            }));
            return;
          }

          // 红线下限要素 → 题型 prompt 注入(与单题一致)。
          const redLineEls = (question.floorElementIds ?? [])
            .map((fid) => floorElements.find((f) => f.id === fid && f.isRedLine))
            .filter(Boolean) as typeof floorElements;
          // 红线判定集中口径:显式 isRedLine 标志 或 挂了红线下限要素。
          const isRedLine = questionIsRedLine(question, floorElements);
          const redLineNotes = redLineEls.length > 0
            ? redLineEls
                .map((e) => `「${e.title}」(应做到:${e.passForm || "—"};不可:${e.failForm || "—"})`)
                .join(";")
            : undefined;
          // 可引用条款候选:按 floorElementIds 顺序,取全部关联 FloorElement(含非红线)。
          const floorCandidates = (question.floorElementIds ?? [])
            .map((fid) => floorElements.find((f) => f.id === fid))
            .filter((f): f is NonNullable<typeof f> => !!f)
            .map((f) => ({ id: f.id, title: f.title, isRedLine: f.isRedLine, passForm: f.passForm, failForm: f.failForm }));
          // 困难题逐轮单评:contextDialogue = 到本轮为止的对话(上下文),subIndex 标出被评轮。
          // 单轮题 / 多 trial 单轮 trial:contextDialogue 为空 → 单次评分;
          // 多 trial 多步题已在上面按 trial 逐轮展开、带 contextDialogue。
          const judgeAttach = collectJudgeFileTexts([turn.assistant.transcript]);
          const prompt = buildJudgePrompt({
            question,
            userPrompt: turn.userPrompt,
            agentAnswer: turn.assistant.content,
            dialogue: contextDialogue,
            subIndex: unitSubIndex,
            isRedLine,
            redLineNotes,
            floorCandidates,
            toolEvents: turn.assistant.transcript
              ? summarizeToolEvents(turn.assistant.transcript.steps)
              : null,
            attachedFiles: judgeAttach.files,
            attachmentsOmitted: judgeAttach.omittedCount,
          });
          // 戳上本次实际使用的 llm-judge prompt 版本(版本↔评测可关联)。
          const judgePromptVersion = getEffectivePromptVersion("llm-judge");

          // 扇出(顺序),收集成功的快照。
          const snaps: JudgeSnap[] = [];
          for (const judgeId of safe) {
            if (controller.signal.aborted) break;
            const r = await runOneJudge(judgeId, prompt, question.criteria, controller.signal);
            if ("snap" in r) snaps.push(r.snap);
          }
          // 用户停止 → 不把这道题误标成「裁判全部失败」,也不计入 done。
          if (controller.signal.aborted) return;
          if (snaps.length === 0) {
            entries.push(entryOf(questionId, turn, null, unitSubIndex));
            setJudgeQueue((s) => ({
              ...markDone(s),
              errored: [...s.errored, { questionId, reason: "裁判全部失败" }],
            }));
            return;
          }

          // 聚合 + 组装 Evaluation(与 submitEvaluation 同口径,但分数来自聚合而非人工草稿)。
          const agg = aggregateJudgeSnapshots(
            snaps,
            question.criteria,
            (jid) => profiles.find((p) => p.id === jid)?.name ?? jid,
          );
          const weighted = agg.scores.reduce((sum, s) => {
            const w =
              question.criteria.find((c) => c.key === s.key)?.weight ??
              1 / (agg.scores.length || 1);
            return sum + s.value * w;
          }, 0);
          // 多 trial 试跑:只计 verdict(通过率/pass^k),不计分(evalScoreFields
          // 置空分数字段);judge 原文/快照仍保留(读轨迹可追溯)。
          const batchCitedFloorElementIds = mapFloorRefsToIds(snaps[0]?.citedFloorRefs, floorCandidates);
          // 真踩红线 = 裁判引用的条款里含红线要素(看"这次有没有踩",而非"题挂没挂红线")。
          const batchCitedRedLine = floorCandidates.some(
            (c) => c.isRedLine && batchCitedFloorElementIds.includes(c.id),
          );
          let failureAttribution: Evaluation["failureAttribution"];
          if (agg.verdict === "failed") {
            const a = resolveFailureAttribution({
              redLineViolated: batchCitedRedLine,
              judgePrimary: agg.primary,
            });
            if (a) failureAttribution = a;
          }
          const ev: Evaluation = {
            id: shortId("e"),
            questionId,
            messageId: turn.assistant.id,
            // 逐轮单评:带 subIndex(整段/单轮 = undefined)。
            ...(unitSubIndex != null ? { subIndex: unitSubIndex } : {}),
            ...evalScoreFields(
              turn.assistant.trialIndex,
              agg.scores,
              Number(weighted.toFixed(2)),
            ),
            notes: agg.notes,
            verdict: agg.verdict,
            submittedAt: new Date().toISOString(),
            modelVersion: turn.assistant.modelVersion,
            agentProfileId: turn.assistant.agentProfileId,
            evaluator: makeEvaluatorRef(user),
            judgeProfileId: snaps[0]?.judgeProfileId,
            judgeRawOutput: snaps[0]?.raw,
            judgePrompt: prompt,
            judgePromptVersion,
            calibrationSnapshots:
              snaps.length > 1
                ? snaps.map((s) => ({
                    judgeProfileId: s.judgeProfileId,
                    scores: s.scores,
                    verdict: s.verdict,
                    notes: s.notes,
                    failureCategory: s.failureCategory,
                    uncertaintySignals: s.uncertaintySignals,
                  }))
                : undefined,
            agreementRate: agreementRateOf(snaps),
            failureAttribution,
            uncertaintySignals: snaps[0]?.uncertaintySignals,
            ...(batchCitedFloorElementIds.length > 0 ? { citedFloorElementIds: batchCitedFloorElementIds } : {}),
          };
          // redo 会对同一 (messageId, subIndex) 再判一次 → 落库前替换上一版 LLM 评测,
          // 避免重复 eval 累积(见 upsertBatchJudgeEvaluation:只删同类 LLM、留确定性/人工)。
          setEvaluations((prev) => upsertBatchJudgeEvaluation(prev, ev));
          entries.push(entryOf(questionId, turn, ev.id, unitSubIndex));
          updateQuestionStatus(questionId, agg.verdict, ev.autoScore);
          setJudgeQueue((s) => ({
            ...markDone(s),
            completed: [...s.completed, questionId],
          }));
      };

      try {
        // worker 池按**作业组**并发(不是按单元):最多 JUDGE_CONCURRENCY 组同时跑;
        // 组内各单元(多轮题各轮)由同一 worker **顺序** await —— 上下文相连的轮不会并发,
        // 也不会被拆到不同线程。共享游标 cursor++ 在单线程事件循环里原子,无竞态。
        let cursor = 0;
        const worker = async () => {
          while (!controller.signal.aborted) {
            const i = cursor++;
            if (i >= jobs.length) break;
            for (const unit of jobs[i]) {
              if (controller.signal.aborted) break;
              await processUnit(unit);
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(JUDGE_CONCURRENCY, jobs.length) }, worker),
        );
      } finally {
        setJudgeQueue((s) => ({ ...s, running: false, activeKeys: [] }));
        setLastBatchJudge({
          ranAt: new Date().toISOString(),
          conversationId: conv.id,
          entries,
          judgeProfileIds,
          mode,
        });
        batchAbortRef.current = null;
      }
    },
    [
      activeConversation,
      conversations,
      evaluations,
      profiles,
      employeeProfileMap,
      floorElements,
      runOneJudge,
      updateQuestionStatus,
      user,
      setRightTab,
      clearQueueResults,
    ],
  );

  const stopBatchJudge = useCallback(() => {
    batchAbortRef.current?.abort();
    batchAbortRef.current = null;
    setJudgeQueue((s) => ({ ...s, running: false, activeKeys: [] }));
  }, []);

  const clearBatchJudgeResults = useCallback(() => {
    setJudgeQueue((s) => (s.running ? s : EMPTY_JUDGE_QUEUE));
  }, []);

  /** 真终止一个进行中的评测运行:abort 底层答题/评分任务 + 置 canceled + 关派发闸门。 */
  const cancelEvaluationRun = useCallback(
    (runId: string) => {
      // 先置取消:编排 effect 的 shouldStartJudging / 出报告 effect 据此都不再推进。
      updateEvaluationRun(runId, { status: "canceled" });
      // 双保险闸门:即便状态更新有异步窗口,也不再派发判分 / 出报告。
      judgeDispatchedRef.current.add(runId);
      reportDispatchedRef.current.add(runId);
      // 真停底层:abort 答题队列 + 评分批量(各自的 AbortController)。
      stopQueue();
      stopBatchJudge();
      setActiveEvaluationRunId(null);
    },
    [updateEvaluationRun, stopQueue, stopBatchJudge],
  );

  // 「答完即评」:批量答题完成后,若本批勾了 autoJudge 且仍在该 run 会话,
  // 自动用内联选定的裁判接一次批量评分(放在 runBatchJudge 定义之后,避免 TDZ)。
  useEffect(() => {
    const plan = planAutoJudge({
      queueRunning: queue.running,
      autoJudge: queue.autoJudge ?? null,
      judgeRunning: judgeQueue.running,
      completed: queue.completed,
      queueConversationId: queue.conversationId ?? null,
      activeConversationId,
    });
    if (!plan) return;
    setQueue((q) => ({ ...q, autoJudge: null })); // 消费,防重入
    void runBatchJudge({
      questionIds: plan.questionIds,
      judgeProfileIds: plan.config.judgeProfileIds,
      mode: plan.config.mode,
    });
  }, [
    queue.running,
    queue.autoJudge,
    queue.completed,
    queue.conversationId,
    judgeQueue.running,
    activeConversationId,
    runBatchJudge,
  ]);

  // 编排器衔接 effect:答题跑完 → 串评分 → 出报告(不带视图门,只认 run 会话)。
  useEffect(() => {
    const runId = activeEvaluationRunId;
    if (!runId) return;
    const run = evaluationRunsRef.current.find((r) => r.id === runId);
    if (!run) return;

    // 运行中:把队列进度映射进 run(便于列表/进度条显示)。
    if (run.status === "answering" || run.status === "judging") {
      const prog = deriveRunProgress(
        { running: queue.running, completed: queue.completed, total: queue.total, conversationId: queue.conversationId },
        { done: judgeQueue.done },
        run.runConversationId,
      );
      if (prog.answered !== run.progress.answered || prog.judged !== run.progress.judged || prog.total !== run.progress.total) {
        updateEvaluationRun(runId, { progress: prog });
      }
    }

    // 答题跑完 → 串评分 + 出报告(一次性)。
    if (shouldStartJudging(run, { running: queue.running, conversationId: queue.conversationId })) {
      if (judgeDispatchedRef.current.has(runId)) return; // 防重入:状态更新有异步窗口
      judgeDispatchedRef.current.add(runId);
      updateEvaluationRun(runId, { status: "judging" }); // 翻状态(双保险)
      const answerErrored = queue.errored.length > 0;
      void (async () => {
        try {
          if (run.config.judgeProfileIds.length > 0) {
            await runBatchJudge({
              questionIds: run.config.questionIds,
              judgeProfileIds: run.config.judgeProfileIds,
              mode: run.config.judgeMode,
              overrideConvId: run.runConversationId,
            });
          }
          // 取消守卫:评分期间被「终止」→ run 已置 canceled,不再出报告。
          if (evaluationRunsRef.current.find((r) => r.id === runId)?.status !== "judging") {
            setActiveEvaluationRunId(null);
            return;
          }
          // 不在此组装报告(闭包里的 compose 闭着旧 evaluations)。转 reporting,
          // 交给下方独立的"出报告 effect"用新鲜 compose 组装。
          updateEvaluationRun(runId, {
            status: "reporting",
            ...(answerErrored ? { error: `${queue.errored.length} 题作答失败` } : {}),
          });
        } catch (e) {
          updateEvaluationRun(runId, { status: "failed", error: (e as Error).message });
          setActiveEvaluationRunId(null);
        }
      })();
    }
  }, [
    activeEvaluationRunId, queue.running, queue.conversationId, queue.completed, queue.total,
    queue.errored, judgeQueue.done, updateEvaluationRun, runBatchJudge, profiles,
    composeReportItems, composeReportMetrics, addReport,
  ]);

  // 出报告 effect:run 进入 reporting 后,在新渲染里用"新鲜"的 compose(已绑判分后的
  // evaluations)组装报告。一次性(reportDispatchedRef 防重)。
  useEffect(() => {
    const runId = activeEvaluationRunId;
    if (!runId) return;
    const run = evaluationRunsRef.current.find((r) => r.id === runId);
    if (!run || run.status !== "reporting") return;
    if (reportDispatchedRef.current.has(runId)) return;
    reportDispatchedRef.current.add(runId);
    try {
      const subj = profiles.find((p) => p.id === run.subjectProfileId);
      const items = composeReportItems(run.subjectProfileId, run.config.questionIds);
      const metrics = composeReportMetrics(run.subjectProfileId, run.config.questionIds);
      const reportId = addReport({
        title: `${subj?.name ?? run.subjectProfileId} · ${run.versionLabel}`,
        agentProfileId: run.subjectProfileId,
        agentName: subj?.name ?? run.subjectProfileId,
        items,
        metrics,
      });
      const failed = failedQuestionIdsFromReport({ items });
      const hadAnswerError = !!run.error;
      updateEvaluationRun(runId, {
        status: hadAnswerError || failed.length > 0 ? "partial" : "done",
        reportId,
        failedQuestionIds: failed,
      });
    } catch (e) {
      updateEvaluationRun(runId, { status: "failed", error: (e as Error).message });
    } finally {
      setActiveEvaluationRunId(null);
    }
  }, [activeEvaluationRunId, evaluationRuns, composeReportItems, composeReportMetrics, addReport, profiles, updateEvaluationRun]);

  const submitEvaluation = useCallback(
    (verdict: Evaluation["verdict"]) => {
      // Target the question the user is currently looking at — NOT the conv's
      // last-asked. This is what lets you evaluate Q1 even after sending Q2.
      const targetQ = selectedQuestion;
      if (!targetQ) return;
      const targetMsg =
        selectedMessages.length > 0
          ? selectedMessages[selectedMessages.length - 1]
          : null;
      if (!targetMsg || !targetMsg.questionId) return;
      const weighted = scoreDraft.length
        ? scoreDraft.reduce((sum, s) => {
            const w =
              targetQ.criteria.find((c) => c.key === s.key)?.weight ??
              1 / scoreDraft.length;
            return sum + s.value * w;
          }, 0)
        : 0;
      const judgeStamp = judgeOutputsRef.current.get(targetMsg.id);
      const snaps = judgeStamp?.snapshots ?? [];
      const passCount = snaps.filter((s) => s.verdict === "passed").length;
      const agreementRate =
        snaps.length > 1
          ? Math.round(
              (Math.max(passCount, snaps.length - passCount) / snaps.length) *
                100,
            )
          : undefined;
      // 可引用条款候选:按 floorElementIds 顺序,取全部关联 FloorElement(含非红线)。
      const submitFloorCandidates = (targetQ.floorElementIds ?? [])
        .map((fid) => floorElements.find((f) => f.id === fid))
        .filter((f): f is NonNullable<typeof f> => !!f)
        .map((f) => ({ id: f.id, title: f.title, isRedLine: f.isRedLine, passForm: f.passForm, failForm: f.failForm }));
      const citedFloorElementIds = mapFloorRefsToIds(snaps[0]?.citedFloorRefs, submitFloorCandidates);
      // 失败归因:真踩红线(裁判引用了红线条款)→ 强制 safety;否则用草稿(judge/人工)。
      // passed → 无归因。看"这次有没有踩红线",而非"题挂没挂红线"。
      const citedRedLine = submitFloorCandidates.some(
        (c) => c.isRedLine && citedFloorElementIds.includes(c.id),
      );
      let failureAttribution: Evaluation["failureAttribution"];
      if (verdict === "failed") {
        if (citedRedLine) {
          const a = resolveFailureAttribution({
            redLineViolated: true,
            judgePrimary: attributionDraft?.primary ?? null,
            judgeSecondary: attributionDraft?.secondary,
          });
          // redLineViolated:true 时 resolveFailureAttribution 必返回非空;if 仅为类型收窄(其返回类型含 null)。
          if (a) {
            failureAttribution = attributionDraft?.note
              ? { ...a, note: attributionDraft.note }
              : a;
          }
        } else if (attributionDraft) {
          failureAttribution = attributionDraft;
        }
      }
      // 多 trial 试跑回答:人工评也只计 verdict,不计分(与批量 judge 同口径)。
      const ev: Evaluation = {
        id: shortId("e"),
        questionId: targetMsg.questionId,
        messageId: targetMsg.id,
        ...evalScoreFields(targetMsg.trialIndex, scoreDraft, Number(weighted.toFixed(2))),
        notes: notesDraft,
        verdict,
        submittedAt: new Date().toISOString(),
        annotations:
          annotationsDraft.length > 0 ? annotationsDraft : undefined,
        modelVersion: targetMsg.modelVersion,
        agentProfileId: targetMsg.agentProfileId,
        evaluator: makeEvaluatorRef(user),
        judgeProfileId: snaps[0]?.judgeProfileId,
        judgeRawOutput: snaps[0]?.raw,
        judgePrompt: judgeStamp?.prompt,
        judgePromptVersion: judgeStamp?.promptVersion,
        calibrationSnapshots:
          snaps.length > 1
            ? snaps.map((s) => ({
                judgeProfileId: s.judgeProfileId,
                scores: s.scores,
                verdict: s.verdict,
                notes: s.notes,
                failureCategory: s.failureCategory,
                uncertaintySignals: s.uncertaintySignals,
              }))
            : undefined,
        agreementRate,
        failureAttribution,
        uncertaintySignals: snaps[0]?.uncertaintySignals,
        ...(citedFloorElementIds.length > 0 ? { citedFloorElementIds } : {}),
      };
      setEvaluations((prev) => [ev, ...prev]);
      if (judgeStamp) judgeOutputsRef.current.delete(targetMsg.id);
      updateQuestionStatus(
        targetMsg.questionId,
        verdict === "passed"
          ? "passed"
          : verdict === "failed"
            ? "failed"
            : "tested",
        ev.autoScore,
      );
      // Drop just this question's drafts; others stay preserved.
      patchDraftForQ(targetQ.id, null);
      // 打完分 → 跳「结果」tab 看本题结果(打分页只管打分,结果在结果页)。
      setRightTab("results");
    },
    [
      selectedQuestion,
      selectedMessages,
      scoreDraft,
      notesDraft,
      annotationsDraft,
      updateQuestionStatus,
      user,
      patchDraftForQ,
      attributionDraft,
      floorElements,
      setRightTab,
    ],
  );

  const recordAuditReview = useCallback(
    (
      questionId: string,
      messageId: string,
      input: {
        scores: ScoreDimension[];
        notes: string;
        verdict: "passed" | "failed";
        attribution?: FailureAttribution | null;
      },
    ) => {
      const q = questions.find((qq) => qq.id === questionId);
      // 跨会话定位被判回答(取分数权重 / 模型版本 / agent / trialIndex)。
      const msg = conversations
        .flatMap((c) => c.messages)
        .find((mm) => mm.id === messageId);
      const weighted = input.scores.length
        ? input.scores.reduce((sum, s) => {
            const w =
              q?.criteria.find((c) => c.key === s.key)?.weight ??
              1 / input.scores.length;
            return sum + s.value * w;
          }, 0)
        : 0;
      const ev: Evaluation = {
        id: shortId("e"),
        questionId,
        messageId,
        ...evalScoreFields(msg?.trialIndex, input.scores, Number(weighted.toFixed(2))),
        notes: input.notes,
        verdict: input.verdict,
        submittedAt: new Date().toISOString(),
        modelVersion: msg?.modelVersion,
        agentProfileId: msg?.agentProfileId,
        // 无 judgeProfileId → evalSource 判为「人工」,进抽审/校准的人工侧。
        evaluator: makeEvaluatorRef(user),
        failureAttribution:
          input.verdict === "failed" ? (input.attribution ?? undefined) : undefined,
      };
      setEvaluations((prev) => [ev, ...prev]);
      updateQuestionStatus(
        questionId,
        input.verdict === "passed" ? "passed" : "failed",
      );
    },
    [questions, conversations, user, updateQuestionStatus],
  );

  const getMessageAnswer = useCallback(
    (messageId: string): string =>
      conversations.flatMap((c) => c.messages).find((mm) => mm.id === messageId)
        ?.content ?? "",
    [conversations],
  );

  const setEvaluationAttribution = useCallback(
    (evaluationId: string, attribution: FailureAttribution | null) => {
      setEvaluations((prev) =>
        prev.map((e) =>
          e.id === evaluationId
            ? { ...e, failureAttribution: attribution ?? undefined }
            : e,
        ),
      );
    },
    [],
  );

  const submitSubEvaluations = useCallback(() => {
    const targetQ = selectedQuestion;
    if (!targetQ) return;
    if (subDrafts.length === 0) return;
    const newEvals: Evaluation[] = [];
    let allFailed = true;
    let allPassed = true;
    let anyFailed = false;
    let scoreSum = 0;
    let scoreCount = 0;
    subDrafts.forEach((draft, i) => {
      const verdict = draft.verdict ?? "failed";
      const msg = selectedMessages[i];
      if (!msg) return;
      const weighted = draft.scores.reduce((sum, s) => {
        const w =
          targetQ.criteria.find((c) => c.key === s.key)?.weight ??
          1 / draft.scores.length;
        return sum + s.value * w;
      }, 0);
      const judgeStamp = judgeOutputsRef.current.get(msg.id);
      const snaps = judgeStamp?.snapshots ?? [];
      const passCount = snaps.filter((s) => s.verdict === "passed").length;
      const agreementRate =
        snaps.length > 1
          ? Math.round(
              (Math.max(passCount, snaps.length - passCount) / snaps.length) *
                100,
            )
          : undefined;
      newEvals.push({
        id: shortId("e"),
        questionId: targetQ.id,
        messageId: msg.id,
        subIndex: i,
        scores: draft.scores,
        autoScore: Number(weighted.toFixed(2)),
        notes: draft.notes,
        verdict,
        submittedAt: new Date().toISOString(),
        annotations:
          i === 0 && annotationsDraft.length > 0
            ? annotationsDraft
            : undefined,
        modelVersion: msg.modelVersion,
        agentProfileId: msg.agentProfileId,
        evaluator: makeEvaluatorRef(user),
        judgeProfileId: snaps[0]?.judgeProfileId,
        judgeRawOutput: snaps[0]?.raw,
        judgePrompt: judgeStamp?.prompt,
        judgePromptVersion: judgeStamp?.promptVersion,
        calibrationSnapshots:
          snaps.length > 1
            ? snaps.map((s) => ({
                judgeProfileId: s.judgeProfileId,
                scores: s.scores,
                verdict: s.verdict,
                notes: s.notes,
              }))
            : undefined,
        agreementRate,
      });
      if (judgeStamp) judgeOutputsRef.current.delete(msg.id);
      scoreSum += weighted;
      scoreCount += 1;
      if (verdict === "failed") {
        anyFailed = true;
        allPassed = false;
      } else if (verdict === "passed") {
        allFailed = false;
      } else {
        allFailed = false;
        allPassed = false;
      }
    });
    void allFailed;
    if (newEvals.length === 0) return;
    setEvaluations((prev) => [...newEvals, ...prev]);
    const overallStatus: QuestionStatus = anyFailed
      ? "failed"
      : allPassed
        ? "passed"
        : "tested";
    const avgScore = scoreCount > 0 ? scoreSum / scoreCount : undefined;
    updateQuestionStatus(targetQ.id, overallStatus, avgScore);
    patchDraftForQ(targetQ.id, null);
    setRightTab("results");
  }, [
    selectedQuestion,
    subDrafts,
    selectedMessages,
    annotationsDraft,
    updateQuestionStatus,
    user,
    patchDraftForQ,
    setRightTab,
  ]);

  const value = useMemo<QAStoreValue>(
    () => ({
      sessionId,
      connectionStatus,
      clearLocalData,
      isStreamingHere,
      isQuestionInProgressHere,
      runningConversationId,
      runningConversationIds,
      agentActivity,
      activityStartedAt,
      agentStage,
      profiles,
      activeProfileId,
      activeProfile,
      setActiveProfile,
      addProfile,
      updateProfile,
      deleteProfile,
      pingProfile,
      connectActive,
      connectProfile,
      requestVerifyWithNotice,
      listActiveSkills,
      activeSupportsSkills,
      lastPing,
      notice,
      showNotice,
      dismissNotice,
      resolveProfileForQuestion,
      questions,
      selectedQuestionId,
      setSelectedQuestion,
      addQuestion,
      updateQuestion,
      deleteQuestion,
      replaceQuestions,
      reorderQuestions,
      importQuestions,
      exportConversation,
      importConversationBundle,
      categories,
      addCategory,
      genDimensions,
      addGenDimension,
      removeGenDimension,
      deleteCategory,
      user,
      setUser,
      clearUser,
      defaultCriteria,
      setDefaultCriteria,
      resetDefaultCriteria,
      selection,
      toggleSelection,
      setSelection,
      setSelectionForConv,
      clearSelection,
      queue,
      runQueue,
      stopQueue,
      resumeQueue,
      clearQueueResults,
      judgeQueue,
      lastBatchJudge,
      runBatchJudge,
      stopBatchJudge,
      clearBatchJudgeResults,
      conversations,
      activeConversationId,
      activeConversation,
      newConversation,
      startQuestionInNewConversation,
      switchConversation,
      deleteConversation,
      renameConversation,
      togglePinConversation,
      messages,
      isStreaming,
      refetchFromServer,
      lastSyncedAt,
      hydrated,
      isRefetching,
      refetchTimedOut,
      isQuestionInProgress,
      sendQuestion,
      sendRawPrompt,
      editAndResendMessage,
      retryMessage,
      stopGeneration,
      pendingSend,
      queueSend,
      cancelPendingSend,
      flushPendingSend,
      resetSession,
      clearMessages,
      evaluations,
      scoreDraft,
      setScoreDraft,
      notesDraft,
      setNotesDraft,
      attributionDraft,
      setAttributionDraft,
      setEvaluationAttribution,
      annotationsDraft,
      addAnnotation,
      removeAnnotation,
      subDrafts,
      updateSubDraft,
      ensureSubDrafts,
      submitEvaluation,
      recordAuditReview,
      getMessageAnswer,
      submitSubEvaluations,
      runLLMJudge,
      isJudging,
      judgeError,
      judgeSnapshots,
      lastJudgeProfileIds,
      setLastJudgeProfileIds,
      lastGeneratorProfileId,
      setLastGeneratorProfileId,
      employeeProfileMap,
      setEmployeeProfile,
      runOneShot,
      generateFollowup,
      stopFollowup,
      buildFollowupPromptPreview,
      freezeAdaptiveAsQuestion,
      saveQuestionToLibrary,
      setQuestionEvaluation,
      activeQuestion,
      activeMessages,
      selectedQuestion,
      selectedMessages,
      testedInActiveConv,
      getQStatusInActiveConv,
      getQLastScoreInActiveConv,
      statsByQInActiveConv,
      passKByQInActiveConv,
      standardEmployees: DISPLAY_EMPLOYEES,
      agentForEmployee,
      configuredEmployeeIds,
      isEmployeeConfigured,
      reports,
      composeReportItems,
      composeReportMetrics,
      addReport,
      deleteReport,
      setReportManualMetric,
      evaluationRuns,
      addEvaluationRun,
      updateEvaluationRun,
      deleteEvaluationRun,
      startEvaluationRun,
      cancelEvaluationRun,
      skillReports,
      addSkillReport,
      deleteSkillReport,
      setSkillReportAudit,
      setSkillReportThresholds,
      floorElements,
      addFloorElement,
      updateFloorElement,
      deleteFloorElement,
      importFloorCandidates,
      setQuestionFloorElements,
      toggleQuestionFloorElement,
      employeeMetrics,
      setMetricOverride,
      restoreBuiltinMetric,
      hideBuiltinMetric,
      addCustomMetric,
      updateCustomMetric,
      deleteCustomMetric,
      importCustomMetrics,
      resetEmployeeMetrics,
      rightTab,
      setRightTab,
      previewFile,
      openFilePreview,
      closePreview,
      rightPanelCollapsed,
      setRightPanelCollapsed,
      sessionQuestionsHidden,
      setSessionQuestionsHidden,
      adaptiveEnabled,
      setAdaptiveEnabled,
      agentRepoVersion,
      bumpAgentRepoVersion,
      agentRepoSyncedAt,
    }),
    [
      sessionId,
      connectionStatus,
      clearLocalData,
      isStreamingHere,
      isQuestionInProgressHere,
      runningConversationId,
      runningConversationIds,
      agentActivity,
      activityStartedAt,
      agentStage,
      profiles,
      activeProfileId,
      activeProfile,
      setActiveProfile,
      addProfile,
      updateProfile,
      deleteProfile,
      pingProfile,
      connectActive,
      connectProfile,
      requestVerifyWithNotice,
      listActiveSkills,
      activeSupportsSkills,
      lastPing,
      notice,
      showNotice,
      dismissNotice,
      resolveProfileForQuestion,
      questions,
      selectedQuestionId,
      setSelectedQuestion,
      addQuestion,
      updateQuestion,
      deleteQuestion,
      replaceQuestions,
      reorderQuestions,
      importQuestions,
      exportConversation,
      importConversationBundle,
      categories,
      addCategory,
      genDimensions,
      addGenDimension,
      removeGenDimension,
      deleteCategory,
      user,
      setUser,
      clearUser,
      defaultCriteria,
      setDefaultCriteria,
      resetDefaultCriteria,
      selection,
      toggleSelection,
      setSelection,
      setSelectionForConv,
      clearSelection,
      queue,
      runQueue,
      stopQueue,
      resumeQueue,
      clearQueueResults,
      judgeQueue,
      lastBatchJudge,
      runBatchJudge,
      stopBatchJudge,
      clearBatchJudgeResults,
      conversations,
      activeConversationId,
      activeConversation,
      newConversation,
      startQuestionInNewConversation,
      switchConversation,
      deleteConversation,
      renameConversation,
      togglePinConversation,
      messages,
      isStreaming,
      refetchFromServer,
      lastSyncedAt,
      hydrated,
      isRefetching,
      refetchTimedOut,
      isQuestionInProgress,
      sendQuestion,
      sendRawPrompt,
      editAndResendMessage,
      retryMessage,
      stopGeneration,
      pendingSend,
      queueSend,
      cancelPendingSend,
      flushPendingSend,
      resetSession,
      clearMessages,
      evaluations,
      scoreDraft,
      notesDraft,
      attributionDraft,
      setAttributionDraft,
      setEvaluationAttribution,
      annotationsDraft,
      addAnnotation,
      removeAnnotation,
      subDrafts,
      updateSubDraft,
      ensureSubDrafts,
      submitEvaluation,
      recordAuditReview,
      getMessageAnswer,
      submitSubEvaluations,
      runLLMJudge,
      isJudging,
      judgeError,
      judgeSnapshots,
      lastJudgeProfileIds,
      setLastJudgeProfileIds,
      lastGeneratorProfileId,
      setLastGeneratorProfileId,
      employeeProfileMap,
      setEmployeeProfile,
      runOneShot,
      generateFollowup,
      stopFollowup,
      buildFollowupPromptPreview,
      freezeAdaptiveAsQuestion,
      saveQuestionToLibrary,
      setQuestionEvaluation,
      activeQuestion,
      activeMessages,
      selectedQuestion,
      selectedMessages,
      testedInActiveConv,
      getQStatusInActiveConv,
      getQLastScoreInActiveConv,
      statsByQInActiveConv,
      passKByQInActiveConv,
      reports,
      composeReportItems,
      composeReportMetrics,
      addReport,
      deleteReport,
      setReportManualMetric,
      evaluationRuns,
      addEvaluationRun,
      updateEvaluationRun,
      deleteEvaluationRun,
      startEvaluationRun,
      cancelEvaluationRun,
      skillReports,
      addSkillReport,
      deleteSkillReport,
      setSkillReportAudit,
      setSkillReportThresholds,
      floorElements,
      addFloorElement,
      updateFloorElement,
      deleteFloorElement,
      importFloorCandidates,
      setQuestionFloorElements,
      toggleQuestionFloorElement,
      employeeMetrics,
      setMetricOverride,
      restoreBuiltinMetric,
      hideBuiltinMetric,
      addCustomMetric,
      updateCustomMetric,
      deleteCustomMetric,
      importCustomMetrics,
      resetEmployeeMetrics,
      rightTab,
      previewFile,
      openFilePreview,
      closePreview,
      rightPanelCollapsed,
      setRightPanelCollapsed,
      sessionQuestionsHidden,
      adaptiveEnabled,
      agentRepoVersion,
      bumpAgentRepoVersion,
      agentRepoSyncedAt,
      configuredEmployeeIds,
      isEmployeeConfigured,
    ],
  );

  return (
    <QAStoreContext.Provider value={value}>{children}</QAStoreContext.Provider>
  );
}

export function useQAStore() {
  const ctx = useContext(QAStoreContext);
  if (!ctx) throw new Error("useQAStore must be inside QAStoreProvider");
  return ctx;
}

// Re-export helpers for UI code that needs to enumerate providers.
export { listProviders };
