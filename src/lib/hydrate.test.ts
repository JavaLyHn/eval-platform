import { describe, it, expect } from "vitest";
import {
  mergeById,
  mergeByIdDropping,
  mergeMessagesById,
  mergeConversationsWithMessages,
} from "./hydrate";

type Row = { id: string; n?: number };

describe("mergeById(local-wins)", () => {
  it("server 为空 → 原样返回 local", () => {
    expect(mergeById([{ id: "a" }], null)).toEqual([{ id: "a" }]);
    expect(mergeById([{ id: "a" }], [])).toEqual([{ id: "a" }]);
  });
  it("追加 server-only;同 id 本地优先(不覆盖)", () => {
    const out = mergeById<Row>([{ id: "a", n: 1 }], [{ id: "a", n: 9 }, { id: "b", n: 2 }]);
    expect(out).toEqual([{ id: "a", n: 1 }, { id: "b", n: 2 }]);
  });
});

describe("mergeByIdDropping(丢弃 fresh 占位)", () => {
  it("server 有数据 → 丢掉 dropIds 里的本地占位,再并入 server", () => {
    // 模拟:本地只有一个 fresh 占位 placeholder,服务器有真实 a/b
    const out = mergeByIdDropping<Row>(
      [{ id: "placeholder" }],
      [{ id: "a" }, { id: "b" }],
      new Set(["placeholder"]),
    );
    expect(out).toEqual([{ id: "a" }, { id: "b" }]);
    expect(out.find((x) => x.id === "placeholder")).toBeUndefined();
  });
  it("server 为空 → 不丢占位(全新安装仍能 bootstrap)", () => {
    const out = mergeByIdDropping<Row>([{ id: "placeholder" }], [], new Set(["placeholder"]));
    expect(out).toEqual([{ id: "placeholder" }]);
  });
  it("不丢非占位的真实本地数据(离线新建未同步的会话/profile)", () => {
    const out = mergeByIdDropping<Row>(
      [{ id: "placeholder" }, { id: "local-real" }],
      [{ id: "a" }],
      new Set(["placeholder"]),
    );
    // placeholder 丢、local-real 留、a 并入
    expect(out.map((x) => x.id).sort()).toEqual(["a", "local-real"]);
  });
  it("dropIds 为空 → 等同 mergeById", () => {
    const out = mergeByIdDropping<Row>([{ id: "a" }], [{ id: "b" }], new Set());
    expect(out).toEqual([{ id: "a" }, { id: "b" }]);
  });
});

