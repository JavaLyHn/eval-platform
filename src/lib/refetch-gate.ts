/**
 * 何时可以从服务器重新拉取(跨设备同步的下行触发闸门)。
 *
 * 抽成纯函数是为了能单测 —— vitest 是 node 环境、不渲染组件,所有判定逻辑都得离开 hook。
 * 触发点见 use-qa-store 的 refetchFromServer(visibilitychange / focus / 侧栏手动按钮)。
 */

/** 两次自动拉取的最小间隔:一次拉取是 9 个表 + 每会话一个 messages 请求,不能连发。 */
export const REFETCH_MIN_INTERVAL_MS = 20_000;

/**
 * I-1:「挂死判定」阈值,不是节流——`REFETCH_MIN_INTERVAL_MS` 管的是「多快能再拉一次」,
 * 这个管的是「in-flight 标志还要不要相信」。api.ts 里的 fetch 没有超时/AbortSignal,手机
 * 后台挂久了恢复前台时旧连接可能长时间不 settle,若只用一个布尔量记「是否在飞」,一旦
 * 真的挂死就会永久卡 true、后续所有 refetch 尝试(含手动点「同步」)都会在入口被挡死,
 * 只能刷新页面自愈。超过这个阈值就不再当作「还在飞」,放行新的一次。
 */
export const REFETCH_STALE_MS = 30_000;

export interface RefetchGateInput {
  /** 首次 hydration 是否已落地 —— 没落地就重拉等于自己跟自己打架。 */
  hydrated: boolean;
  /** 页面是否可见:后台标签页不烧流量(手机尤其)。 */
  visible: boolean;
  /** 流式输出中不拉:上行同步本来就暂停,下行 setState 也会和流冲突。 */
  streaming: boolean;
  /**
   * outbox 里待发送的条数(**不含死信**)。>0 就不拉 —— 本机的删除还没排空时重拉,
   * 会把服务器上那条又拉回来。死信不计入,否则一条永久失败的写会把下行永久锁死
   * (代价:处于死信状态的删除会被拉回来,横幅本来就在催用户处理死信)。
   */
  pendingWrites: number;
  lastRefetchAt: number | null;
  now: number;
  /** 覆盖节流间隔(测试用)。 */
  minIntervalMs?: number;
  /** 手动点「同步」:只跳过节流,其余四个条件仍必须满足。 */
  force?: boolean;
}

export function shouldRefetch(input: RefetchGateInput): boolean {
  if (!input.hydrated || !input.visible || input.streaming) return false;
  if (input.pendingWrites > 0) return false;
  if (input.force) return true;
  const min = input.minIntervalMs ?? REFETCH_MIN_INTERVAL_MS;
  return input.lastRefetchAt === null || input.now - input.lastRefetchAt >= min;
}

/**
 * m-4:判定「某次起飞时刻(startedAt)」是否已经挂死太久、不该再挡后续尝试。
 *
 * 这个判定原本长在 use-qa-store.tsx 里(不可单测的 .tsx,vitest 只收 `src/**\/*.test.ts`),
 * 而阈值常量 REFETCH_STALE_MS 却定义在这个可测的文件里——两边分家,与本文件头「抽成纯函数
 * 是为了能单测」的口径自相矛盾。这里把判定逻辑也搬过来,use-qa-store.tsx 只管调用。
 *
 * - `startedAt === null`:压根没有在飞的请求,谈不上挂死 → false。
 * - `now - startedAt >= staleMs`:飞太久没 settle,当作挂死 → true(放行新的一次)。
 * - `now < startedAt`(墙钟被回拨,差值为负):我们没法知道这一发到底已经飞了多久——
 *   如果按「负数天然小于阈值」处理会永远判定「仍在飞」,把自动重拉和手动「同步」逃生口一起
 *   锁死,只能刷新页面自愈。这里选择让路更安全:回拨一律视为挂死、放行新的一次。
 *   (呼应下面 formatSyncedAgo 用 `Math.max(0, …)` 兜回拨的做法——那边是「文案不出负数」,
 *   这里是「判定不能因回拨而永远锁死」,取舍角度不同但都是「回拨时选更安全的一边」。)
 */
export function isRefetchStale(
  startedAt: number | null,
  now: number,
  staleMs: number = REFETCH_STALE_MS,
): boolean {
  if (startedAt === null) return false;
  const elapsed = now - startedAt;
  if (elapsed < 0) return true;
  return elapsed >= staleMs;
}

/** 侧栏「同步 · N 分钟前」的文案。时钟回拨导致的未来时间戳按「刚刚」处理。 */
export function formatSyncedAgo(lastSyncedAt: number | null, now: number): string {
  if (lastSyncedAt === null) return "未同步";
  const ms = Math.max(0, now - lastSyncedAt);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
