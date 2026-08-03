import { describe, expect, it } from "vitest";
import {
  REFETCH_MIN_INTERVAL_MS,
  REFETCH_STALE_MS,
  formatSyncedAgo,
  isRefetchStale,
  shouldRefetch,
} from "./refetch-gate";

const ok = {
  hydrated: true,
  visible: true,
  streaming: false,
  pendingWrites: 0,
  lastRefetchAt: null,
  now: 1_000_000,
};

describe("shouldRefetch", () => {
  it("条件齐备且从没拉过 → 拉", () => {
    expect(shouldRefetch(ok)).toBe(true);
  });

  it("首次 hydration 还没落地 → 不拉", () => {
    expect(shouldRefetch({ ...ok, hydrated: false })).toBe(false);
  });

  it("页面不可见 → 不拉(后台标签页不烧流量)", () => {
    expect(shouldRefetch({ ...ok, visible: false })).toBe(false);
  });

  it("流式输出中 → 不拉", () => {
    expect(shouldRefetch({ ...ok, streaming: true })).toBe(false);
  });

  it("本机还有未排空的写 → 不拉(否则未排空的删除会被服务器复活)", () => {
    expect(shouldRefetch({ ...ok, pendingWrites: 1 })).toBe(false);
  });

  it("距上次不足节流间隔 → 不拉", () => {
    expect(
      shouldRefetch({ ...ok, lastRefetchAt: ok.now - (REFETCH_MIN_INTERVAL_MS - 1) }),
    ).toBe(false);
  });

  it("刚好到间隔 → 拉", () => {
    expect(
      shouldRefetch({ ...ok, lastRefetchAt: ok.now - REFETCH_MIN_INTERVAL_MS }),
    ).toBe(true);
  });

  it("force 跳过节流", () => {
    expect(shouldRefetch({ ...ok, lastRefetchAt: ok.now - 1, force: true })).toBe(true);
  });

  it("force 不能绕过其余四个条件", () => {
    expect(shouldRefetch({ ...ok, force: true, pendingWrites: 3 })).toBe(false);
    expect(shouldRefetch({ ...ok, force: true, streaming: true })).toBe(false);
    expect(shouldRefetch({ ...ok, force: true, visible: false })).toBe(false);
    expect(shouldRefetch({ ...ok, force: true, hydrated: false })).toBe(false);
  });

  it("minIntervalMs 可覆盖", () => {
    expect(
      shouldRefetch({ ...ok, lastRefetchAt: ok.now - 5_000, minIntervalMs: 1_000 }),
    ).toBe(true);
  });
});

describe("formatSyncedAgo", () => {
  const now = 10_000_000;
  it("从没拉过", () => {
    expect(formatSyncedAgo(null, now)).toBe("未同步");
  });
  it("一分钟内 = 刚刚", () => {
    expect(formatSyncedAgo(now - 59_000, now)).toBe("刚刚");
  });
  it("分钟级", () => {
    expect(formatSyncedAgo(now - 5 * 60_000, now)).toBe("5 分钟前");
  });
  it("小时级", () => {
    expect(formatSyncedAgo(now - 3 * 3_600_000, now)).toBe("3 小时前");
  });
  it("超过一天", () => {
    expect(formatSyncedAgo(now - 26 * 3_600_000, now)).toBe("1 天前");
  });
  it("未来时间戳(时钟回拨)按刚刚处理,不出负数", () => {
    expect(formatSyncedAgo(now + 5_000, now)).toBe("刚刚");
  });
});

describe("isRefetchStale", () => {
  const now = 1_000_000;

  it("null → 压根没在飞 → false", () => {
    expect(isRefetchStale(null, now)).toBe(false);
  });

  it("未到阈值 → false(仍当作在飞)", () => {
    expect(isRefetchStale(now - (REFETCH_STALE_MS - 1), now)).toBe(false);
  });

  it("恰好到阈值 → true(挂死,放行)", () => {
    expect(isRefetchStale(now - REFETCH_STALE_MS, now)).toBe(true);
  });

  it("超过阈值 → true", () => {
    expect(isRefetchStale(now - REFETCH_STALE_MS - 1, now)).toBe(true);
  });

  it("时钟回拨(startedAt 在 now 之后)→ 视为挂死、放行,而不是永远判'仍在飞'", () => {
    expect(isRefetchStale(now + 5_000, now)).toBe(true);
  });

  it("staleMs 可覆盖", () => {
    expect(isRefetchStale(now - 500, now, 1_000)).toBe(false);
    expect(isRefetchStale(now - 1_000, now, 1_000)).toBe(true);
  });
});
