/**
 * useSliceSync — diff a state slice on every render and enqueue outbox writes
 * for added / changed / removed records. Lets the store keep its existing
 * setState API while every mutation still ends up persisted to the backend.
 *
 * Usage:
 *   useSliceSync(questions, "questions");
 *   useSliceSync(evaluations, "evaluations");
 *
 * The diff is shallow-equality by reference: if the array contains the same
 * object reference, no outbox entry is created. Since the store uses immutable
 * updates (setQuestions(prev => prev.map(...))) this is precise enough.
 *
 * For `messages` (nested inside conversations) we have a sibling helper
 * `useMessagesSync` that also passes the parent conversation id as scopeId.
 */

import { useEffect, useRef } from "react";
import { outbox, type OutboxTable } from "./outbox";
import { getProfileKind } from "@/agents/registry";

interface WithId {
  id: string;
}

/**
 * Generic slice sync for top-level entity tables. Compares the current array
 * to the previous render's snapshot and enqueues:
 *   - upsert for any record that is new or whose object reference changed
 *   - delete for any record that disappeared
 */
export function useSliceSync<T extends WithId>(
  items: T[],
  table: Exclude<OutboxTable, "messages" | "settings">,
  opts?: { enabled?: boolean },
): void {
  const enabled = opts?.enabled !== false;
  const prevRef = useRef<T[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const prev = prevRef.current;
    prevRef.current = items;
    if (prev === null) {
      // First mount — don't flood the outbox; boot hydration is responsible
      // for the initial sync (or the user's dry-run import).
      return;
    }
    const prevMap = new Map(prev.map((x) => [x.id, x]));
    const nextMap = new Map(items.map((x) => [x.id, x]));

    for (const [id, next] of nextMap) {
      const prevItem = prevMap.get(id);
      if (prevItem === next) continue; // unchanged reference
      outbox.enqueue({ table, op: "upsert", recordId: id, payload: next });
    }
    for (const [id] of prevMap) {
      if (!nextMap.has(id)) {
        outbox.enqueue({ table, op: "delete", recordId: id });
      }
    }
  }, [items, table, enabled]);
}

/**
 * Per-conversation messages sync. Walks every conversation; within each, diffs
 * the messages array and enqueues upserts/deletes scoped to that conversation.
 */
export function useMessagesSync<
  C extends { id: string; messages?: M[] },
  M extends WithId,
>(conversations: C[], opts?: { enabled?: boolean }): void {
  const enabled = opts?.enabled !== false;
  const prevRef = useRef<C[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const prev = prevRef.current;
    prevRef.current = conversations;
    if (prev === null) return;

    const prevByConv = new Map(prev.map((c) => [c.id, c.messages ?? []]));
    for (const conv of conversations) {
      const prevMsgs = prevByConv.get(conv.id) ?? [];
      const nextMsgs = conv.messages ?? [];
      if (prevMsgs === nextMsgs) continue;
      const prevMap = new Map(prevMsgs.map((m) => [m.id, m]));
      const nextMap = new Map(nextMsgs.map((m) => [m.id, m]));
      for (const [mid, m] of nextMap) {
        if (prevMap.get(mid) === m) continue;
        outbox.enqueue({
          table: "messages",
          op: "upsert",
          scopeId: conv.id,
          recordId: mid,
          payload: m,
        });
      }
      for (const [mid] of prevMap) {
        if (!nextMap.has(mid)) {
          outbox.enqueue({
            table: "messages",
            op: "delete",
            scopeId: conv.id,
            recordId: mid,
          });
        }
      }
    }
    // Deleted conversations' messages get cleaned up by cascade on the server
    // (or by an explicit delete of the conversation), no need to enumerate here.
  }, [conversations, enabled]);
}

/**
 * Profiles split-router. Frontend keeps a single `profiles` array; backend
 * has two tables (agent_profiles, llm_profiles). For each diff entry, route
 * to the right table based on its provider's kind.
 *
 * Special case: if a profile's provider was renamed across versions and
 * `getProfileKind` returns null, fall back to the "agents" table — safer
 * than dropping the write.
 */
export function useProfilesSync<
  P extends WithId & { providerId: string },
>(profiles: P[], opts?: { enabled?: boolean }): void {
  const enabled = opts?.enabled !== false;
  const prevRef = useRef<P[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const prev = prevRef.current;
    prevRef.current = profiles;
    if (prev === null) return;

    const tableOf = (p: P): OutboxTable =>
      getProfileKind(p.providerId) === "llm" ? "llms" : "agents";

    const prevMap = new Map(prev.map((x) => [x.id, x]));
    const nextMap = new Map(profiles.map((x) => [x.id, x]));

    for (const [id, next] of nextMap) {
      const prevItem = prevMap.get(id);
      if (prevItem === next) continue;
      outbox.enqueue({
        table: tableOf(next),
        op: "upsert",
        recordId: id,
        payload: next,
      });
    }
    for (const [id, oldItem] of prevMap) {
      if (!nextMap.has(id)) {
        // Delete from whichever table this profile lived in.
        outbox.enqueue({
          table: tableOf(oldItem),
          op: "delete",
          recordId: id,
        });
      }
    }
  }, [profiles, enabled]);
}

/**
 * Sync simple key/value settings — each tracked value becomes one `settings`
 * row. Pass a stable object whose keys map to the settings key in the backend.
 */
export function useSettingsSync(
  values: Record<string, unknown>,
  opts?: { enabled?: boolean },
): void {
  const enabled = opts?.enabled !== false;
  const prevRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const prev = prevRef.current;
    prevRef.current = values;
    if (prev === null) return;
    for (const k of Object.keys(values)) {
      if (values[k] !== prev[k]) {
        outbox.enqueue({
          table: "settings",
          op: "upsert",
          recordId: k,
          payload: values[k],
        });
      }
    }
  }, [values, enabled]);
}
