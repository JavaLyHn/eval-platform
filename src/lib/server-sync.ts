/**
 * Bridge between localStorage-backed UI state and the postgres backend.
 *
 * Phase 1 (current): server is a *destination* — we one-shot migrate
 * localStorage → DB on demand, but the UI still reads/writes localStorage
 * as primary. Verifies end-to-end without forcing a store refactor.
 *
 * Phase 2 (next iteration): boot reads from server → state, every store
 * mutation mirrors to server. Marked as TODO below.
 */

import { api } from "./api";
import { STORAGE_KEYS, loadSlice } from "./persistence";
import { getProfileKind } from "@/agents/registry";

const AGENT_PROFILES_KEY = "eval-platform:agent-profiles:v1";
const AGENT_ACTIVE_KEY = "eval-platform:agent-profiles:active";

export interface LocalDataSummary {
  questions: number;
  conversations: number;
  messages: number;
  evaluations: number;
  reports: number;
  agents: number;
  settingsKeys: number;
}

/** Quickly check if the backend is reachable. */
export async function isServerUp(): Promise<boolean> {
  try {
    await api.health();
    return true;
  } catch {
    return false;
  }
}

/** Tally the localStorage state — used to decide whether a migration is meaningful. */
export function summarizeLocalData(): LocalDataSummary {
  const questions = loadSlice<unknown[]>(STORAGE_KEYS.questions, []);
  const conversations = loadSlice<Array<{ messages?: unknown[] }>>(STORAGE_KEYS.conversations, []);
  const evaluations = loadSlice<unknown[]>(STORAGE_KEYS.evaluations, []);
  const reports = loadSlice<unknown[]>(STORAGE_KEYS.reports, []);
  let agentsRaw: unknown[] = [];
  try {
    const raw = localStorage.getItem(AGENT_PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.profiles)) agentsRaw = parsed.profiles;
    }
  } catch {
    /* ignore */
  }
  const settingsKeys = [
    STORAGE_KEYS.ui,
    STORAGE_KEYS.user,
    STORAGE_KEYS.customCategories,
    STORAGE_KEYS.hiddenCategories,
    STORAGE_KEYS.defaultCriteria,
    STORAGE_KEYS.lastGeneratorProfileId,
    AGENT_ACTIVE_KEY,
  ].filter((k) => localStorage.getItem(k) !== null).length;

  const messages = conversations.reduce(
    (acc, c) => acc + (Array.isArray(c.messages) ? c.messages.length : 0),
    0,
  );

  return {
    questions: questions.length,
    conversations: conversations.length,
    messages,
    evaluations: evaluations.length,
    reports: reports.length,
    agents: agentsRaw.length,
    settingsKeys,
  };
}

function readSettingsDump(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: Record<string, string> = {
    ui: STORAGE_KEYS.ui,
    user: STORAGE_KEYS.user,
    customCategories: STORAGE_KEYS.customCategories,
    hiddenCategories: STORAGE_KEYS.hiddenCategories,
    defaultCriteria: STORAGE_KEYS.defaultCriteria,
    lastGeneratorProfileId: STORAGE_KEYS.lastGeneratorProfileId,
  };
  for (const [k, sk] of Object.entries(map)) {
    const val = loadSlice<unknown>(sk, null);
    if (val !== null && val !== undefined) out[k] = val;
  }
  const activeAgent = localStorage.getItem(AGENT_ACTIVE_KEY);
  if (activeAgent) out["activeAgentProfileId"] = activeAgent;
  return out;
}

function readAgentsDump(): unknown[] {
  try {
    const raw = localStorage.getItem(AGENT_PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.profiles) ? parsed.profiles : [];
  } catch {
    return [];
  }
}

/**
 * One-shot localStorage → postgres migration.
 * Idempotent: server upserts by id, safe to retry.
 *
 * Profiles are split into `agents` and `llms` by `providerId` kind so each
 * lands in the correct backend table. (The server-side migrate route also
 * splits as a defense in depth, so old clients still work.)
 */
export async function migrateLocalToServer() {
  const allProfiles = readAgentsDump() as Array<{ id?: string; providerId?: string }>;
  const agents: unknown[] = [];
  const llms: unknown[] = [];
  for (const p of allProfiles) {
    const kind = p.providerId ? getProfileKind(p.providerId) : null;
    if (kind === "llm") llms.push(p);
    else agents.push(p);
  }
  // mock 会话 / 空会话不入库(与 outbox 同口径)→ 启动一次性迁移时也滤掉,只迁真实会话。
  const mockIds = new Set(
    allProfiles.filter((p) => p.providerId === "mock").map((p) => p.id).filter(Boolean),
  );
  const allConvs = loadSlice<
    Array<{ messages?: Array<{ agentProfileId?: string }> }>
  >(STORAGE_KEYS.conversations, []);
  const conversations = allConvs.filter((c) => {
    const msgs = c.messages ?? [];
    if (msgs.length === 0) return false;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const aid = msgs[i].agentProfileId;
      if (aid) return !mockIds.has(aid);
    }
    return true;
  });
  const questions = loadSlice<
    Array<{ transient?: boolean; agentIds?: string[] }>
  >(STORAGE_KEYS.questions, []).filter(
    (q) =>
      !(
        q.transient &&
        Array.isArray(q.agentIds) &&
        q.agentIds.length > 0 &&
        q.agentIds.every((id) => mockIds.has(id))
      ),
  );
  const dump = {
    questions,
    conversations,
    evaluations: loadSlice<unknown[]>(STORAGE_KEYS.evaluations, []),
    reports: loadSlice<unknown[]>(STORAGE_KEYS.reports, []),
    agents,
    llms,
    settings: readSettingsDump(),
  };
  return api.migrate(dump);
}
