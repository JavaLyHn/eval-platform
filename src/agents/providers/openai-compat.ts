import type { AgentClient, AgentProvider, PingResult } from "../types";

/**
 * Generic OpenAI-compatible streaming provider.
 *
 * Works with: OpenAI, Azure OpenAI, any vLLM/Ollama/OpenAI-compatible proxy,
 * and various self-hosted gateways. Sends full chat history per request
 * (provider is stateless on the server side).
 */
export const openaiCompatProvider: AgentProvider = {
  // id 保持 "openai-compat" 不变 —— 已保存的 profile 都按这个 id 引用,改 id 会让它们全部失联。
  id: "openai-compat",
  label: "OpenAI",
  description:
    "OpenAI 及任何遵循 chat/completions 协议的端点(DeepSeek / Qwen / Moonshot / Together / Groq / Ollama 等)。",
  kind: "llm",
  priority: 20,
  builtin: true,
  configSchema: [
    {
      key: "baseUrl",
      label: "Base URL",
      type: "url",
      required: true,
      placeholder: "https://api.openai.com",
      help: "不包含 /v1/chat/completions；预设按钮可一键填好。",
    },
    {
      key: "apiKey",
      label: "API Key",
      type: "secret",
      required: true,
    },
    {
      key: "model",
      label: "Model",
      type: "string",
      required: true,
      placeholder: "gpt-4o-mini",
    },
  ],
  createClient(config) {
    return createOpenAICompatClient({
      baseUrl: String(config.baseUrl ?? ""),
      apiKey: String(config.apiKey ?? ""),
      model: String(config.model ?? "gpt-4o-mini"),
      endpoint: config.endpoint
        ? String(config.endpoint)
        : "/v1/chat/completions",
      systemPrompt: config.systemPrompt
        ? String(config.systemPrompt)
        : undefined,
    });
  },
};

export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  endpoint: string;
  systemPrompt?: string;
}

/**
 * 共享的 OpenAI 兼容客户端工厂。导出以便 newapi 等同协议网关复用,
 * 不必各自重抄一遍 SSE 解析 / ping / token 统计。
 */
export function createOpenAICompatClient(config: OpenAICompatConfig): AgentClient {
  const url = `${config.baseUrl.replace(/\/$/, "")}${config.endpoint}`;

  return {
    modelVersion: config.model,
    resetSession() {
      /* stateless on the server */
    },
    async ping(signal): Promise<PingResult> {
      const start = Date.now();
      try {
        const modelsUrl = `${config.baseUrl.replace(/\/$/, "")}/v1/models`;
        const res = await fetch(modelsUrl, {
          signal,
          headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        const latencyMs = Date.now() - start;
        if (!res.ok) return { ok: false, latencyMs, detail: `HTTP ${res.status}` };
        // 网关可达 ≠ 配置的模型有渠道(model_not_found 503 只在真正对话时才爆,
        // 之前这里是"假绿灯")。校验 model 是否在网关可用模型列表里;
        // 列表拿不到 / 为空时降级为仅可达性,避免对非标网关误报。
        try {
          const body = (await res.json()) as { data?: Array<{ id?: string }> };
          const ids = (body.data ?? [])
            .map((m) => m?.id)
            .filter((x): x is string => typeof x === "string" && x.length > 0);
          if (ids.length > 0 && !ids.includes(config.model)) {
            const peek = ids.slice(0, 8).join(", ");
            return {
              ok: false,
              latencyMs,
              detail: `网关可达,但模型「${config.model}」不在可用列表(可用: ${peek}${ids.length > 8 ? " …" : ""})`,
            };
          }
        } catch {
          /* 列表解析失败 → 只验可达性 */
        }
        return { ok: true, latencyMs, detail: "ok" };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },
    sendMessage({ prompt, images, history, signal, onChunk, onComplete, onError }) {
      const startTime = Date.now();
      // 有图 → 本轮 user content 用 OpenAI 多模态数组(text + image_url);否则纯字符串。
      const messages: Array<{ role: string; content: unknown }> = [];
      if (config.systemPrompt) {
        messages.push({ role: "system", content: config.systemPrompt });
      }
      for (const m of history) {
        if (m.role !== "system") messages.push({ role: m.role, content: m.content });
      }
      const userContent =
        images && images.length
          ? [
              // 只发图(prompt 为空)时不放空 text 块 —— 部分网关会拒空字符串。
              ...(prompt ? [{ type: "text", text: prompt }] : []),
              ...images.map((url) => ({ type: "image_url", image_url: { url } })),
            ]
          : prompt;
      messages.push({ role: "user", content: userContent });

      const body: Record<string, unknown> = {
        model: config.model,
        messages,
        stream: true,
      };

      fetch(url, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => res.statusText);
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let totalTokens: number | undefined;
          let promptTokens: number | undefined;
          let completionTokens: number | undefined;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let frameEnd: number;
            while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
              const frame = buffer.slice(0, frameEnd);
              buffer = buffer.slice(frameEnd + 2);

              for (const line of frame.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                try {
                  const json = JSON.parse(payload);
                  const delta = json?.choices?.[0]?.delta?.content;
                  if (typeof delta === "string") onChunk(delta);
                  if (json?.usage) {
                    if (json.usage.total_tokens != null)
                      totalTokens = json.usage.total_tokens;
                    if (json.usage.prompt_tokens != null)
                      promptTokens = json.usage.prompt_tokens;
                    if (json.usage.completion_tokens != null)
                      completionTokens = json.usage.completion_tokens;
                  }
                } catch {
                  /* skip */
                }
              }
            }
          }

          onComplete({
            durationMs: Date.now() - startTime,
            tokens:
              totalTokens ??
              (promptTokens != null && completionTokens != null
                ? promptTokens + completionTokens
                : undefined),
            tokensIn: promptTokens,
            tokensOut: completionTokens,
            modelVersion: config.model,
          });
        })
        .catch((err) => {
          if ((err as Error).name === "AbortError") return;
          onError(err as Error);
        });
    },
  };
}
