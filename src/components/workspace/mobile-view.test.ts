import { describe, it, expect } from "vitest";
import { nextMobileViewOnShowRightChange } from "./mobile-view";

describe("nextMobileViewOnShowRightChange", () => {
  it("无可评分→有(false→true)切到题目", () => {
    expect(nextMobileViewOnShowRightChange(false, true)).toBe("panel");
  });
  it("有→无(true→false)回对话", () => {
    expect(nextMobileViewOnShowRightChange(true, false)).toBe("chat");
  });
  it("未跳变(true→true / false→false)不动", () => {
    expect(nextMobileViewOnShowRightChange(true, true)).toBeNull();
    expect(nextMobileViewOnShowRightChange(false, false)).toBeNull();
  });
});
