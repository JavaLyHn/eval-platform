import type { AgentClient, AgentProvider, SendMessageParams } from "../types";
import type { AgentSkillsResult } from "@/types";
import { hasBundledSkills, loadBundledSkills } from "@/lib/bundled-skills";
import { consumePlatformSSE } from "./platform";

/**
 * Gateway provider — 走本平台后端的 gateway 桥(POST /v1/gateway/chat,SSE)。
 *
 * 目标是任意 OpenAI 兼容网关后的被测 Agent(如 demo 员工 Dex),它常不发
 * CORS 头 → 浏览器不能直连,所以经后端代理(server→server 无 CORS),
 * API Key / 地址都在后端 .env(GATEWAY_*),前端零密钥。
 *
 * 后端把上游 OpenAI SSE 转成 platform 同款帧(start / delta / done+transcript /
 * error),故这里直接复用 consumePlatformSSE。kind:"agent" → 可作为被测对象,
 * 与 platform 的 Aria/Sam 并列。
 */

const SERVER = import.meta.env.VITE_SERVER_URL ?? "";

export const gatewayProvider: AgentProvider = {
  id: "gateway",
  label: "Gateway 网关",
  description:
    "通过后端代理接入 Gateway / OpenAI 兼容网关的 Agent(如 dex「Dex」)。API Key / 地址在后端 .env,前端零配置。",
  kind: "agent",
  priority: 8,
  builtin: true,
  configSchema: [
    {
      key: "apiKey",
      label: "API Key (sk-)",
      type: "secret",
      placeholder: "sk-gateway-...",
      help: "网关 Bearer Key。填了就用它(优先于后端 .env);掩码显示、仅存本人配置,不进他人视野。留空则用部署机 .env 的 GATEWAY_API_KEY。",
    },
    {
      key: "model",
      label: "模型",
      type: "string",
      placeholder: "dex",
      help: "留空则用后端 .env 的 GATEWAY_MODEL(默认 dex)。",
    },
    {
      key: "modelLabel",
      label: "显示名",
      type: "string",
      default: "dex",
      help: "聊天 / 报告里显示的模型标签。",
    },
  ],
  createClient(config) {
    const model = config.model ? String(config.model) : "";
    const modelLabel = config.modelLabel
      ? String(config.modelLabel)
      : model || "dex";
    const apiKey = config.apiKey ? String(config.apiKey) : "";
    return createGatewayClient(model, modelLabel, apiKey);
  },
};

function createGatewayClient(
  model: string,
  modelLabel: string,
  apiKey: string,
): AgentClient {
  const chatUrl = `${SERVER.replace(/\/$/, "")}/v1/gateway/chat`;
  const pingUrl = `${SERVER.replace(/\/$/, "")}/v1/gateway/ping`;
  return {
    modelVersion: modelLabel,
    resetSession() {
      /* 会话由 caller(store)通过 sessionId 管理:新会话/新 trial 传 null → 后端生成新 SID */
    },
    async listSkills(): Promise<AgentSkillsResult> {
      const key = model || "dex";
      if (!hasBundledSkills(key)) return { skills: [] };
      return { agent: key, skills: await loadBundledSkills(key) };
    },
    async ping(signal) {
      const start = Date.now();
      try {
        // POST(非 GET):把 apiKey 放请求体、不进 URL / 访问日志。key 留空则后端回退 .env。
        const res = await fetch(pingUrl, {
          method: "POST",
          signal,
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model || undefined,
            apiKey: apiKey || undefined,
          }),
        });
        const latencyMs = Date.now() - start;
        if (!res.ok) return { ok: false, latencyMs, detail: `bridge HTTP ${res.status}` };
        const body = (await res.json().catch(() => null)) as
          | { ok?: boolean; detail?: string; model?: string }
          | null;
        return { ok: Boolean(body?.ok), latencyMs, detail: body?.detail };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },
    sendMessage({
      prompt,
      images,
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

      fetch(chatUrl, {
        method: "POST",
        signal,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          images: images && images.length ? images : undefined,
          // 多轮:回传同一 sessionId(首轮为 null → 后端生成并经 start 帧回传);
          // 网关按此 id 服务端记忆,故不再重发 history。
          session: sessionId ?? null,
          model: model || undefined,
          // 前端 profile 填的 key(优先于后端 .env);留空则后端回退。
          apiKey: apiKey || undefined,
        }),
      })
        .then(async (res) => {
          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => res.statusText);
            throw new Error(`gateway ${res.status}: ${text.slice(0, 200)}`);
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
            modelVersion: modelLabel,
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
