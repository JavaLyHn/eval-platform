/**
 * Thin fetch wrapper for the eval-platform Python backend.
 *
 * Base URL + token come from Vite env (`VITE_SERVER_URL`, `VITE_SERVER_TOKEN`).
 * Defaults match `server/.env.example`.
 */
import type { PlatformSkill, PlatformEmployee } from "@/types";
import type { AgentRepoEmployee, AgentRepoSkill, AgentRepoSkillSummary } from "@/lib/agent-repo";
import { shouldRedirectOn401 } from "./api-auth";

const BASE = import.meta.env.VITE_SERVER_URL ?? "";

/** 后端 /v1/auth/* 返回的公开用户视图(me / login / password)。 */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string;
  /** false = Google 建的无密码账户(只能 Google 登录,可在个人信息里设置密码)。 */
  hasPassword: boolean;
}

async function request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (res.status === 401 && shouldRedirectOn401(path)) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 后端错误体一般是 {"detail":"中文提示"} —— 抽出 detail 当 message,
    // 避免上层直接把原始 JSON 串显示给用户(如登录失败)。
    let detail = "";
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      detail = body;
    }
    // 把 HTTP 状态码结构化挂到 Error 上。后端错误体是 {"detail":"中文提示"},
    // detail 抽出来当 message 后状态码就从文案里消失了 —— 上层(如 outbox 判
    // 「delete 拿到 404 视为成功」)不能再靠匹配本地化文案猜状态,改读 err.status。
    const err = new Error(detail || `${res.status} ${res.statusText}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function entityRoutes<T extends { id: string }>(prefix: string) {
  return {
    list: () => request<T[]>(`/v1/${prefix}`),
    get: (id: string) => request<T>(`/v1/${prefix}/${encodeURIComponent(id)}`),
    upsert: (entity: T) =>
      request<T>(`/v1/${prefix}/${encodeURIComponent(entity.id)}`, {
        method: "PUT",
        body: JSON.stringify(entity),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/v1/${prefix}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
  };
}

export const api = {
  baseUrl: BASE,
  auth: {
    me: () => request<PublicUser>("/v1/auth/me"),
    login: (email: string, password: string) =>
      request<PublicUser>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    logout: () => request<void>("/v1/auth/logout", { method: "POST" }),
    // 设置 / 修改当前用户密码。Google 无密码账户首次设置不传 currentPassword;
    // 已有密码的账户需传 currentPassword 校验。设置后即可用邮箱 + 密码登录。
    setPassword: (password: string, currentPassword?: string) =>
      request<PublicUser>("/v1/auth/password", {
        method: "POST",
        body: JSON.stringify({ password, currentPassword }),
      }),
    // 同步当前用户资料(姓名 / 头像)到后端 PG。注意:首页那个「角色 / 职位」是
    // 本地概念,后端 role 是鉴权角色,刻意不在此上行。
    updateProfile: (patch: { name?: string; avatarUrl?: string | null }) =>
      request<PublicUser>("/v1/auth/profile", {
        method: "POST",
        body: JSON.stringify(patch),
      }),
  },
  health: () => request<{ status: string; service: string; version: string }>("/health"),

  questions: entityRoutes<{ id: string }>("questions"),
  conversations: entityRoutes<{ id: string }>("conversations"),
  evaluations: entityRoutes<{ id: string }>("evaluations"),
  reports: entityRoutes<{ id: string }>("reports"),
  skillReports: entityRoutes<{ id: string }>("skill-reports"),
  // 被测对象 (走 bridge 的智能体). See server/app/models.py AgentProfile.
  agents: entityRoutes<{ id: string }>("agents"),
  // 裁判 / AI 出题 / 反思用的 LLM. Separate table from agents.
  llms: entityRoutes<{ id: string }>("llms"),
  // Prompt 管理:每个 prompt key 一行(自定义版本数组 + 生效指针 + 变量定制)。
  prompts: entityRoutes<{ id: string }>("prompts"),

  messages: {
    list: (conversationId: string) =>
      request<unknown[]>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`),
    upsert: (conversationId: string, msg: { id: string }) =>
      request(
        `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(msg.id)}`,
        { method: "PUT", body: JSON.stringify(msg) },
      ),
    delete: (conversationId: string, messageId: string) =>
      request(
        `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
        { method: "DELETE" },
      ),
  },

  settings: {
    list: () => request<Record<string, unknown>>("/v1/settings"),
    get: (key: string) => request<{ key: string; value: unknown }>(`/v1/settings/${encodeURIComponent(key)}`),
    put: (key: string, value: unknown) =>
      request<{ key: string; value: unknown }>(`/v1/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      }),
  },

  migrate: (dump: Record<string, unknown>) =>
    request<{ ok: boolean; imported: Record<string, number> }>("/admin/migrate", {
      method: "POST",
      body: JSON.stringify(dump),
    }),

  agentRepo: {
    employees: () =>
      request<{ ok: boolean; employees: AgentRepoEmployee[]; detail?: string }>(`/v1/agent-repo/employees`),
    employee: (dir: string) =>
      request<{ ok: boolean; name: string; defFiles: string[]; skills: AgentRepoSkillSummary[]; detail?: string }>(
        `/v1/agent-repo/employees/${encodeURIComponent(dir)}`,
      ),
    skill: (emp: string, skill: string) =>
      request<{ ok: boolean; skill: AgentRepoSkill; detail?: string }>(
        `/v1/agent-repo/skill?emp=${encodeURIComponent(emp)}&skill=${encodeURIComponent(skill)}`,
      ),
    file: (path: string) =>
      request<{ ok: boolean; path: string; body: string; detail?: string }>(
        `/v1/agent-repo/file?path=${encodeURIComponent(path)}`,
      ),
    common: () =>
      request<{ ok: boolean; prompts: { path: string }[]; okrExecutor: AgentRepoSkill; detail?: string }>(`/v1/agent-repo/common`),
    branches: () =>
      request<{ ok: boolean; branches?: string[]; current?: string; detail?: string }>(
        `/v1/agent-repo/branches`,
      ),
    refresh: (branch?: string) =>
      request<{ ok: boolean; head?: string; branch?: string; output?: string; detail?: string }>(
        `/v1/agent-repo/refresh${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
        { method: "POST" },
      ),
  },

  platform: {
    skills: (opts?: { instanceId?: string; templateId?: string }) => {
      const q = new URLSearchParams();
      if (opts?.instanceId) q.set("instanceId", opts.instanceId);
      if (opts?.templateId) q.set("templateId", opts.templateId);
      const qs = q.toString();
      return request<{ ok: boolean; skills: PlatformSkill[]; templateId?: string; templateName?: string; detail?: string }>(
        `/v1/platform/skills${qs ? `?${qs}` : ""}`,
      );
    },
    employees: () =>
      request<{ ok: boolean; employees: PlatformEmployee[]; detail?: string }>(`/v1/platform/employees`),
  },
};
