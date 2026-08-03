import { shortId } from "@/lib/utils";
import type { AgentProfile } from "./types";

/**
 * Profile persistence — list of saved agent configurations + the active one.
 * Stored in localStorage so they survive page reload.
 */

const STORAGE_KEY = "eval-platform:agent-profiles:v1";
const ACTIVE_KEY = "eval-platform:agent-profiles:active";

interface StoredState {
  profiles: AgentProfile[];
}

export function loadProfiles(): AgentProfile[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredState;
    return Array.isArray(parsed.profiles) ? parsed.profiles : [];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: AgentProfile[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles }));
}

export function loadActiveProfileId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function saveActiveProfileId(id: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (id == null) localStorage.removeItem(ACTIVE_KEY);
  else localStorage.setItem(ACTIVE_KEY, id);
}

/* -------------------------------------------------------------------------- */

export function createProfile(input: Omit<AgentProfile, "id" | "createdAt">): AgentProfile {
  return {
    id: shortId("ap"),
    name: input.name,
    providerId: input.providerId,
    config: input.config,
    createdAt: new Date().toISOString(),
    // 新建默认「未验证」—— 由保存后的自动连接测试(ping 成功)置 true 才显示。
    verified: input.verified ?? false,
  };
}
