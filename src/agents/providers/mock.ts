import { SAMPLE_AGENT_RESPONSES } from "@/lib/mock-data";
import { estimateTokens } from "@/lib/token-estimate";
import type { AgentClient, AgentProvider } from "../types";

const CHUNK_SIZE = 6;
const CHUNK_DELAY_MS = 22;
const INITIAL_DELAY_MS = 360;

/**
 * Mock provider — streams pre-canned responses from `SAMPLE_AGENT_RESPONSES`.
 * No network calls. Useful for offline development and unit-style demos.
 */
export const mockProvider: AgentProvider = {
  id: "mock",
  label: "Mock（仅开发演示用）",
  description:
    "⚠️ 不连接真实 Agent。仅在浏览器里回放预置答案，用于本地开发或没有后端时演示界面。生产用请选其它 provider。",
  kind: "agent",
  priority: 99,
  builtin: true,
  configSchema: [
    {
      key: "label",
      label: "显示名",
      type: "string",
      default: "mock-agent (offline)",
      help: "在消息元数据中显示。",
    },
  ],
  createClient(config) {
    const label = (config.label as string) || "mock-agent (offline)";
    return createMockClient(label);
  },
};

export function createMockClient(label: string): AgentClient {
  return {
    modelVersion: label,
    resetSession() {
      /* mock has no upstream session */
    },
    ping: async () => ({ ok: true, latencyMs: 0, detail: "mock 本地，无需联网" }),
    sendMessage({ prompt, questionId, turnIndex, onChunk, onComplete, signal }) {
      const turnKey =
        questionId && turnIndex != null ? `${questionId}:${turnIndex}` : null;
      const fullText =
        (turnKey && SAMPLE_AGENT_RESPONSES[turnKey]) ??
        (questionId && SAMPLE_AGENT_RESPONSES[questionId]) ??
        SAMPLE_AGENT_RESPONSES.default ??
        `(mock) 收到 prompt：${prompt.slice(0, 80)}...`;

      const startTime = Date.now();
      let cursor = 0;
      let timer: number | null = null;

      signal?.addEventListener("abort", () => {
        if (timer != null) clearTimeout(timer);
      });

      const tick = () => {
        if (signal?.aborted) return;
        const next = Math.min(fullText.length, cursor + CHUNK_SIZE);
        onChunk(fullText.slice(cursor, next));
        cursor = next;
        if (cursor < fullText.length) {
          timer = window.setTimeout(tick, CHUNK_DELAY_MS);
        } else {
          onComplete({
            durationMs: Date.now() - startTime,
            tokens: estimateTokens(prompt) + Math.round(fullText.length / 3.5),
            tokensIn: estimateTokens(prompt),
            tokensOut: Math.round(fullText.length / 3.5),
            modelVersion: label,
          });
        }
      };
      timer = window.setTimeout(tick, INITIAL_DELAY_MS);
    },
  };
}
