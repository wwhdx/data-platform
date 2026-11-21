import type { ReportDocument, ReportSampleItem, ReportSource } from "../../report/types";

export const REPORT_TIME = "2026-11-20T04:30:00.000Z";

export function reportItem(title: string, publishedAt: string | null = null): ReportSampleItem {
  return { title, publishedAt, url: `https://example.test/${encodeURIComponent(title)}`, snippet: null, fields: [] };
}

export function reportSource(id: string, items: ReportSampleItem[] = [], overrides: Partial<ReportSource> = {}): ReportSource {
  return {
    id, name: id, connector: id, virtual: false, enabled: true, industry: null,
    protocol: "rest", license: "CC0", commercialUse: true, cron: null, nextRunAt: null,
    credential: { env: null, secretEnv: null, required: false, configured: true },
    probe: { status: "healthy", httpStatus: 200, latencyMs: 1, verdict: "HTTP 200", checkedAt: REPORT_TIME },
    sample: { kind: "paper", ok: items.length > 0, fetchedAt: REPORT_TIME,
      lastSuccessAt: REPORT_TIME, stale: false, error: null, items },
    error: null, ...overrides,
  };
}

export function reportDocument(sources: ReportSource[], generatedAt = REPORT_TIME): ReportDocument {
  return {
    schemaVersion: 1, generatedAt, environment: "test", durationMs: 1, sources, warnings: [],
    summary: { sources: sources.length, enabled: sources.length, disabled: 0, connectors: sources.length,
      virtual: 0, probeHealthy: sources.length, probeDegraded: 0, probeError: 0, probeSkipped: 0,
      samplesOk: sources.length, samplesStale: 0, samplesFailed: 0, credentialMissing: 0, industries: 0 },
  };
}
