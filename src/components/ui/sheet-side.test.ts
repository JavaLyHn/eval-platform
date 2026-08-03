import { describe, it, expect } from "vitest";
import { sheetSideClasses } from "./sheet";

describe("sheetSideClasses", () => {
  it("right(默认)靠右 + 左边框 + 从右滑入/滑出", () => {
    const c = sheetSideClasses("right");
    expect(c).toContain("right-0");
    expect(c).toContain("border-l");
    expect(c).toContain("slide-in-from-right");
    expect(c).toContain("slide-out-to-right");
    expect(c).not.toContain("left-0");
  });

  it("left 靠左 + 右边框 + 从左滑入/滑出", () => {
    const c = sheetSideClasses("left");
    expect(c).toContain("left-0");
    expect(c).toContain("border-r");
    expect(c).toContain("slide-in-from-left");
    expect(c).toContain("slide-out-to-left");
    expect(c).not.toContain("right-0");
  });
});
