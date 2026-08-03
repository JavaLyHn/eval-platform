import type {
  AgentClient,
  AgentProvider,
  ChatHistoryItem,
  PingResult,
} from "../types";

/**
 * Anthropic (Claude) direct API provider.
 *
 * Talks to `/v1/messages` over SSE. NOT OpenAI-compatible — uses `x-api-key`,
 * `anthropic-version`, and the dangerous browser-access header to allow CORS
 * from the SPA.
 *
 * Browser-direct API keys leak to anyone with the localStorage — only use this
 * for personal / internal QA, never production-end-user surfaces.
 */
export const anthropicProvider: AgentProvider = {
  id: "anthropic",
  label: "Anthropic",
  description:
    "直连 Anthropic /v1/messages 接口。支持 Claude 4.7 Opus / Claude 4.6 Sonnet / Claude 4.5 Haiku 等。",
  kind: "llm",
  priority: 22,
  builtin: true,
  configSchema: [
    {
      key: "baseUrl",
      label: "Base URL",
      type: "url",
      default: "https://api.anthropic.com",
      help: "默认 api.anthropic.com，可改写为自建代理。",
    },
    {
      key: "apiKey",
      label: "API Key",
      type: "secret",
      required: true,
      placeholder: "sk-ant-…",
    },
    {
      key: "model",
      label: "Model",
      type: "string",
      required: true,
      placeholder: "claude-opus-4-7",
      help: "如 claude-opus-4-7 / claude-sonnet-4-6 / claude-haiku-4-5-20251001",
    },
  ],
  createClient(config) {
    return createAnthropicClient({
      apiKey: String(config.apiKey ?? ""),
      model: String(config.model ?? "claude-opus-4-7"),
      baseUrl: String(config.baseUrl ?? "https://api.anthropic.com"),
      maxTokens: Number(config.maxTokens ?? 4096),
      systemPrompt: config.systemPrompt
        ? String(config.systemPrompt)
        : undefined,
      anthropicVersion: String(config.anthropicVersion ?? "2023-06-01"),
    });
  },
};

interface AnthropicConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokens: number;
  systemPrompt?: string;
  anthropicVersion: string;
}

function createAnthropicClient(config: AnthropicConfig): AgentClient {
  const url = `${config.baseUrl.replace(/\/$/, "")}/v1/messages`;
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": config.apiKey,
    "anthropic-version": config.anthropicVersion,
    "anthropic-dangerous-direct-browser-access": "true",
  };

  return {
    modelVersion: config.model,
    resetSession() {
      /* stateless on the server */
    },
    async ping(signal): Promise<PingResult> {
      const start = Date.now();
      try {
        // Cheapest probe Anthropic supports: a 1-token messages call. /v1/models
        // is gated and unreliable across accounts.
        const res = await fetch(url, {
          method: "POST",
          signal,
          headers,
          body: JSON.stringify({
            model: config.model,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          }),
        });
        return {
          ok: res.ok,
          latencyMs: Date.now() - start,
          detail: res.ok ? "ok" : `HTTP ${res.status}`,
        };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },
    sendMessage({ prompt, history, signal, onChunk, onComplete, onError }) {
      const startTime = Date.now();

      // Anthropic requires `system` to be a top-level field (not a message).
      // Strip system messages out of history and merge into `system`.
      const systemPieces: string[] = [];
      if (config.systemPrompt) systemPieces.push(config.systemPrompt);
      const messages: ChatHistoryItem[] = [];
      for (const m of history) {
        if (m.role === "system") {
          systemPieces.push(m.content);
        } else {
          messages.push(m);
        }
      }
      messages.push({ role: "user", content: prompt });

      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: config.maxTokens,
        messages,
        stream: true,
      };
      if (systemPieces.length > 0) body.system = systemPieces.join("\n\n");

      fetch(url, {
        method: "POST",
        signal,
        headers,
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
          let inputTokens: number | undefined;
          let outputTokens: number | undefined;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // SSE frames separated by double newline.
            let frameEnd: number;
            while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
              const frame = buffer.slice(0, frameEnd);
              buffer = buffer.slice(frameEnd + 2);

              // Each frame is one or more `field: value` lines.
              for (const line of frame.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                try {
                  const json = JSON.parse(payload);
                  // Text deltas live in content_block_delta events.
                  if (
                    json?.type === "content_block_delta" &&
                    json?.delta?.type === "text_delta" &&
                    typeof json.delta.text === "string"
                  ) {
                    onChunk(json.delta.text);
                  }
                  // Final usage totals come in message_delta / message_stop.
                  // NOTE: input_tokens 不含 cache_read_input_tokens /
                  // cache_creation_input_tokens,开 prompt caching 时仍偏低;读 cache_* 留后。
                  if (json?.usage?.output_tokens != null) {
                    const inT = (json.usage.input_tokens ?? 0) as number;
                    const outT = (json.usage.output_tokens ?? 0) as number;
                    inputTokens = inT;
                    outputTokens = outT;
                    totalTokens = inT + outT;
                  }
                } catch {
                  /* skip */
                }
              }
            }
          }

          onComplete({
            durationMs: Date.now() - startTime,
            tokens: totalTokens,
            tokensIn: inputTokens,
            tokensOut: outputTokens,
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
