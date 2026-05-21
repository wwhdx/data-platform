import { describe, it, expect } from "vitest";
import { hasNonemptyApiErrorPayload } from "../../lib/jsonApiErrors";

describe("jsonApiErrors", () => {
  it("hasNonemptyApiErrorPayload：空数组不算失败", () => {
    expect(hasNonemptyApiErrorPayload([])).toBe(false);
    expect(hasNonemptyApiErrorPayload(undefined)).toBe(false);
    expect(hasNonemptyApiErrorPayload(null)).toBe(false);
  });

  it("hasNonemptyApiErrorPayload：非空数组或对象算失败", () => {
    expect(hasNonemptyApiErrorPayload([{ status: 404 }])).toBe(true);
    expect(hasNonemptyApiErrorPayload({ message: "x" })).toBe(true);
  });
});
