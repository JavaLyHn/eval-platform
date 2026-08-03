import { describe, it, expect, vi } from "vitest";
import { MOBILE_MEDIA_QUERY, readIsMobile } from "./use-is-mobile";

function fakeWin(matches: boolean) {
  const matchMedia = vi.fn((q: string) => ({ media: q, matches }));
  return { win: { matchMedia } as unknown as Window, matchMedia };
}

describe("readIsMobile", () => {
  it("无 window 返回 false", () => {
    expect(readIsMobile(undefined)).toBe(false);
  });

  it("window 无 matchMedia 返回 false", () => {
    expect(readIsMobile({} as Window)).toBe(false);
  });

  it("matchMedia 命中 → true,并用手机断点查询", () => {
    const { win, matchMedia } = fakeWin(true);
    expect(readIsMobile(win)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(MOBILE_MEDIA_QUERY);
  });

  it("matchMedia 未命中 → false", () => {
    const { win } = fakeWin(false);
    expect(readIsMobile(win)).toBe(false);
  });

  it("断点为 max-width: 767px", () => {
    expect(MOBILE_MEDIA_QUERY).toBe("(max-width: 767px)");
  });
});
