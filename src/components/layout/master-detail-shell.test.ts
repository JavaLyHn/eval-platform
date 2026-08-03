import { describe, it, expect } from "vitest";
import { masterListAsideClasses } from "./master-detail-shell";

describe("masterListAsideClasses", () => {
  it("含传入的宽度类与 shrink-0", () => {
    const c = masterListAsideClasses("w-72");
    expect(c).toContain("w-72");
    expect(c).toContain("shrink-0");
  });

  it("附加类拼在后面(可覆盖)", () => {
    const c = masterListAsideClasses("w-48", "border-r border-border p-2");
    expect(c).toContain("w-48");
    expect(c).toContain("border-r");
    expect(c).toContain("p-2");
  });

  it("不传附加类时不产生 undefined 字样", () => {
    expect(masterListAsideClasses("w-60")).not.toContain("undefined");
  });
});
