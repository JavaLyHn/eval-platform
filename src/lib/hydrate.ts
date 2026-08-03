/**
 * Boot-time hydration from the backend.
 *
 * On every app mount we ask the server for its current view of each entity
 * table, then **merge** those rows into the local state using a *local-wins*
 * policy: any record already present in localStorage stays as-is; server rows
 * with previously-unseen ids are appended. This preserves offline edits while
 * letting a fresh browser pick up data created on other devices.
 *
 * Degraded mode: when `isServerUp()` is false we resolve immediately and the
 * UI continues from localStorage. The status banner surfaces that state.
 *
 * NOT a two-way sync — outgoing writes are handled by the outbox. This is the
 * "read once on boot" half of the contract.
 */

import { api } from "./api";
import { isServerUp } from "./server-sync";

export interface HydrationResult {
  /** False ⇒ server unreachable, app continues degraded from localStorage. */
  serverUp: boolean;
  /** Per-table records fetched (mergeable by id). null = fetch failed. */
  questions: Array<{ id: string }> | null;
  conversations: Array<{
    id: string;
    messages?: Array<{ id: string }>;
  }> | null;
  /** Per-conversation messages, fetched separately because the list endpoint
   *  returns metadata only. */
  messagesByConversation: Map<string, Array<{ id: string }>>;
  evaluations: Array<{ id: string }> | null;
  reports: Array<{ id: string }> | null;
  skillReports: Array<{ id: string }> | null;
  /**
   * Combined agent + LLM profiles. The two backend tables are merged into a
   * single array on the client — frontend's `profiles` state is unified.
   */
  agents: Array<{ id: string }> | null;
  /** Prompt 管理:每个 prompt key 一行的覆盖状态(versions / activeVersion / 变量定制)。 */
  prompts: Array<{ id: string }> | null;
  settings: Record<string, unknown> | null;
}

const EMPTY: HydrationResult = {
  serverUp: false,
  questions: null,
  conversations: null,
  messagesByConversation: new Map(),
  evaluations: null,
  reports: null,
  skillReports: null,
  agents: null,
  prompts: null,
  settings: null,
};

export async function hydrateFromServer(): Promise<HydrationResult> {
  const up = await isServerUp();
  if (!up) return EMPTY;

  // Parallel fetch of the seven top-level slices. Agents and LLMs live in
  // separate tables on the server (see server/app/models.py) but the
  // frontend keeps a single `profiles` array — merge them here.
  const [qs, convs, evs, reps, srs, ags, lms, prompts, settings] =
    await Promise.all([
      api.questions.list().catch(() => null),
      api.conversations.list().catch(() => null),
      api.evaluations.list().catch(() => null),
      api.reports.list().catch(() => null),
      api.skillReports.list().catch(() => null),
      api.agents.list().catch(() => null),
      api.llms.list().catch(() => null),
      api.prompts.list().catch(() => null),
      api.settings.list().catch(() => null),
    ]);

  // Combine agent + llm profiles, dedupe by id (id should already be unique).
  const combinedProfiles: Array<{ id: string }> | null =
    ags || lms
      ? [
          ...((ags as Array<{ id: string }> | null) ?? []),
          ...((lms as Array<{ id: string }> | null) ?? []),
        ]
      : null;

  // Hydrate messages per-conversation. List endpoint returns metadata only.
  const messagesByConversation = new Map<string, Array<{ id: string }>>();
  if (convs) {
    await Promise.all(
      (convs as Array<{ id: string }>).map(async (c) => {
        try {
          const msgs = (await api.messages.list(c.id)) as Array<{ id: string }>;
          messagesByConversation.set(c.id, msgs);
        } catch {
          /* leave conversation with whatever embedded messages it has */
        }
      }),
    );
  }

  return {
    serverUp: true,
    questions: qs as Array<{ id: string }> | null,
    conversations: convs as Array<{
      id: string;
      messages?: Array<{ id: string }>;
    }> | null,
    messagesByConversation,
    evaluations: evs as Array<{ id: string }> | null,
    reports: reps as Array<{ id: string }> | null,
    skillReports: srs as Array<{ id: string }> | null,
    agents: combinedProfiles,
    prompts: prompts as Array<{ id: string }> | null,
    settings: settings as Record<string, unknown> | null,
  };
}

/**
 * Merge by id with *local-wins* semantics — local entries that exist beat
 * server entries with the same id; server-only ids are appended.
 *
 * Why local-wins: outgoing writes flow through the outbox, so anything edited
 * locally is already queued for upload. Letting server overwrite would risk
 * clobbering an offline edit that hasn't drained yet.
 */
export function mergeById<T extends { id: string }>(
  local: T[],
  server: T[] | null,
): T[] {
  if (!server || server.length === 0) return local;
  const localIds = new Set(local.map((x) => x.id));
  const serverOnly = server.filter((s) => !localIds.has(s.id));
  if (serverOnly.length === 0) return local;
  return [...local, ...serverOnly];
}

