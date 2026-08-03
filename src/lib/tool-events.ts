import type { TranscriptStep } from "@/types";

export interface ToolEventSummary {
  name: string;
  /** 该工具被调用次数 */
  calls: number;
  /** 其中失败(isError)次数 */
  errors: number;
  /** 该工具「首次带 I/O 的调用」的脱密截断片段(服务端开关开启时才有);代表性即可,不逐次列。 */
  sample?: { input?: string; output?: string };
}

/**
 * 从轨迹 steps 提取「工具事件」并**按工具名去重**:同名工具多次调用聚合成一条,
 * 累计 calls / errors,保持首次出现顺序。首次带 I/O 的调用填充 sample(input/output 各自存在才记)。
 */
export function summarizeToolEvents(
  steps: TranscriptStep[],
): ToolEventSummary[] {
  const order: string[] = [];
  const map = new Map<string, ToolEventSummary>();
  const ioToStr = (v: unknown): string | undefined =>
    v === undefined ? undefined : typeof v === "string" ? v : JSON.stringify(v);
  for (const s of steps) {
    if (!s.toolName) continue;
    let e = map.get(s.toolName);
    if (!e) {
      e = { name: s.toolName, calls: 0, errors: 0 };
      map.set(s.toolName, e);
      order.push(s.toolName);
    }
    e.calls += 1;
    if (s.isError) e.errors += 1;
    // 首次带 I/O 的调用 → 记一份代表性片段(input/output 各自存在才记)。
    if (!e.sample && (s.toolInput !== undefined || s.output !== undefined)) {
      const input = ioToStr(s.toolInput);
      const output = ioToStr(s.output);
      e.sample = {};
      if (input !== undefined) e.sample.input = input;
      if (output !== undefined) e.sample.output = output;
    }
  }
  return order.map((n) => map.get(n)!);
}
