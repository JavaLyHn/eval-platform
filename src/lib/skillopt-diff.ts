/** 取 best_skill 里 <!-- SLOW_UPDATE_START/END --> 之间注入的经验;无锚点 / 空 / 字段缺失 → ""。 */
export function extractLearnedGuidance(skill: string | null | undefined): string {
  if (!skill) return "";
  const m = skill.match(/<!--\s*SLOW_UPDATE_START\s*-->([\s\S]*?)<!--\s*SLOW_UPDATE_END\s*-->/);
  return m ? m[1].trim() : "";
}

export type DiffLine = { type: "same" | "add" | "del"; text: string };

/** 朴素 LCS 行级 diff:种子 → 最优。入参缺失时按空串处理(防残缺帧崩溃)。 */
export function diffSkill(seed: string | null | undefined, best: string | null | undefined): DiffLine[] {
  const a = (seed ?? "").split("\n");
  const b = (best ?? "").split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: a[i] });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j] });
    j++;
  }
  return out;
}