describe("mergeMessagesById", () => {
  const m = (id: string, createdAt?: string, extra?: Record<string, unknown>) => ({
    id,
    createdAt,
    ...extra,
  });

  it("服务器为空 → 原样返回同一引用", () => {
    const local = [m("a", "2026-07-25T01:00:00.000Z")];
    expect(mergeMessagesById(local, [])).toBe(local);
    expect(mergeMessagesById(local, null)).toBe(local);
  });

  it("服务器全是本机已有 id → 同一引用(不制造回声)", () => {
    const local = [m("a", "2026-07-25T01:00:00.000Z"), m("b", "2026-07-25T02:00:00.000Z")];
    expect(mergeMessagesById(local, [m("b", "2026-07-25T09:00:00+08:00"), m("a")])).toBe(local);
  });

  it("同 id 保留本机对象(不被服务器版本覆盖)", () => {
    const mine = m("a", "2026-07-25T01:00:00.000Z", { content: "本机" });
    const out = mergeMessagesById([mine, m("z", "2026-07-25T00:00:00.000Z")], [
      m("a", "2026-07-25T01:00:00.000Z", { content: "服务器" }),
      m("new", "2026-07-25T03:00:00.000Z"),
    ]);
    expect(out.find((x) => x.id === "a")).toBe(mine);
  });

  it("服务器新增按时刻插入 —— 跨时区必须按 Date.parse 比较", () => {
    // +08:00 的 09:30 = UTC 01:30,应排在 UTC 01:00 与 02:00 之间
    const out = mergeMessagesById(
      [m("a", "2026-07-25T01:00:00.000Z"), m("c", "2026-07-25T02:00:00.000Z")],
      [m("b", "2026-07-25T09:30:00+08:00")],
    );
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("任一条缺 createdAt → 不排序,本机原序 + 服务器新增追加在尾部", () => {
    const out = mergeMessagesById(
      [m("a"), m("b", "2026-07-25T05:00:00.000Z")],
      [m("s1", "2026-07-25T00:00:00.000Z"), m("s2", "2026-07-25T01:00:00.000Z")],
    );
    expect(out.map((x) => x.id)).toEqual(["a", "b", "s1", "s2"]);
  });

  it("同刻稳定:本机在前、服务器新增在后", () => {
    const out = mergeMessagesById(
      [m("a", "2026-07-25T01:00:00.000Z")],
      [m("s", "2026-07-25T01:00:00.000Z")],
    );
    expect(out.map((x) => x.id)).toEqual(["a", "s"]);
  });

  it("服务器上 isStreaming 的消息不采纳(否则 local-wins 会把半截气泡钉死)", () => {
    const local = [m("a", "2026-07-25T01:00:00.000Z")];
    expect(
      mergeMessagesById(local, [m("half", "2026-07-25T02:00:00.000Z", { isStreaming: true })]),
    ).toBe(local);
  });
});

describe("mergeConversationsWithMessages", () => {
  const msg = (id: string, createdAt: string) => ({ id, createdAt });
  const conv = (id: string, title: string, messages: Array<{ id: string; createdAt: string }>) => ({
    id,
    title,
    messages,
  });

  it("服务器为空 → 同一引用", () => {
    const local = [conv("c1", "本机", [msg("m1", "2026-07-25T01:00:00.000Z")])];
    expect(mergeConversationsWithMessages(local, null, new Set())).toBe(local);
    expect(mergeConversationsWithMessages(local, [], new Set())).toBe(local);
  });

  it("服务器独有会话 → 追加", () => {
    const local = [conv("c1", "本机", [msg("m1", "2026-07-25T01:00:00.000Z")])];
    const out = mergeConversationsWithMessages(
      local,
      [conv("c2", "别的设备", [msg("m9", "2026-07-25T02:00:00.000Z")])],
      new Set(),
    );
    expect(out.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("两边都有的会话:消息并集,元信息(标题)仍取本机", () => {
    const local = [conv("c1", "本机标题", [msg("m1", "2026-07-25T01:00:00.000Z")])];
    const out = mergeConversationsWithMessages(
      local,
      [conv("c1", "服务器标题", [
        msg("m1", "2026-07-25T01:00:00.000Z"),
        msg("m2", "2026-07-25T02:00:00.000Z"),
      ])],
      new Set(),
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("本机标题");
    expect(out[0].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("没有任何新增(会话与消息都已在本机)→ 同一引用", () => {
    const local = [conv("c1", "本机", [msg("m1", "2026-07-25T01:00:00.000Z")])];
    expect(
      mergeConversationsWithMessages(
        local,
        [conv("c1", "服务器", [msg("m1", "2026-07-25T09:00:00+08:00")])],
        new Set(),
      ),
    ).toBe(local);
  });

  it("dropIds 里的本机占位会话被丢弃(服务器有数据时)", () => {
    const local = [
      conv("placeholder", "新对话", []),
      conv("c1", "本机", [msg("m1", "2026-07-25T01:00:00.000Z")]),
    ];
    const out = mergeConversationsWithMessages(
      local,
      [conv("c9", "服务器", [msg("m9", "2026-07-25T02:00:00.000Z")])],
      new Set(["placeholder"]),
    );
    expect(out.map((c) => c.id)).toEqual(["c1", "c9"]);
  });

  it("本机完全没见过的会话(serverOnly)也要过滤内部 isStreaming 消息(与两边都有的会话对称)", () => {
    const local = [conv("c1", "本机", [msg("m1", "2026-07-25T01:00:00.000Z")])];
    const serverOnlyConv = {
      id: "c9",
      title: "别的设备",
      messages: [
        msg("m9", "2026-07-25T02:00:00.000Z"),
        { id: "half", createdAt: "2026-07-25T03:00:00.000Z", isStreaming: true },
      ],
    };
    const out = mergeConversationsWithMessages(local, [serverOnlyConv], new Set());
    const c9 = out.find((c) => c.id === "c9");
    expect(c9?.messages.map((m) => m.id)).toEqual(["m9"]);
  });

  it("serverOnly 会话没有 isStreaming 消息 → 会话对象保持服务器返回的同一引用(不为了过滤瞎新建)", () => {
    const local = [conv("c1", "本机", [msg("m1", "2026-07-25T01:00:00.000Z")])];
    const serverOnlyConv = conv("c9", "别的设备", [msg("m9", "2026-07-25T02:00:00.000Z")]);
    const out = mergeConversationsWithMessages(local, [serverOnlyConv], new Set());
    expect(out.find((c) => c.id === "c9")).toBe(serverOnlyConv);
  });
});
