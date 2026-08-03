import type { Question } from "@/types";

/**
 * 题号方案:按题目种类分序列 —— Agent 题 `A-001…`、Skill 题 `S-001…`,
 * 各自独立递增。题号只是展示 / 检索用标签(id 才是主键),改号无副作用。
 * 旧数据的全局 `Q-NNN` 号由 normalizeQuestionNumbers 一次性迁移。
 */

type NumberedQuestion = Pick<Question, "kind" | "number" | "createdAt"> & {
  transient?: boolean;
};

/** 题号前缀:Agent 题 A / Skill 题 S。 */
export function questionNumberPrefix(kind: Question["kind"]): "A" | "S" {
  return (kind ?? "agent") === "skill" ? "S" : "A";
}

const NUM_RE = /^([AS])-(\d{3,})$/;

/** 下一个题号:同种类题里取现有最大序号 +1(三位补零,超 999 自然变四位)。
 *  临时题不占库序列,故计算 max 时跳过。 */
export function nextQuestionNumber(
  questions: ReadonlyArray<Pick<Question, "kind" | "number"> & { transient?: boolean }>,
  kind: Question["kind"],
): string {
  const prefix = questionNumberPrefix(kind);
  let max = 0;
  for (const q of questions) {
    if (q.transient) continue;
    const m = NUM_RE.exec(q.number ?? "");
    if (m && m[1] === prefix) max = Math.max(max, parseInt(m[2], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/**
 * 题号重排(幂等):每个种类内,**按数组(存储 / 显示)顺序**从 001 密集编号
 * A-001… / S-001…。→ 删中间题后空号自动回填、手动重排后号随顺序、旧 Q- / 缺号 /
 * 前缀错 / 重号一并修正。题号只是展示 / 检索标签(id 才是主键),改号无副作用。
 * 已是密集且与顺序一致 → changed=false,原数组原样返回(避免无谓重渲染 / 持久化)。
 *
 * 临时题(free-chat 未正式入库,transient=true)**不占库序列**:它们不在题库列表显示,
 * 若计入会让题库出现空号(A-001 / A-003 缺 A-002)。这里把临时题的库号清空、不计数。
 */
export function normalizeQuestionNumbers<T extends NumberedQuestion>(
  questions: T[],
): { changed: boolean; questions: T[] } {
  const counters = { A: 0, S: 0 };
  let changed = false;
  const out = questions.map((q) => {
    if (q.transient) {
      // 临时题不参与 A-/S- 库编号;清掉残留库号(老数据可能带号)。
      if (!q.number) return q;
      changed = true;
      return { ...q, number: "" };
    }
    const p = questionNumberPrefix(q.kind);
    counters[p] += 1;
    const num = `${p}-${String(counters[p]).padStart(3, "0")}`;
    if (q.number === num) return q;
    changed = true;
    return { ...q, number: num };
  });
  return { changed, questions: changed ? out : questions };
}
