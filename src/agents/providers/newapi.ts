import type { AgentProvider } from "../types";
import { createOpenAICompatClient } from "./openai-compat";

/**
 * NewAPI 网关 provider —— new-api / one-api 这类 OpenAI 兼容中转网关。
 *
 * 协议与 OpenAI 完全一致(/v1/chat/completions 转发 + /v1/models 列表),
 * 所以直接复用 openai-compat 的客户端实现,只换品牌 / 默认值 / 文案。
 * 与「OpenAI」provider 的区别纯属 UX:让自部署网关的用户一眼认出该填哪个,
 * baseUrl 默认给网关占位符而非 api.openai.com。
 */
export const newapiProvider: AgentProvider = {
  id: "newapi",
  label: "NewAPI",
  description:
    "NewAPI / One-API 等 OpenAI 兼容中转网关。填自部署网关地址 + 令牌 + 转发的模型名。",
  kind: "llm",
  priority: 21,
  builtin: true,
  configSchema: [
    {
      key: "baseUrl",
      label: "Base URL",
      type: "url",
      required: true,
      default: "https://api.example.com",
      help: "固定为 NewAPI 网关,默认已填好;会自动拼 /v1/chat/completions。",
    },
    {
      key: "apiKey",
      label: "API Key",
      type: "secret",
      required: true,
      help: "在 NewAPI 里创建的令牌(sk-...)。",
    },
    {
      key: "model",
      label: "Model",
      type: "string",
      required: true,
      placeholder: "gpt-4o-mini",
      help: "网关里配置 / 转发的模型名。",
    },
  ],
  createClient(config) {
    return createOpenAICompatClient({
      baseUrl: String(config.baseUrl ?? ""),
      apiKey: String(config.apiKey ?? ""),
      model: String(config.model ?? ""),
      endpoint: config.endpoint
        ? String(config.endpoint)
        : "/v1/chat/completions",
      systemPrompt: config.systemPrompt
        ? String(config.systemPrompt)
        : undefined,
    });
  },
};
