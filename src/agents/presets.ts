/**
 * Brand presets — one-click templates that pre-fill provider + baseUrl + model
 * so the user only needs to paste an API key. Every preset maps to a built-in
 * provider; only secrets / per-account values are left for the user.
 *
 * Adding a new preset is intentionally low-effort: just append to the list.
 */

export interface ProfilePreset {
  /** Stable id — used as React key + telemetry. */
  id: string;
  /** Display name in the preset picker. */
  label: string;
  /** Tiny emoji / symbol shown on the chip. */
  icon: string;
  /** One-liner shown in tooltip. */
  hint: string;
  /** Default profile name (user can rename before save). */
  defaultName: string;
  /** Provider id to select. */
  providerId: string;
  /** Pre-filled config — required fields like apiKey stay empty for the user. */
  config: Record<string, unknown>;
}

export const PROFILE_PRESETS: ProfilePreset[] = [
  // OpenAI-compatible family
  {
    id: "openai",
    label: "OpenAI",
    icon: "🟢",
    hint: "GPT-4o / GPT-4.1 / o-series",
    defaultName: "OpenAI · GPT",
    providerId: "openai-compat",
    config: {
      baseUrl: "https://api.openai.com",
      endpoint: "/v1/chat/completions",
      model: "gpt-4o",
    },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    icon: "🔷",
    hint: "deepseek-chat / deepseek-reasoner",
    defaultName: "DeepSeek · Chat",
    providerId: "openai-compat",
    config: {
      baseUrl: "https://api.deepseek.com",
      endpoint: "/chat/completions",
      model: "deepseek-chat",
    },
  },
  {
    id: "anthropic",
    label: "Claude",
    icon: "🟠",
    hint: "Claude 4.7 Opus / 4.6 Sonnet / 4.5 Haiku",
    defaultName: "Claude · Sonnet",
    providerId: "anthropic",
    config: {
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-6",
      maxTokens: 4096,
      anthropicVersion: "2023-06-01",
    },
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    icon: "🌙",
    hint: "moonshot-v1-8k / 32k / 128k",
    defaultName: "Kimi · v1",
    providerId: "openai-compat",
    config: {
      baseUrl: "https://api.moonshot.cn",
      endpoint: "/v1/chat/completions",
      model: "moonshot-v1-32k",
    },
  },
  {
    id: "qwen",
    label: "Qwen (通义)",
    icon: "🟣",
    hint: "qwen-max / qwen-plus / qwen3-235b",
    defaultName: "Qwen · Max",
    providerId: "openai-compat",
    config: {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
      endpoint: "/v1/chat/completions",
      model: "qwen-max",
    },
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    icon: "🔵",
    hint: "glm-4.6 / glm-4-air / glm-4-flash",
    defaultName: "智谱 · GLM-4",
    providerId: "openai-compat",
    config: {
      baseUrl: "https://open.bigmodel.cn/api/paas",
      endpoint: "/v4/chat/completions",
      model: "glm-4-plus",
    },
  },
  {
    id: "together",
    label: "Together AI",
    icon: "⚡",
    hint: "Llama / Mixtral / DeepSeek hosted",
    defaultName: "Together · Llama",
    providerId: "openai-compat",
    config: {
      baseUrl: "https://api.together.xyz",
      endpoint: "/v1/chat/completions",
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    },
  },
  {
    id: "groq",
    label: "Groq",
    icon: "🟡",
    hint: "极低延迟推理（Llama / Mixtral）",
    defaultName: "Groq · Llama",
    providerId: "openai-compat",
    config: {
      baseUrl: "https://api.groq.com/openai",
      endpoint: "/v1/chat/completions",
      model: "llama-3.3-70b-versatile",
    },
  },
  {
    id: "ollama",
    label: "Ollama (本地)",
    icon: "🦙",
    hint: "本机 11434 端口的 Ollama",
    defaultName: "Ollama · Local",
    providerId: "openai-compat",
    config: {
      baseUrl: "http://localhost:11434",
      endpoint: "/v1/chat/completions",
      model: "llama3.1",
    },
  },
];
