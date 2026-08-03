/**
 * Outbox — durable write queue between in-memory state and the backend.
 *
 * Every mutation produces an OutboxEntry (upsert / delete). A background worker
 * drains the queue with exponential backoff. Queue is persisted to localStorage
 * so reloads / refreshes / crashes don't lose pending writes.
 *
 * Invariants:
 *  - At most ONE pending entry per (table, scopeId, recordId). New writes
 *    coalesce on top of an old pending entry (last-write-wins locally).
 *  - Permanent failures (>= MAX_ATTEMPTS) are kept on a "dead letter" list
 *    visible in the banner — the user can manually retry.
 *  - Worker is idle when queue is empty AND when navigator.onLine === false.
 *
 * The outbox is intentionally synchronous and side-effecty: store setters call
 * `outbox.enqueue(...)`, no awaits. The worker handles network I/O.
 */

import { api } from "./api";

export type OutboxTable =
  | "questions"
  | "conversations"
  | "messages"
  | "evaluations"
  | "reports"
  | "skillReports"
  | "agents"
  | "llms"
  | "prompts"
  | "settings";

export type OutboxOp = "upsert" | "delete";

export interface OutboxEntry {
  /** Stable id of THIS queue entry (not the record). */
  id: string;
  enqueuedAt: number;
  table: OutboxTable;
  op: OutboxOp;
  /** Primary key of the record (or settings key). */
  recordId: string;
  /** Conversation id for `messages` table; settings key uses recordId. */
  scopeId?: string;
  /** Full upsert payload, omitted for delete. */
  payload?: unknown;
  attempts: number;
  /** Earliest timestamp at which this entry may be retried. */
  nextRetryAt: number;
  /** Last error message, set after a failed attempt. */
  lastError?: string;
  /** True when attempts >= MAX_ATTEMPTS — no further auto-retry. */
  dead?: boolean;
}

const STORAGE_KEY = "eval-platform:outbox:v1";
const MAX_ATTEMPTS = 8;
const POLL_MS = 1500;
const MAX_CONCURRENCY = 6;

interface State {
  pending: OutboxEntry[];
  /** dead-letter entries — kept for visibility, not auto-retried */
  dead: OutboxEntry[];
}

type Listener = (s: State) => void;

function loadState(): State {
  if (typeof localStorage === "undefined") return { pending: [], dead: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pending: [], dead: [] };
    const parsed = JSON.parse(raw) as State;
    const pending = Array.isArray(parsed.pending) ? parsed.pending : [];
    const dead = Array.isArray(parsed.dead) ? parsed.dead : [];
    // 自愈:把 dead 里的 DELETE 重新入队再跑一次。dispatch 现在幂等处理删除——
    // 目标在服务器上不存在、或不归当前用户所有(均返回 404)都视为成功,所以这类
    // 删除不该永久挂在「保存失败」横幅上(多为旧代码遗留 / 跨用户 seed id 撞车)。
    // upsert 仍保留在 dead(可能携带尚未同步的真实数据,不能静默丢弃)。
    const now = Date.now();
    const revived = dead
      .filter((e) => e.op === "delete")
      .map((e) => ({
        ...e,
        attempts: 0,
        nextRetryAt: now,
        dead: false,
        lastError: undefined,
      }));
    const stillDead = dead.filter((e) => e.op !== "delete");
    return { pending: [...pending, ...revived], dead: stillDead };
  } catch {
    return { pending: [], dead: [] };
  }
}

function saveState(s: State): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn("[outbox] persist failed:", e);
  }
}

function keyOf(table: OutboxTable, scopeId: string | undefined, recordId: string): string {
  return `${table}|${scopeId ?? ""}|${recordId}`;
}

