/**
 * 单段会话(侧栏一条 RECENTS 线程)的导出 / 导入。
 *
 * 一段会话要能在别处「重现报告」,必须打包 4 样彼此靠 id 相互引用的数据:
 *   - Conversation 本身(标题 + 消息列表 + 时间)
 *   - Messages(在会话内):每轮提问 + agent 作答**轨迹**(transcript / images / files / tokens…)
 *   - Questions:被这些消息 questionId 引用到的**完整题目**(题面 / 评分维度 / Pass·Fail / 附件…)
 *   - Evaluations:messageId ∈ 本会话的**全部打分**(scores / verdict / notes / 多 judge…)
 *
 * 报告(看板)本就由 questions + conversations + evaluations 现算,所以这 4 样齐、引用不断,
 * 导入方即可原样重现。数据包为单文件 JSON,附件 / 轨迹 / 图片全内联 —— 大但完全自包含。
 *
 * 导入策略(隔离优先,见 applyConversationBundle):
 *   - 题目按**内容指纹**去重:与导入方已有题内容一致 → 复用其 id;否则新增(分配全新 id)。
 *   - 会话 / 消息 / 评测**一律分配全新 id**,并把消息.questionId、评测.questionId/messageId
 *     按映射改写 —— 无论导入方库里有没有同名东西,都不会撞已有数据,永远是一条干净的新线程。
 */

import { questionContentSig } from "./question-import";
import { ALL_EMPLOYEES_ID } from "./standard-employees";
import type { Conversation, Evaluation, Question, StandardEmployee } from "@/types";

export const CONVERSATION_BUNDLE_KIND = "eval-platform/conversation-bundle";
export const CONVERSATION_BUNDLE_VERSION = 1;

export interface ConversationBundle {
  kind: typeof CONVERSATION_BUNDLE_KIND;
  version: number;
  exportedAt: string;
  /** 已清洗:gatewaySessionId=null、去掉 pinned、messages 的 isStreaming 清零。 */
  conversation: Conversation;
  /** 被会话消息引用到的完整题目(含附件)。 */
  questions: Question[];
  /** messageId ∈ 会话的全部评测(含轨迹之外的结果 / 多 judge)。 */
  evaluations: Evaluation[];
}

/** 剥掉机器本地 / 瞬态字段:上游网关 session、置顶偏好、流式中标志。 */
function sanitizeConversation(conv: Conversation): Conversation {
  const { pinned: _pinned, ...rest } = conv;
  return {
    ...rest,
    gatewaySessionId: null,
    messages: conv.messages.map((m) => {
      const { isStreaming: _isStreaming, ...msg } = m;
      return msg;
    }),
  };
}

/**
 * 从整库中抽出「这一段会话」的自包含数据包。
 * @param exportedAt 由调用方注入的导出时刻(ISO),保持本函数纯粹可测。
 */
export function buildConversationBundle(
  conv: Conversation,
  allQuestions: Question[],
  allEvaluations: Evaluation[],
  exportedAt: string,
): ConversationBundle {
  const qids = new Set<string>();
  if (conv.activeQuestionId) qids.add(conv.activeQuestionId);
  for (const m of conv.messages) if (m.questionId) qids.add(m.questionId);

  const questions = allQuestions.filter((q) => qids.has(q.id));

  const msgIds = new Set(conv.messages.map((m) => m.id));
  const evaluations = allEvaluations.filter((e) => msgIds.has(e.messageId));

  return {
    kind: CONVERSATION_BUNDLE_KIND,
    version: CONVERSATION_BUNDLE_VERSION,
    exportedAt,
    conversation: sanitizeConversation(conv),
    questions,
    evaluations,
  };
}

export type ParseResult =
  | { ok: true; bundle: ConversationBundle }
  | { ok: false; error: string };

/** 解析 + 校验 JSON 文本;kind / version / 结构不符一律拒绝并给中文原因。 */
export function parseConversationBundle(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "不是有效的 JSON 文件" };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "文件内容不是对象" };
  }
  const b = raw as Partial<ConversationBundle>;
  if (b.kind !== CONVERSATION_BUNDLE_KIND) {
    return { ok: false, error: "不是会话数据包(kind 不匹配),请确认是「导出会话」得到的文件" };
  }
  if (typeof b.version !== "number" || b.version < 1 || b.version > CONVERSATION_BUNDLE_VERSION) {
    return { ok: false, error: `版本不支持(v${String(b.version)}),本平台最高支持 v${CONVERSATION_BUNDLE_VERSION}` };
  }
  if (!b.conversation || typeof b.conversation !== "object" || !Array.isArray(b.conversation.messages)) {
    return { ok: false, error: "会话内容缺失或损坏" };
  }
  if (!Array.isArray(b.questions) || !Array.isArray(b.evaluations)) {
    return { ok: false, error: "题目 / 评测数据缺失或损坏" };
  }
  return { ok: true, bundle: b as ConversationBundle };
}

export interface ApplyState {
  questions: Question[];
  evaluations: Evaluation[];
}

export interface ApplyResult {
  /** 待插入列表最前的新会话(全新 id、引用已改写)。 */
  conversation: Conversation;
  /** 合并后的完整题库(新增题在前 + 原有题)。 */
  questions: Question[];
  /** 待追加的评测(全新 id、messageId/questionId 已改写)。 */
  evaluations: Evaluation[];
  addedQuestions: number;
  reusedQuestions: number;
  evaluationCount: number;
}

