import type { TranscriptStep } from "@/types";

/** 「本轮」步:从最后一个 role==="user" 步到结尾。无 user 步 → 原样返回(兜底)。 */
export function lastRoundSteps(steps: TranscriptStep[]): TranscriptStep[] {
  let lastUser = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  return lastUser >= 0 ? steps.slice(lastUser) : steps;
}

/** 轮数 = role==="user" 步的个数。 */
export function roundCount(steps: TranscriptStep[]): number {
  return steps.filter((s) => s.role === "user").length;
}
