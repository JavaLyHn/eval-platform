/**
 * 评测趋势按日分桶 + 汇总(纯函数,便于单测)。
 *
 * 口径:**按题**,与数据看板 KPI / 状态环完全一致 —— 每个已判定的题按其**题级** verdict
 * (q.status = pass^k / 逐轮汇总后的整题结论)计一次,不再按逐轮逐 trial 的原始评测条数。
 * 一道困难题的多轮、同题的多 trial 都归到该题一次。整体通过率 = 通过题 / 已判定题。
 */

/** 趋势输入项:一道已判定的题(date=该题最近一次评测时刻 ISO,status=题级结论)。 */
export interface TrendItem {
  date: string; // ISO 时间戳(取 .slice(0,10) 作日期桶)
  status: "passed" | "failed";
}

export interface DayBucket {
  date: string; // YYYY-MM-DD
  label: string; // M/D
  passed: number; // 当日通过的题数
  failed: number; // 当日失败的题数
}

export function bucketByDay(
  items: TrendItem[],
  days: number,
  now: Date = new Date(),
): DayBucket[] {
  const result: DayBucket[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    indexByDate.set(key, result.length);
    result.push({
      date: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      passed: 0,
      failed: 0,
    });
  }
  for (const it of items) {
    const idx = indexByDate.get(it.date.slice(0, 10));
    if (idx == null) continue;
    if (it.status === "passed") result[idx].passed += 1;
    else result[idx].failed += 1;
  }
  return result;
}

export interface TrendSummary {
  /** 整体通过率(通过题 / 已判定题)%;无数据则 0。 */
  passRate: number;
  /** 窗口内是否有任一已判定题。 */
  hasData: boolean;
}

export function summarizeTrend(buckets: DayBucket[]): TrendSummary {
  let passed = 0;
  let judged = 0;
  for (const b of buckets) {
    passed += b.passed;
    judged += b.passed + b.failed;
  }
  return {
    passRate: judged > 0 ? (passed / judged) * 100 : 0,
    hasData: judged > 0,
  };
}
