/**
 * Versioned localStorage persistence for the QA store.
 *
 * Each slice (questions, evaluations, messages, ui) is keyed independently so
 * a corrupt blob in one doesn't take down the others. Schema migrations should
 * bump the version suffix; older keys can be left in place to roll back.
 */

const PREFIX = "eval-platform:";

export const STORAGE_KEYS = {
  questions: `${PREFIX}questions:v1`,
  evaluations: `${PREFIX}evaluations:v1`,
  /** Legacy single-message-array storage; migrated into conversations on load. */
  messages: `${PREFIX}messages:v1`,
  conversations: `${PREFIX}conversations:v1`,
  ui: `${PREFIX}ui:v1`,
  customCategories: `${PREFIX}categories:v1`,
  hiddenCategories: `${PREFIX}categories-hidden:v1`,
  user: `${PREFIX}user:v1`,
  defaultCriteria: `${PREFIX}default-criteria:v1`,
  lastGeneratorProfileId: `${PREFIX}last-generator:v1`,
  /** Map of standardEmployeeId → agentProfileId (user-editable). */
  employeeProfileMap: `${PREFIX}employee-profiles:v1`,
  /** Generated evaluation reports (read-only snapshots). */
  reports: `${PREFIX}reports:v1`,
  /** Skill 评测报告(跑完手动保存的只读快照)。v1 仅本机,不接后端 sync。 */
  skillReports: `${PREFIX}skillReports:v1`,
  /** 出题维度（行业/职业/场景）的自定义值。 */
  genDimensions: `${PREFIX}gen-dimensions:v1`,
  /** 保下限要素清单（FloorElement[]）。 */
  floorElements: `${PREFIX}floor-elements:v1`,
  /** 每员工角色专属指标 overlay(Record<employeeId, EmployeeMetricsOverlay>)。 */
  employeeMetrics: `${PREFIX}employee-metrics:v1`,
  /** 抽审队列抽样比例(0–1 浮点)。 */
  auditSampleRate: `${PREFIX}audit-sample-rate:v1`,
  /** 上一次批量打分的指针(本批 evaluationIds + questionIds),仅本机持久。 */
  lastBatchJudge: `${PREFIX}last-batch-judge:v1`,
  /** 生成报告的指标目标值(Record<metricKey, string>,记住上次设置)。 */
  reportTargets: `${PREFIX}report-targets:v1`,
  /** 评测运行记录快照。v1 仅本机,不接后端 sync。 */
  evaluationRuns: `${PREFIX}evaluation-runs:v1`,
} as const;

interface StorageEnvelope<T> {
  version: 1;
  savedAt: string;
  data: T;
}

export function loadSlice<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StorageEnvelope<T>;
    if (!parsed || parsed.version !== 1) return fallback;
    return parsed.data;
  } catch {
    return fallback;
  }
}

export function saveSlice<T>(key: string, data: T): void {
  if (typeof localStorage === "undefined") return;
  try {
    const envelope: StorageEnvelope<T> = {
      version: 1,
      savedAt: new Date().toISOString(),
      data,
    };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch (e) {
    // QuotaExceededError or similar — silent fail; don't break the UI
    console.warn("[persistence] save failed:", e);
  }
}

export function clearAllPlatformData(): void {
  if (typeof localStorage === "undefined") return;
  // Use the Storage length/key() API instead of Object.keys() so this works
  // correctly with both real browser localStorage and test stubs.
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
}