/**
 * 从数据包题目的 targetEmployeeId 推断「这条会话属于哪位员工」(取众数,忽略「全体员工」)。
 * 员工 id 是内置、跨环境稳定的,所以它是跨环境重锚定 agentProfileId 的可靠锚。
 */
function inferBundleEmployeeId(questions: Question[]): string | null {
  const votes = new Map<string, number>();
  for (const q of questions) {
    const eid = q.targetEmployeeId;
    if (eid && eid !== ALL_EMPLOYEES_ID) votes.set(eid, (votes.get(eid) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [eid, n] of votes) if (n > bestN) [best, bestN] = [eid, n];
  return best;
}

/** 目标环境里该员工对应的 agent profile id(显式关联优先,回退 associatedProfileId)。 */
function targetProfileForEmployee(
  empId: string,
  employees: StandardEmployee[],
  employeeProfileMap: Record<string, string | null>,
): string | null {
  return (
    employeeProfileMap[empId] ??
    employees.find((e) => e.id === empId)?.associatedProfileId ??
    null
  );
}

/**
 * 把数据包合并进现有状态。纯函数:新 id 生成器与「当前时刻」由调用方注入,方便测试。
 * @param opts.newId  取一个全新 id(带前缀);生产用 shortId,测试用可确定的计数器。
 * @param opts.now    导入时刻(ISO),写进会话 updatedAt 让它冒到 Recents 顶部。
 * @param opts.employees / opts.employeeProfileMap  目标环境的员工与「员工↔profile」关联。
 *   给了就把导入会话消息/评测的 agentProfileId **重锚定**到目标端同一员工的 profile ——
 *   否则跨环境导入(源端 profile id 目标端不存在)会导致头像 / 数据看板认不出该会话。
 */
export function applyConversationBundle(
  bundle: ConversationBundle,
  state: ApplyState,
  opts: {
    newId: (prefix?: string) => string;
    now: string;
    employees?: StandardEmployee[];
    employeeProfileMap?: Record<string, string | null>;
  },
): ApplyResult {
  const { newId, now, employees, employeeProfileMap } = opts;

  // 跨环境重锚定:从题目 targetEmployeeId 推断员工 → 取目标端该员工的 profile。
  // 拿不到(未传员工上下文 / 目标端未配置该员工)则为 null,保持原 agentProfileId 不变。
  const anchorEmpId = inferBundleEmployeeId(bundle.questions);
  const anchorProfileId =
    anchorEmpId && employees && employeeProfileMap
      ? targetProfileForEmployee(anchorEmpId, employees, employeeProfileMap)
      : null;
  const reanchor = (pid: string | undefined | null) =>
    pid != null && anchorProfileId ? anchorProfileId : pid;

  // 1) 题目:按内容指纹去重。撞内容 → 复用已有 id;否则分配全新 id 并新增。
  const bySig = new Map<string, Question>();
  for (const q of state.questions) bySig.set(questionContentSig(q), q);

  const qIdMap = new Map<string, string>();
  const newQuestions: Question[] = [];
  let added = 0;
  let reused = 0;
  for (const q of bundle.questions) {
    const sig = questionContentSig(q);
    const existing = bySig.get(sig);
    if (existing) {
      qIdMap.set(q.id, existing.id);
      reused += 1;
    } else {
      const freshId = newId("q");
      qIdMap.set(q.id, freshId);
      const cloned: Question = { ...q, id: freshId };
      newQuestions.push(cloned);
      bySig.set(sig, cloned); // 包内自身重复题也归并到这一份
      added += 1;
    }
  }
  const questions = [...newQuestions, ...state.questions];
  const remapQ = (qid: string | undefined | null) =>
    qid ? (qIdMap.get(qid) ?? qid) : qid;

  // 2) 消息:全部分配全新 id,questionId 按映射改写。
  const msgIdMap = new Map<string, string>();
  const messages = bundle.conversation.messages.map((m) => {
    const freshId = newId("msg");
    msgIdMap.set(m.id, freshId);
    const { isStreaming: _isStreaming, ...rest } = m;
    return {
      ...rest,
      id: freshId,
      questionId: remapQ(m.questionId) ?? undefined,
      agentProfileId: reanchor(m.agentProfileId) ?? undefined,
    };
  });

  // 3) 会话:全新 id;冒到顶部;保留真实创建时间。
  const { pinned: _pinned, ...convRest } = bundle.conversation;
  const conversation: Conversation = {
    ...convRest,
    id: newId("conv"),
    messages,
    activeQuestionId: remapQ(bundle.conversation.activeQuestionId) ?? null,
    gatewaySessionId: null,
    createdAt: bundle.conversation.createdAt || now,
    updatedAt: now,
  };

  // 4) 评测:仅保留 messageId 命中本会话的;全新 id,messageId/questionId 改写。
  const evaluations = bundle.evaluations
    .filter((e) => msgIdMap.has(e.messageId))
    .map((e) => ({
      ...e,
      id: newId("eval"),
      messageId: msgIdMap.get(e.messageId) as string,
      questionId: remapQ(e.questionId) ?? e.questionId,
      agentProfileId: reanchor(e.agentProfileId) ?? undefined,
    }));

  return {
    conversation,
    questions,
    evaluations,
    addedQuestions: added,
    reusedQuestions: reused,
    evaluationCount: evaluations.length,
  };
}
