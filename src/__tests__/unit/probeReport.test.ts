import { describe, it, expect } from "vitest";
import { formatProbeSummary } from "../../lib/probeReport";
import type { SourceStatus } from "../../types";

describe("probeReport", () => {
  it("formatProbeSummary includes HTTP when probe present", () => {
    const s: SourceStatus = {
      id: "openalex",
      name: "OpenAlex",
      license: "CC0",
      commercialUse: true,
      rateLimit: "100K/day",
      status: "healthy",
      totalDocuments: 0,
      probe: {
        sourceId: "openalex",
        method: "GET",
        url: "https://api.openalex.org/works?per_page=1",
        status: "healthy",
        httpStatus: 200,
        latencyMs: 120,
        timeoutMs: 5000,
        credentialChecks: [],
        requestHeaders: [],
        verdict: "外网探活成功 (HTTP 200)",
      },
    };
    const line = formatProbeSummary(s);
    expect(line).toContain("HTTP 200");
    expect(line).toContain("✅");
  });
});
