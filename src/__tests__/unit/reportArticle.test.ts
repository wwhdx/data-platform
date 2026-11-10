import { describe, expect, it } from "vitest";
import { renderArticlePage } from "../../report/article";
import { buildApiIndex, buildSamplesNdjson } from "../../report/api";
import type { ReportDocument, ReportSource } from "../../report/types";

function source(overrides: Partial<ReportSource> = {}): ReportSource {
  return {
    id: "bea",
    name: "BEA",
    connector: "bea",
    virtual: false,
    enabled: true,
    industry: "电器制造",
    protocol: "rest",
    license: "Public Domain",
    commercialUse: true,
    cron: "0 3 * * 0",
    nextRunAt: null,
    credential: { env: "BEA_API_KEY", secretEnv: null, required: true, configured: true },
    probe: {
      status: "healthy",
      httpStatus: 200,
      latencyMs: 120,
      verdict: "HTTP 200",
      checkedAt: "2026-11-10T00:00:00Z",
    },
    sample: {
      kind: "indicator",
      ok: true,
      fetchedAt: "2026-11-10T00:00:00Z",
      lastSuccessAt: "2026-11-10T00:00:00Z",
      stale: false,
      items: [
        {
          title: "GDP",
          url: "https://apps.bea.gov/iTable/?reqid=19",
          publishedAt: "2025",
          snippet: null,
          fields: [
            { label: "指标", value: "GDP" },
            { label: "数值", value: "<script>alert(1)</script>" },
          ],
        },
      ],
      error: null,
    },
    error: null,
    ...overrides,
  };
}

function report(sourceItem: ReportSource): ReportDocument {
  return {
    schemaVersion: 1,
    generatedAt: "2026-11-10T00:00:00Z",
    environment: "test",
    durationMs: 1,
    summary: {
      sources: 1, enabled: 1, disabled: 0, connectors: 1, virtual: 0,
      probeHealthy: 1, probeDegraded: 0, probeError: 0, probeSkipped: 0,
      samplesOk: 1, samplesStale: 0, samplesFailed: 0, credentialMissing: 0,
      industries: 1,
    },
    warnings: [],
    sources: [sourceItem],
  };
}

describe("report article", () => {
  it("renders an indicator table and escapes sample values", () => {
    const html = renderArticlePage(source(), report(source()));
    expect(html).toContain("<table class=\"data-table\">");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("/api/v1/sources/bea.json");
  });

  it("builds index and ndjson for scripts", () => {
    const doc = report(source());
    const index = buildApiIndex(doc);
    expect(index.sources[0]?.articleUrl).toBe("/sources/bea.html");
    expect(buildSamplesNdjson(doc)).toContain('"sourceId":"bea"');
  });
});