/**
 * Like {@link mergeById}, but first drops local items whose id is in
 * `dropIds` — used for **fresh-seeded placeholders** (the boot-time default
 * conversation / mock agent profile created when localStorage is empty).
 *
 * Those placeholders carry random ids, so plain mergeById would treat them as
 * "local-only" data, keep them, and let the outbox sync them to the server —
 * accumulating one duplicate per fresh device. Dropping them here (only when
 * the server actually returned data) means they never survive hydration and
 * thus never sync. When the server has nothing, local is returned untouched so
 * the placeholder still bootstraps a brand-new install.
 */
export function mergeByIdDropping<T extends { id: string }>(
  local: T[],
  server: T[] | null,
  dropIds: Set<string>,
): T[] {
  if (!server || server.length === 0) return local;
  const base = dropIds.size > 0 ? local.filter((x) => !dropIds.has(x.id)) : local;
  return mergeById(base, server);
}

/**
 * 消息级并集 —— 跨设备同步的下行合并单元。
 *
 * 同 id **本机对象胜出**:消息 id 由创建它的那台设备生成,所以同 id 只可能是"本机自己
 * 创建过、已推给服务器"的那条 —— 本机版本要么等价、要么更完整(带尚未排空的编辑)。
 *
 * 服务器上 `isStreaming` 的消息**不采纳**:local-wins 意味着一旦收下就再也不会更新,
 * 会把另一台设备正在生成的半截气泡永久钉在这里。跳过 → 下次拉取拿到写完的版本。
 *
 * 排序:全部消息的 `createdAt` 都能解析才排;**必须用 Date.parse** —— 服务器回的是
 * `+08:00` 偏移(见 server/app/routes/_helpers.py 的 to_payload),本机写的是 `Z`,
 * 字符串序和时间序不一致。任一条缺 createdAt 就退回"本机原序 + 新增追加在尾部"。
 *
 * 无新增时返回**传入的同一引用** —— 重复拉取靠这条避免无谓 re-render 与回声写。
 */
export function mergeMessagesById<
  M extends { id: string; createdAt?: string; isStreaming?: boolean },
>(local: M[], server: M[] | null | undefined): M[] {
  if (!server || server.length === 0) return local;
  const localIds = new Set(local.map((m) => m.id));
  const serverOnly = server.filter((m) => !localIds.has(m.id) && !m.isStreaming);
  if (serverOnly.length === 0) return local;
  const merged = [...local, ...serverOnly];
  const decorated = merged.map((m, i) => ({
    m,
    i,
    t: m.createdAt ? Date.parse(m.createdAt) : Number.NaN,
  }));
  if (!decorated.every((d) => Number.isFinite(d.t))) return merged;
  // 装饰排序:同刻按原下标(本机在前、服务器新增在后),不依赖引擎的 sort 稳定性。
  decorated.sort((a, b) => a.t - b.t || a.i - b.i);
  return decorated.map((d) => d.m);
}

/**
 * 会话合并:**元信息 local-wins,messages 走并集**(见 mergeMessagesById)。
 * 标题等元信息不做"谁更新"的判定 —— 标题本就是本地从首条用户消息派生的。
 *
 * `dropIds` 与 {@link mergeByIdDropping} 同义:服务器确实有数据时才丢弃本机的 fresh 占位会话。
 *
 * 本机完全没见过的会话(serverOnly)整条并入前,也要过滤掉其中 `isStreaming` 为真的消息 ——
 * 否则会把别的设备正在生成的半截气泡原样端过来,和「两边都有的会话」那支(走
 * mergeMessagesById)的处理不对称。仅当确实存在需要剔除的消息时才新建会话对象,
 * 没有 isStreaming 消息的 serverOnly 会话保持服务器返回的原始引用。
 */
export function mergeConversationsWithMessages<
  M extends { id: string; createdAt?: string; isStreaming?: boolean },
  C extends { id: string; messages?: M[] },
>(local: C[], server: C[] | null, dropIds: Set<string>): C[] {
  if (!server || server.length === 0) return local;
  const base = dropIds.size > 0 ? local.filter((c) => !dropIds.has(c.id)) : local;
  const serverById = new Map(server.map((c) => [c.id, c]));
  let changed = base !== local;
  const mergedLocal = base.map((c) => {
    const s = serverById.get(c.id);
    if (!s) return c;
    const localMsgs = c.messages ?? [];
    const msgs = mergeMessagesById(localMsgs, s.messages);
    if (msgs === localMsgs) return c;
    changed = true;
    return { ...c, messages: msgs };
  });
  const localIds = new Set(base.map((c) => c.id));
  const serverOnly = server
    .filter((c) => !localIds.has(c.id))
    .map((c) => {
      const msgs = c.messages;
      if (!msgs || msgs.length === 0) return c;
      const filtered = msgs.filter((m) => !m.isStreaming);
      if (filtered.length === msgs.length) return c;
      return { ...c, messages: filtered };
    });
  if (!changed && serverOnly.length === 0) return local;
  return [...mergedLocal, ...serverOnly];
}