function nextId(): string {
  return `ob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class Outbox {
  private state: State = loadState();
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  // C-1:仅内存、不持久化的单调计数 —— 本进程启动以来一共 enqueue 过多少条 delete。
  // 页面重载走的是 boot hydration(全量重拉,没有"飞行中的旧响应"要复核),不需要跨
  // 会话记忆,所以特意不落 localStorage。
  //
  // 为什么不能用 size() 代替:size() 是"当前还没排空的条数",而 use-qa-store 的
  // refetchFromServer 要复核的是"起飞到落地这段时间窗口里,本机是否发生过删除"——
  // 哪怕这条 delete 已经在窗口内排空完毕、size() 早就回到 0,只要它发生过,这次拉取
  // 落地时快照里的对应记录就可能是"用户已经删掉、但服务器当时还没来得及删"的过期状态,
  // 采纳它会把删除静默复活。deleteCount 是只增不减的计数,配合"起飞前后各取一次快照
  // 比较是否变化",能测出这种"发生过又排空了"的情况,size() 做不到。
  private deleteCount = 0;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, POLL_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => void this.flush());
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(
    entry: Pick<OutboxEntry, "table" | "op" | "recordId" | "payload"> & {
      scopeId?: string;
    },
  ): void {
    const k = keyOf(entry.table, entry.scopeId, entry.recordId);
    const now = Date.now();
    // C-1:计数只关心"这次入队的是不是 delete",与下面的 coalesce(挤掉同 key 的旧
    // pending 条目)无关 —— 即便旧条目是 upsert、被这条 delete 覆盖掉,也要算一次。
    if (entry.op === "delete") this.deleteCount += 1;
    // Coalesce: drop any pending entry with the same key — last write wins.
    this.state.pending = this.state.pending.filter(
      (e) => keyOf(e.table, e.scopeId, e.recordId) !== k,
    );
    this.state.pending.push({
      id: nextId(),
      enqueuedAt: now,
      table: entry.table,
      op: entry.op,
      recordId: entry.recordId,
      scopeId: entry.scopeId,
      payload: entry.payload,
      attempts: 0,
      nextRetryAt: now,
    });
    this.persist();
    // Best-effort: kick the worker (without waiting for next interval).
    void this.flush();
  }

  size(): number {
    return this.state.pending.length;
  }

  failedCount(): number {
    return this.state.dead.length;
  }

  /**
   * C-1:本进程内累计 enqueue 过多少条 delete(只增不减,见字段注释)。
   * 给"重新拉取的落地复核"用:起飞前记一次、落地后再记一次,不一致就说明飞行期间
   * 本机发生过删除 —— 这份快照可能已经过期,整份丢弃比采纳更安全。
   */
  deletesEnqueued(): number {
    return this.deleteCount;
  }

  snapshot(): State {
    return {
      pending: [...this.state.pending],
      dead: [...this.state.dead],
    };
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.snapshot());
    return () => {
      this.listeners.delete(cb);
    };
  }

  retryDead(): void {
    const now = Date.now();
    for (const e of this.state.dead) {
      e.attempts = 0;
      e.nextRetryAt = now;
      e.dead = false;
      e.lastError = undefined;
      this.state.pending.push(e);
    }
    this.state.dead = [];
    this.persist();
    void this.flush();
  }

  /** Forget every pending + dead entry. Destructive; only for hard reset / dev. */
  clear(): void {
    this.state.pending = [];
    this.state.dead = [];
    this.persist();
  }

  /** Drop only the dead-letter list. Pending entries continue to retry. */
  clearDead(): void {
    if (this.state.dead.length === 0) return;
    this.state.dead = [];
    this.persist();
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    this.flushing = true;
    const inFlight = new Set<string>();
    const pickNext = (): OutboxEntry | null => {
      const now = Date.now();
      for (const e of this.state.pending) {
        if (!inFlight.has(e.id) && e.nextRetryAt <= now) return e;
      }
      return null;
    };
    const worker = async (): Promise<void> => {
      let entry: OutboxEntry | null;
      while ((entry = pickNext()) !== null) {
        const cur = entry;
        inFlight.add(cur.id);
        let ok = false;
        try {
          ok = await this.dispatch(cur);
        } finally {
          inFlight.delete(cur.id);
        }
        this._settle(cur, ok);
      }
    };
    try {
      await Promise.all(Array.from({ length: MAX_CONCURRENCY }, () => worker()));
    } finally {
      this.flushing = false;
    }
  }

  /** 应用一次派发结果:成功→移除;失败→退避 / 死信。与原串行版逻辑一致。 */
  private _settle(entry: OutboxEntry, ok: boolean): void {
    if (ok) {
      this.state.pending = this.state.pending.filter((e) => e.id !== entry.id);
      this.persist();
      return;
    }
    entry.attempts += 1;
    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 60s.
    const delayMs = Math.min(1000 * 2 ** entry.attempts, 60_000);
    entry.nextRetryAt = Date.now() + delayMs;
    if (entry.attempts >= MAX_ATTEMPTS) {
      entry.dead = true;
      this.state.pending = this.state.pending.filter((e) => e.id !== entry.id);
      this.state.dead.push(entry);
    }
    this.persist();
  }

  private async dispatch(entry: OutboxEntry): Promise<boolean> {
    try {
      switch (entry.table) {
        case "questions":
          if (entry.op === "delete") {
            await api.questions.delete(entry.recordId);
          } else {
            await api.questions.upsert(entry.payload as { id: string });
          }
          return true;
        case "conversations":
          if (entry.op === "delete") {
            await api.conversations.delete(entry.recordId);
          } else {
            await api.conversations.upsert(entry.payload as { id: string });
          }
          return true;
        case "messages":
          if (!entry.scopeId)
            throw new Error("messages entry missing scopeId (conversation id)");
          if (entry.op === "delete") {
            await api.messages.delete(entry.scopeId, entry.recordId);
          } else {
            await api.messages.upsert(
              entry.scopeId,
              entry.payload as { id: string },
            );
          }
          return true;
        case "evaluations":
          if (entry.op === "delete") {
            await api.evaluations.delete(entry.recordId);
          } else {
            await api.evaluations.upsert(entry.payload as { id: string });
          }
          return true;
        case "reports":
          if (entry.op === "delete") {
            await api.reports.delete(entry.recordId);
          } else {
            await api.reports.upsert(entry.payload as { id: string });
          }
          return true;
        case "skillReports":
          if (entry.op === "delete") {
            await api.skillReports.delete(entry.recordId);
          } else {
            // logs 不入 PG 且不上行:发送前剥掉(本机内存仍保留 logs 供预览)。
            const payload = { ...(entry.payload as Record<string, unknown>) };
            delete payload.logs;
            await api.skillReports.upsert(payload as { id: string });
          }
          return true;
        case "agents":
          if (entry.op === "delete") {
            await api.agents.delete(entry.recordId);
          } else {
            await api.agents.upsert(entry.payload as { id: string });
          }
          return true;
        case "llms":
          if (entry.op === "delete") {
            await api.llms.delete(entry.recordId);
          } else {
            await api.llms.upsert(entry.payload as { id: string });
          }
          return true;
        case "prompts":
          if (entry.op === "delete") {
            await api.prompts.delete(entry.recordId);
          } else {
            await api.prompts.upsert(entry.payload as { id: string });
          }
          return true;
        case "settings":
          if (entry.op === "delete") {
            await api.settings.put(entry.recordId, null);
          } else {
            await api.settings.put(entry.recordId, entry.payload);
          }
          return true;
      }
    } catch (e) {
      const msg = (e as Error).message || String(e);
      const status = (e as { status?: number }).status;
      // DELETE 拿到 404 = 想删的东西不存在(或不归当前用户所有)= 目标状态已达成
      // → 视为成功(idempotent delete)。否则本地已删、却从未同步到服务器的记录会
      // 在 outbox 里一直重试到 MAX_ATTEMPTS,最后落进 dead-letter 列表卡住横幅。
      // 按 err.status 判定:api.ts 把后端 {"detail":...} 的中文提示抽成 message 后,
      // 状态码已不在文案里,旧的 /^404\b/ 文案匹配永远命中不了(正是横幅常驻的根因)。
      // 仍保留正则作为状态码缺失时的兜底。
      if (entry.op === "delete" && (status === 404 || /^404\b/.test(msg))) {
        return true;
      }
      entry.lastError = msg;
      return false;
    }
  }

  private persist(): void {
    saveState(this.state);
    for (const cb of this.listeners) cb(this.snapshot());
  }
}

export const outbox = new Outbox();

if (typeof window !== "undefined") {
  outbox.start();
}
