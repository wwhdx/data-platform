import { describe, it, expect } from "vitest";
import { captureFromRequest, redactUrl, toCurl } from "../../lib/httpCapture";

describe("httpCapture", () => {
  it("redactUrl masks api_key", () => {
    const out = redactUrl("https://api.example.org/x?api_key=secret&db=pubmed");
    expect(out).toContain("api_key=REDACTED");
    expect(out).not.toContain("secret");
    expect(out).toContain("db=pubmed");
  });

  it("toCurl escapes single quotes in URL", () => {
    const curl = toCurl({
      method: "GET",
      url: "https://example.com/a'b",
    });
    expect(curl).toContain("curl -sS");
    expect(curl).toContain("a'\\''b");
  });

  it("captureFromRequest builds GET curl with User-Agent", () => {
    const cap = captureFromRequest("https://api.openalex.org/works/W1?api_key=xyz", {
      headers: { "User-Agent": "Test/1" },
    });
    expect(cap.method).toBe("GET");
    expect(cap.url).toContain("api_key=REDACTED");
    expect(cap.curl).toContain("User-Agent: Test/1");
    expect(cap.curl).not.toContain("xyz");
  });

  it("captureFromRequest supports POST JSON body", () => {
    const cap = captureFromRequest("https://api.example.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "test" }),
    });
    expect(cap.method).toBe("POST");
    expect(cap.curl).toContain("-X POST");
    expect(cap.curl).toContain("-d");
  });
});
