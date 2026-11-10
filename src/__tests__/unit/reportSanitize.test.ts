import { describe, expect, it } from "vitest";
import {
  redactSecrets,
  sanitizeError,
  sanitizeUrl,
  truncate,
} from "../../report/sanitize";

describe("report sanitize", () => {
  it("removes sensitive query params and userinfo", () => {
    expect(
      sanitizeUrl("https://user:pass@api.example.com/x?api_key=secret&q=1"),
    ).toBe("https://api.example.com/x?api_key=***&q=1");
  });

  it("collapses duplicated DOI prefix", () => {
    expect(
      sanitizeUrl("https://doi.org/https://doi.org/10.1000/xyz"),
    ).toBe("https://doi.org/10.1000/xyz");
  });

  it("rejects non-http URLs", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("not a url")).toBeNull();
  });

  it("redacts query keys and bearer tokens", () => {
    expect(redactSecrets("x?token=abc&q=1 Authorization: Bearer xyz")).toBe(
      "x?token=***&q=1 Authorization: Bearer ***",
    );
  });

  it("truncates long text", () => {
    expect(truncate("a".repeat(20), 10)).toHaveLength(10);
  });

  it("sanitizes error messages", () => {
    expect(sanitizeError(new Error("api_key=secret"))).toBe("api_key=***");
  });
});
