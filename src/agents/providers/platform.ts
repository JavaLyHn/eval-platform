import type { AgentClient, AgentProvider, SendMessageParams } from "../types";

/**
 * Platform provider — 走本平台后端的 platform 桥(POST /v1/platform/chat,SSE)。
 * API Key / platform 地址都在后端 .env,前端只填 instanceId。
 * SSE 词汇:start / stage / delta / done / error,
 * done 帧额外带 transcript / interrupted。
 */

const SERVER = import.meta.env.VITE_SERVER_URL ?? "";

/**
 * platform 实例的真实模型(chatModel)缓存,key = instanceId。连接 ping 时填充,
 * 聊天 onComplete 用它当 modelVersion —— 这样定价表能匹配、$ 才算得出来,
 * 页脚也能显示"该员工实际跑的模型"而不是"platform"标签。
 */
const platformModelCache = new Map<string, string>();

interface SSEHandlers {
  onStart: (compositeSessionId: string) => void;
  onStage: (stage: string) => void;
  onDelta: (delta: string) => void;
  onDone: (info: {
    durationMs?: number;
    interrupted?: boolean;
    transcript?: import("@/types").AgentTranscript;
  }) => void;
  onError: (message: string) => void;
}

/** 读取后端 SSE 流并分发到回调。导出以便单测。 */
export async function consumePlatformSSE(
  body: ReadableStream<Uint8Array>,
  h: SSEHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // sse-starlette 用 CRLF(\r\n)分隔帧,部分上游用 LF。统一成 LF 再按
    // \n\n 切帧——否则 indexOf("\n\n") 在 CRLF 流里永远找不到帧边界,一帧都解析不出。
    buffer = buffer.replace(/\r\n/g, "\n");

    let frameEnd: number;
    while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);

      for (const line of frame.split("\n")) {
        if (line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          if (json.error) {
            h.onError(String(json.error));
            continue;
          }
          if (json.event === "start" && typeof json.sessionId === "string") {
            h.onStart(json.sessionId);
          } else if (json.event === "stage" && typeof json.stage === "string") {
            h.onStage(json.stage);
          } else if (typeof json.delta === "string") {
            h.onDelta(json.delta);
          } else if (json.done) {
            h.onDone({
              durationMs: typeof json.durationMs === "number" ? json.durationMs : undefined,
              interrupted: Boolean(json.interrupted),
              transcript: json.transcript,
            });
          }
        } catch {
          /* skip malformed */
        }
      }
    }
  }
}

export const platformProvider: AgentProvider = {
  id: "platform",
  label: "Platform 开放平台",
  description: "通过本平台后端代理接入 Platform 开放平台的 Agent 实例(API Key 在后端 .env)。",
  kind: "agent",
  priority: 5,
  builtin: true,
  configSchema: [
    {
      key: "instanceId",
      label: "被测实例 ID",
      type: "string",
      required: true,
    },
    {
      key: "modelLabel",
      label: "显示名",
      type: "string",
      default: "platform",
      help: "聊天 / 报告里显示的模型标签;拿不到 platform 真实模型名时用它兜底。",
    },
  ],
  createClient(config) {
    const instanceId = String(config.instanceId ?? "");
    const modelLabel = config.modelLabel ? String(config.modelLabel) : "platform";
    return createPlatformClient(instanceId, modelLabel);
  },
};

function createPlatformClient(instanceId: string, modelLabel: string): AgentClient {
  const url = `${SERVER.replace(/\/$/, "")}/v1/platform/chat`;
  const pingUrl = `${SERVER.replace(/\/$/, "")}/v1/platform/ping?instanceId=${encodeURIComponent(instanceId)}`;
  return {
    modelVersion: modelLabel,
    resetSession() {
      /* 会话由 caller 通过 sessionId 管理 */
    },
    async ping(signal) {
      const start = Date.now();
      try {
        const res = await fetch(pingUrl, {
          signal,
          credentials: "include",
        });
        const latencyMs = Date.now() - start;
        if (!res.ok) {
          return { ok: false, latencyMs, detail: `bridge HTTP ${res.status}` };
        }
        const body = (await res.json().catch(() => null)) as
          | { ok?: boolean; detail?: string; model?: string }
          | null;
        // 缓存真实模型,供后续聊天当 modelVersion 用。
        if (body?.model) platformModelCache.set(instanceId, body.model);
        return { ok: Boolean(body?.ok), latencyMs, detail: body?.detail };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },
    sendMessage({
      prompt,
      sessionId,
      signal,
      onChunk,
      onComplete,
      onError,
      onStage,
      onSession,
    }: SendMessageParams) {
      const startTime = Date.now();
      let transcript: import("@/types").AgentTranscript | undefined;
      let interrupted = false;
      let durationMs: number | undefined;

      fetch(url, {
        method: "POST",
        signal,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt, session: sessionId ?? null, instanceId }),
      })
        .then(async (res) => {
          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => res.statusText);
            throw new Error(`platform ${res.status}: ${text.slice(0, 200)}`);
          }
          let sawError: string | null = null;
          await consumePlatformSSE(res.body, {
            onStart: (sid) => onSession?.(sid),
            onStage: (stage) => onStage?.(stage),
            onDelta: (delta) => onChunk(delta),
            onError: (msg) => {
              sawError = msg;
            },
            onDone: (info) => {
              transcript = info.transcript;
              interrupted = Boolean(info.interrupted);
              durationMs = info.durationMs;
            },
          });
          if (sawError) {
            onError(new Error(sawError));
            return;
          }
          onComplete({
            durationMs: durationMs ?? Date.now() - startTime,
            // 优先用 ping 缓存到的真实模型(claude-opus-4-x),拿不到才回退到显示名标签。
            modelVersion: platformModelCache.get(instanceId) || modelLabel,
            transcript,
            interrupted,
          });
        })
        .catch((err) => {
          if ((err as Error).name === "AbortError") return;
          onError(err as Error);
        });
    },
  };
}
