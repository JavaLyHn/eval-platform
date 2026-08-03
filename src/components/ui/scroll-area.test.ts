import { describe, it, expect } from "vitest";
import { scrollBarClasses } from "./scroll-area";

describe("scrollBarClasses", () => {
  it("vertical:竖条宽度 + 左边框", () => {
    const c = scrollBarClasses("vertical");
    expect(c).toContain("h-full");
    expect(c).toContain("w-2");
    expect(c).toContain("border-l");
    expect(c).not.toContain("border-t");
  });

  it("horizontal:横条高度 + 上边框 + 纵向排列", () => {
    const c = scrollBarClasses("horizontal");
    expect(c).toContain("h-2");
    expect(c).toContain("flex-col");
    expect(c).toContain("border-t");
    expect(c).not.toContain("border-l");
  });
});
