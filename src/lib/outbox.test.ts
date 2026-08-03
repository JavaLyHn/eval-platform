import { describe, expect, it, beforeEach, vi } from "vitest";

// 假 api:记录并发峰值 + 受控 resolve + 指定 id 失败。
const probe = { concurrent: 0, max: 0, calls: 0, failIds: new Set<string>() };
vi.mock("./api", () => ({
  api: {
    questions: {
      upsert: vi.fn(async (q: { id: string }) => {
        probe.calls++;
        probe.concurrent++;
        probe.max = Math.max(probe.max, probe.concurrent);
        await new Promise((r) => setTimeout(r, 5));
        probe.concurrent--;
        if (probe.failIds.has(q.id)) throw new Error("boom");
      }),
      delete: vi.fn(async () => {}),
    },
  },
}));

import { Outbox } from "./outbox";

function seed(ob: unknown, n: number, startAttempts = 0) {
  (ob as { state: { pending: unknown[] } }).state.pending = Array.from(
    { length: n },
    (_, i) => ({
      id: `ob-${i}`,
      enqueuedAt: 0,
      table: "questions",
      op: "upsert",
      recordId: `q${i}`,
      payload: { id: `q${i}` },
      attempts: startAttempts,
      nextRetryAt: 0,
    }),
  );
}
const st = (ob: unknown) => (ob as { state: { pending: any[]; dead: any[] } }).state;
const flush = (ob: unknown) => (ob as { flush(): Promise<void> }).flush();

beforeEach(() => {
  probe.concurrent = 0;
  probe.max = 0;
  probe.calls = 0;
  probe.failIds = new Set();
});

describe("outbox 并发排空", () => {
  it("并发峰值 >1 且 ≤6;全成功后 pending 清空", async () => {
    const ob = new Outbox();
    seed(ob, 20);
    await flush(ob);
    expect(probe.calls).toBe(20);
    expect(probe.max).toBeGreaterThan(1);
    expect(probe.max).toBeLessThanOrEqual(6);
    expect(st(ob).pending).toHaveLength(0);
    expect(st(ob).dead).toHaveLength(0);
  });

  it("失败条目退避留 pending、attempts+1、不进死信", async () => {
    const ob = new Outbox();
    seed(ob, 3);
    probe.failIds = new Set(["q1"]);
    await flush(ob);
    const pend = st(ob).pending;
    expect(pend).toHaveLength(1);
    expect(pend[0].recordId).toBe("q1");
    expect(pend[0].attempts).toBe(1);
    expect(pend[0].nextRetryAt).toBeGreaterThan(Date.now());
    expect(st(ob).dead).toHaveLength(0);
  });

  it("失败达 MAX_ATTEMPTS 进死信", async () => {
    const ob = new Outbox();
    seed(ob, 1, 7); // 再失败一次 = 8
    probe.failIds = new Set(["q0"]);
    await flush(ob);
    expect(st(ob).pending).toHaveLength(0);
    expect(st(ob).dead).toHaveLength(1);
  });

  it("同一条不被并发重复派发", async () => {
    const ob = new Outbox();
    seed(ob, 6);
    await flush(ob);
    // 每条恰好派发一次(无重复):6 条 → 6 次 upsert。
    expect(probe.calls).toBe(6);
  });
});

describe("outbox.deletesEnqueued —— C-1 落地复核用的计数", () => {
  it("入队 upsert 不增加计数", () => {
    const ob = new Outbox();
    const before = ob.deletesEnqueued();
    ob.enqueue({ table: "questions", op: "upsert", recordId: "q1", payload: { id: "q1" } });
    expect(ob.deletesEnqueued()).toBe(before);
  });

  it("入队 delete 增加计数;coalesce 掉旧的 pending 条目时也要算一次", () => {
    const ob = new Outbox();
    const before = ob.deletesEnqueued();
    // 先入队一条 upsert(占住 pending 里的这个 key)……
    ob.enqueue({ table: "questions", op: "upsert", recordId: "q1", payload: { id: "q1" } });
    expect(ob.deletesEnqueued()).toBe(before);
    // ……再对同一条记录入队 delete:coalesce 会把上面那条 upsert 从 pending 里挤掉,
    // 但计数只看"这次入队的是不是 delete",不关心是否发生了 coalesce,必须 +1。
    ob.enqueue({ table: "questions", op: "delete", recordId: "q1" });
    expect(ob.deletesEnqueued()).toBe(before + 1);
  });
});
