import { describe, it, expect } from "vitest";
import { validateEmail, validatePassword } from "./auth-validate";

describe("validateEmail", () => {
  it("合法/非法", () => {
    expect(validateEmail("a@b.com")).toBe(true);
    expect(validateEmail("nope")).toBe(false);
    expect(validateEmail("")).toBe(false);
  });
});

describe("validatePassword", () => {
  it("太短返回错误文案", () => {
    expect(validatePassword("123")).toBeTruthy();
  });
  it("≥8 位返回 null", () => {
    expect(validatePassword("pw123456")).toBeNull();
  });
});
