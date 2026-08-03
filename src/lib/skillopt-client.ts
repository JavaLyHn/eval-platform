const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "";

export interface SkillOptRunRequest {
  mock?: boolean;
  llm?: { baseUrl: string; apiKey: string; model: string };
  caseDir?: string;
  seedSkill?: string;
  seedSkillContent?: string;
  epochs?: number;
  passK?: number;
  caseSplits?: {
    train: unknown[];
    val: unknown[];
    test: unknown[];
  };
  targetModel?: string;
  optimizerModel?: string;
  gateMetric?: "hard" | "soft" | "mixed";
  editBudget?: number;
  lrScheduler?: "constant" | "linear" | "cosine";
  skillUpdateMode?: "patch" | "rewrite_from_suggestions";
  useSlowUpdate?: boolean;
  useMetaSkill?: boolean;
  reasoningEffort?: "" | "low" | "medium" | "high";
  batchSize?: number;
  analystWorkers?: number;
  useGate?: boolean;
}

export interface SkillOptSummary {
  mock: boolean;
  model: string;
  caseSet: string;
  epochs: number;
  trainSize: number;
  testSize: number | null;
  baselineSelectionHard: number;
  bestSelectionHard: number;
  bestStep: number;
  bestOrigin: string;
  totalSteps: number;
  totalAccepts: number;
  totalRejects: number;
  totalSkips: number;
  baselineTestHard: number | null;
  baselineTestSoft: number | null;
  testHard: number | null;
  testSoft: number | null;
  baselineTestPassk: number | null;
  testPassk: number | null;
  testK: number | null;
  wallTimeS: number;
  tokens: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

export interface SkillOptStep {
  step: number;
  epoch: number;
  rolloutHard: number;
  rolloutSoft: number;
  rolloutN: number;
  action: string;
  currentScore: number;
  bestScore: number;
  bestStep: number;
  skillLen: number;
  wallTimeS: number;
}

export interface SkillOptCase {
  id: string;
  prompt: string;
  caseType: string;
  taskType: string;
  baselineHard: number;
  baselineSoft: number;
  bestHard: number;
  bestSoft: number;
  baselineFailReason: string;
  bestFailReason: string;
  bestAnswer: string;
  passCount: number | null;
  k: number | null;
}

export interface SkillOptCaseSpec {
  id: string;
  prompt: string;
  caseType: string;
  taskType: string;
  language: string;
  expected: Record<string, unknown>;
  checks: string[];
}

export interface SkillOptCaseGroup {
  split: string;
  label: string;
  role: string;
  count: number;
  cases: SkillOptCaseSpec[];
}

export interface SkillOptCaseSets {
  caseSet: string;
  groups: SkillOptCaseGroup[];
}

export interface SkillOptDoneFrame {
  type: "done";
  exitCode: number;
  bestSkill: string;
  seedSkill: string;
  summary: SkillOptSummary;
  history: SkillOptStep[];
  cases: SkillOptCase[] | null;
}

export type SkillOptFrame =
  | { type: "start"; outDir: string; mock: boolean }
  | { type: "log"; line: string }
  | SkillOptDoneFrame
  | { type: "error"; message: string; exitCode?: number; bestSkill?: string };

/** POST /v1/skillopt/run,流式消费 SSE,每帧回调 onFrame。可用 signal 中止。 */
export async function runSkillOpt(
  body: SkillOptRunRequest,
  opts: { onFrame: (f: SkillOptFrame) => void; signal?: AbortSignal },
): Promise<void> {
  const url = `${SERVER.replace(/\/$/, "")}/v1/skillopt/run`;
  const res = await fetch(url, {
    method: "POST",
    signal: opts.signal,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`skillopt ${res.status}: ${text.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          opts.onFrame(JSON.parse(payload) as SkillOptFrame);
        } catch {
          /* skip malformed */
        }
      }
    }
  }
}

/** GET /v1/skillopt/cases —— 读三组题集(只读浏览)。 */
export async function fetchSkillOptCases(signal?: AbortSignal): Promise<SkillOptCaseSets> {
  const url = `${SERVER.replace(/\/$/, "")}/v1/skillopt/cases`;
  const res = await fetch(url, { signal, credentials: "include" });
  if (!res.ok) throw new Error(`skillopt cases ${res.status}`);
  return (await res.json()) as SkillOptCaseSets;
}
