import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shouldRedirectOn401 } from "./api-auth";

describe("shouldRedirectOn401", () => {
  it("auth 路径不跳转(避免 /me 探测死循环)", () => {
    expect(shouldRedirectOn401("/v1/auth/me")).toBe(false);
    expect(shouldRedirectOn401("/v1/auth/login")).toBe(false);
  });
  it("数据路径跳转", () => {
    expect(shouldRedirectOn401("/v1/questions")).toBe(true);
    expect(shouldRedirectOn401("/admin/migrate")).toBe(true);
  });
});

describe("api.auth 方法命中正确端点", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("login POST /v1/auth/login 带 credentials", async () => {
    const { api } = await import("./api");
    await api.auth.login("a@test.local", "pw");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/v1/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });

  it("me GET /v1/auth/me", async () => {
    const { api } = await import("./api");
    await api.auth.me();
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(String(url)).toContain("/v1/auth/me");
    expect(init.credentials).toBe("include");
  });
});
