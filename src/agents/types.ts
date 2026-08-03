/**
 * Provider/profile contracts for pluggable agent backends.
 *
 * Adding a new agent type = create one file under `providers/` that
 * implements `AgentProvider`, then register it in `providers/index.ts`.
 * The rest of the app is provider-agnostic.
 */

export interface ChatHistoryItem {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface SendMessageParams {
  prompt: string;
  /**
   * 可选:随本轮附带的图片(data URL,base64)。视觉能力的 provider
   * (gateway / openai-compat)会组成 OpenAI 多模态 content 发出;其余 provider 忽略。
   */
  images?: string[];
  questionId?: string;
  /** 0-based turn index for multi-turn questions; lets providers vary per turn. */
  turnIndex?: number;
  /** Conversation context. Providers that maintain server-side session may ignore. */
  history: ChatHistoryItem[];
  /**
   * Upstream session token (e.g. the agent gateway's session key). Pass null to
   * ask the provider to create a fresh session — it should report back via
   * `onSession` so the caller can persist it for follow-up turns.
   */
  sessionId?: string | null;
  signal?: AbortSignal;
  onChunk: (delta: string) => void;
  onComplete: (info: {
    tokens?: number;
    /** 真实/估算的输入 token(prompt 侧)。tokens 仍是总数,二者不冲突。 */
    tokensIn?: number;
    /** 真实/估算的输出 token(completion 侧)。 */
    tokensOut?: number;
    /** true = in/out 为 store 估算(如 platform);缺省 = 厂商真实用量。 */
    tokensEstimated?: boolean;
    durationMs: number;
    modelVersion?: string;
    /** 结构化轨迹(platform provider 在收到 done 时带出)。 */
    transcript?: import("@/types").AgentTranscript;
    /** Agent 暂停等待用户(present_options 等),非真正完成。 */
    interrupted?: boolean;
  }) => void;
  onError: (err: Error) => void;
  /** Optional: progress stage updates surfaced during the thinking phase. */
  onStage?: (stage: string) => void;
  /**
   * Called when the upstream session is established/known. The caller should
   * persist this id and pass it back on subsequent calls to keep context.
   */
  onSession?: (sessionId: string) => void;
}

export interface PingResult {
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

export interface AgentClient {
  /** Human-readable identifier of the model, shown in chat metadata. */
  modelVersion: string;
  sendMessage(params: SendMessageParams): void;
  /** Drop any upstream conversation session so the next call starts fresh. */
  resetSession(): void;
  /** Optional: probe the backend. Returns ok=false with detail on failure. */
  ping?(signal?: AbortSignal): Promise<PingResult>;
  /**
   * Optional: list the skills/tools this agent has loaded. Providers without
   * a usable inventory may omit this — the UI hides the Skills tab in that
   * case.
   */
  listSkills?(signal?: AbortSignal): Promise<import("@/types").AgentSkillsResult>;
}

/* -------------------------------------------------------------------------- */
/* Config schema — describes provider config fields so the UI can render a    */
/* form generically. Keep types small; advanced widgets are not goals here.   */
/* -------------------------------------------------------------------------- */

export type FieldType =
  | "string"
  | "secret"
  | "url"
  | "number"
  | "boolean"
  | "select";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  /** Inline help shown under the field. */
  help?: string;
  /** Options for `type === "select"`. */
  options?: Array<{ value: string; label: string }>;
}

/**
 * Two kinds of providers, deliberately separated:
 *  - "agent": a full agent runtime (SOP + Skills + memory + tools, usually
 *    behind a bridge — e.g. the platform provider).
 *    Used as the **subject under test** (被测员工).
 *  - "llm":   a raw LLM API endpoint (OpenAI-compatible, Anthropic, ...).
 *    No tools, no agent loop — just text in, text out. Used as the **judge**
 *    or as an internal AI helper (出题, 反思建议) — NOT as a subject.
 *
 * The distinction lets the UI keep the two pools cleanly separated in pickers,
 * and prevents accidents like "用被测员工自己当裁判".
 */
export type ProviderKind = "agent" | "llm";

export interface AgentProvider {
  /** Stable identifier referenced by profiles. e.g. "platform". */
  id: string;
  /** Human label shown in the picker. */
  label: string;
  /** One-line description shown in the picker. */
  description: string;
  /** Agent vs raw LLM — see ProviderKind. */
  kind: ProviderKind;
  /**
   * Sort weight for the picker. Lower numbers float to the top.
   * Convention: production providers ≤ 50, mock/dev ≥ 90.
   */
  priority?: number;
  /** Built-in flag — built-ins cannot be uninstalled via UI. */
  builtin?: boolean;
  /** Fields the user fills in to configure a profile of this provider. */
  configSchema: FieldSpec[];
  /** Instantiate a client from a profile's config record. */
  createClient(config: Record<string, unknown>): AgentClient;
}

/* -------------------------------------------------------------------------- */
/* Profile — a saved configuration of a provider.                             */
/* -------------------------------------------------------------------------- */

export interface AgentProfile {
  id: string;
  name: string; // user-facing label
  providerId: string;
  config: Record<string, unknown>;
  createdAt: string;
  /**
   * 连接测试(ping)通过后置 true;编辑配置后重置为 false 等待重新验证。
   * 只有 verified 的 agent 才计入「已配置员工」并在标准员工卡显示 —— 避免
   * 「填了名字但连不上」也显示。持久化随整个 profile 存(localStorage / 后端 blob)。
   */
  verified?: boolean;
}
