import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "../../report/collect";
import { collectSample } from "../../report/samples";
import type { ReportSampleInfo } from "../../report/types";

const state = vi.hoisted(() => ({ enabled: true }));
vi.mock("../../config/loader", () => ({
  parseConfigFile: () => ({}),
  loadConfigFromFile: () => ({
    config: {},
    expanded: [{ id: "openalex", name: "OpenAlex", enabled: state.enabled }],
  }),
}));
vi.mock("../../config/runtime", () => ({ setExpandedSources: vi.fn() }));
vi.mock("../../connectors/bootstrap", () => ({ REGISTERED_CONNECTOR_IDS: ["openalex"] }));
vi.mock("../../connectors/credentials", () => ({
  SOURCE_CREDENTIAL_SPECS: {},
  validateCredentialsForCollect: () => null,
}));
vi.mock("../../connectors/factory", () => ({ resolveConnectorConfig: async () => ({}) }));
vi.mock("../../scheduler/scheduleReport", () => ({
  buildScheduleReport: () => [{ sourceId: "openalex", yamlEnabled: state.enabled }],
  attachNextRunTimes: (rows: unknown[]) => rows,
}));
vi.mock("../../lib/sourceProbe", () => ({
  probeExternalSourceDetailed: async () => ({ status: "healthy", verdict: "HTTP 200" }),
}));
vi.mock("../../report/catalog", () => ({
  CONNECTOR_REGISTRY: { openalex: { meta: { baseUrl: "https://example.test" }, create: () => ({}) } },
  sampleKindFor: () => "paper",
  fallbackQueryFor: () => "science",
}));
vi.mock("../../report/samples", () => ({ collectSample: vi.fn() }));

const prior: ReportSampleInfo = {
  kind: "paper", ok: true, fetchedAt: "2026-11-18T04:30:00.000Z",
  lastSuccessAt: "2026-11-18T04:30:00.000Z", stale: false, error: null,
  items: [{ title: "Cached paper", url: null, publishedAt: null, snippet: null, fields: [] }],
};
let root: string;
let cacheFile: string;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T04:30:00.000Z"));
  state.enabled = true;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-report-collect-"));
  cacheFile = path.join(root, "cache.json");
  fs.writeFileSync(cacheFile, JSON.stringify({ sources: [{ id: "openalex", sample: prior }] }));
  vi.mocked(collectSample).mockReset().mockResolvedValue({ items: [], error: "empty" });
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("report collection recovery", () => {
  it("keeps the last successful samples after a hard source timeout", async () => {
    vi.mocked(collectSample).mockImplementation(() => new Promise(() => {}));
    const pending = buildReport({ root, cacheFile });
    await vi.advanceTimersByTimeAsync(45_000);
    const report = await pending;

    expect(report.sources[0].sample).toMatchObject({
      ...prior, stale: true, error: "openalex 超过 45000ms，已跳过",
    });
    expect(report.sources[0].error).toContain("45000ms");
    expect(report.summary).toMatchObject({ samplesOk: 0, samplesStale: 1, samplesFailed: 0 });
    expect(report.warnings.some((w) => w.message.includes("缓存"))).toBe(true);

    fs.writeFileSync(cacheFile, JSON.stringify(report));
    const next = buildReport({ root, cacheFile });
    await vi.advanceTimersByTimeAsync(45_000);
    expect((await next).sources[0].sample.lastSuccessAt).toBe(prior.lastSuccessAt);
  });

  it("keeps normal failure recovery and the original cache timestamps", async () => {
    const report = await buildReport({ root, cacheFile });
    expect(report.sources[0].sample).toMatchObject({ ...prior, stale: true, error: "empty" });
    expect(report.summary.samplesOk).toBe(0);
  });

  it("does not restore old samples for a disabled source", async () => {
    state.enabled = false;
    const report = await buildReport({ root, cacheFile });
    expect(report.sources[0].sample.items).toEqual([]);
    expect(report.sources[0].sample.stale).toBe(false);
    expect(collectSample).not.toHaveBeenCalled();
  });

  it("uses fresh samples instead of the cache", async () => {
    const items = [{ ...prior.items[0], title: "Fresh paper" }];
    vi.mocked(collectSample).mockResolvedValue({ items, error: null });
    const report = await buildReport({ root, cacheFile });
    expect(report.sources[0].sample).toMatchObject({ items, stale: false, error: null });
    expect(report.sources[0].sample.fetchedAt).toBe("2026-11-20T04:30:00.000Z");
    expect(report.summary).toMatchObject({ samplesOk: 1, samplesStale: 0, samplesFailed: 0 });
  });

  it("keeps a timeout without cached samples visibly failed", async () => {
    vi.mocked(collectSample).mockImplementation(() => new Promise(() => {}));
    const pending = buildReport({ root });
    await vi.advanceTimersByTimeAsync(45_000);
    const report = await pending;
    expect(report.sources[0].sample).toMatchObject({ ok: false, stale: false, items: [] });
    expect(report.summary.samplesFailed).toBe(1);
  });

  it("shows a warning when fresh samples include an interrupted collection", async () => {
    vi.mocked(collectSample).mockResolvedValue({ items: prior.items, error: "stream interrupted" });
    const report = await buildReport({ root, cacheFile });
    expect(report.sources[0].sample).toMatchObject({ ok: true, stale: false, error: "stream interrupted" });
    expect(report.warnings.some((w) => w.message.includes("stream interrupted"))).toBe(true);
  });
});
