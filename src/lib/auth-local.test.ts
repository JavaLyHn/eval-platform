import { describe, it, expect, vi, beforeEach } from "vitest";

function makeLocalStorageMock() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    _dump: () => [...m.keys()],
  };
}

describe("reconcileLocalUser", () => {
  let ls: ReturnType<typeof makeLocalStorageMock>;
  beforeEach(() => {
    ls = makeLocalStorageMock();
    vi.stubGlobal("localStorage", ls);
  });

  it("首次登录:无 marker → 写入 marker(不报错)", async () => {
    const { reconcileLocalUser } = await import("./auth-local");
    reconcileLocalUser("user-A");
    expect(ls.getItem("qa-auth:lastUserId")).toBe("user-A");
  });

  it("同一用户再次登录:不清数据", async () => {
    const { reconcileLocalUser } = await import("./auth-local");
    ls.setItem("qa-auth:lastUserId", "user-A");
    ls.setItem("eval-platform:questions:v1", "{}");
    reconcileLocalUser("user-A");
    expect(ls.getItem("eval-platform:questions:v1")).toBe("{}"); // 没清
  });

  it("换用户:清空 eval-platform:* 但保留并更新 marker", async () => {
    const { reconcileLocalUser } = await import("./auth-local");
    ls.setItem("qa-auth:lastUserId", "user-A");
    ls.setItem("eval-platform:questions:v1", "{}");
    reconcileLocalUser("user-B");
    expect(ls.getItem("eval-platform:questions:v1")).toBeNull(); // A 的数据清了
    expect(ls.getItem("qa-auth:lastUserId")).toBe("user-B");   // marker 更新且未被连带清
  });
});

describe("known emails(切换账号快捷回填)", () => {
  let ls: ReturnType<typeof makeLocalStorageMock>;
  beforeEach(() => {
    ls = makeLocalStorageMock();
    vi.stubGlobal("localStorage", ls);
  });

  it("rememberEmail:去重 + 置顶 + 归一化(trim/小写)", async () => {
    const { rememberEmail, getKnownEmails } = await import("./auth-local");
    rememberEmail("A@x.com");
    rememberEmail("b@x.com");
    rememberEmail("  A@X.com "); // 同一邮箱不同大小写/空格 → 去重并置顶
    expect(getKnownEmails()).toEqual(["a@x.com", "b@x.com"]);
  });

  it("上限 6 个,超出丢最旧", async () => {
    const { rememberEmail, getKnownEmails } = await import("./auth-local");
    for (let i = 0; i < 8; i++) rememberEmail(`u${i}@x.com`);
    const list = getKnownEmails();
    expect(list).toHaveLength(6);
    expect(list[0]).toBe("u7@x.com"); // 最新置顶
    expect(list).not.toContain("u0@x.com"); // 最旧被挤掉
  });

  it("forgetEmail:移除指定邮箱(大小写不敏感)", async () => {
    const { rememberEmail, forgetEmail, getKnownEmails } = await import("./auth-local");
    rememberEmail("a@x.com");
    rememberEmail("b@x.com");
    forgetEmail("A@X.COM");
    expect(getKnownEmails()).toEqual(["b@x.com"]);
  });

  it("known emails 用 qa-auth: 前缀 → 不被 clearAllPlatformData 清掉(登出后仍在)", async () => {
    const { rememberEmail, getKnownEmails } = await import("./auth-local");
    const { clearAllPlatformData } = await import("./persistence");
    rememberEmail("a@x.com");
    ls.setItem("eval-platform:questions:v1", "{}");
    clearAllPlatformData();
    expect(ls.getItem("eval-platform:questions:v1")).toBeNull(); // 平台数据清了
    expect(getKnownEmails()).toEqual(["a@x.com"]); // 但账号列表保留
  });

  it("空 / 坏 JSON → 返回 []", async () => {
    const { getKnownEmails, rememberEmail } = await import("./auth-local");
    expect(getKnownEmails()).toEqual([]);
    ls.setItem("qa-auth:knownEmails", "not json");
    expect(getKnownEmails()).toEqual([]);
    rememberEmail(""); // 空邮箱不记
    expect(getKnownEmails()).toEqual([]);
  });
});
