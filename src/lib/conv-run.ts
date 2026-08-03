/** 会话级流式运行态(纯内存,不持久化)。多会话并行:每条正在生成的会话一条。 */
export type AgentActivity = "idle" | "thinking" | "streaming";

export interface ConvRun {
  /** 该会话当前活动态。 */
  activity: AgentActivity;
  /** 活动开始时刻(占位计时)。 */
  startedAt: number | null;
  /** 阶段提示(provider onStage)。 */
  stage: string | null;
}

/** 该会话是否正在流式(有 run 条目且非 idle)。 */
export function isConvStreaming(
  runs: ReadonlyMap<string, ConvRun>,
  convId: string | null | undefined,
): boolean {
  if (!convId) return false;
  const r = runs.get(convId);
  return r != null && r.activity !== "idle";
}

/** 是否有任一会话在跑(同步 / prune / refetch 门用)。 */
export function anyStreaming(runs: ReadonlyMap<string, ConvRun>): boolean {
  for (const r of runs.values()) if (r.activity !== "idle") return true;
  return false;
}

/** 该会话是否忙碌:正在流式,或有未发完的多轮续发。发送守卫用。 */
export function isConvBusy(
  runs: ReadonlyMap<string, ConvRun>,
  pendingTurnsByConv: ReadonlyMap<string, unknown>,
  convId: string | null | undefined,
): boolean {
  if (!convId) return false;
  return isConvStreaming(runs, convId) || pendingTurnsByConv.has(convId);
}
