/**
 * P 轨：父仓对接闭环（子包内验证全部 HTTP 契约，不依赖望野主仓）。
 * 对应 docs/plans/父仓对接集成测试闭环方案.md
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  DataPlatformClient,
  createDataPlatformClient,
} from "../../../client/dataPlatformClient";
import { createDataPlatformSearchProvider } from "../../../adapters/engineCore";
import { FIXTURE_SOURCE_ID } from "../../fixtures/fixtureConnector";
import { checkDbAvailable } from "../helpers/dbAvailable";
import { withIntegrationHarness } from "../helpers/harness";
import { waitForChunks } from "../helpers/waitForChunks";

let dbReady = false;

describe("integration/parent: 父仓对接闭环（P 轨）", () => {
  beforeAll(async () => {
    dbReady = await checkDbAvailable();
  });

  it("P-A: DataPlatformClient.search + SearchProvider 知识注入", async () => {
    if (!dbReady) return;

    await withIntegrationHarness(async ({ baseUrl }) => {
      const client = createDataPlatformClient(baseUrl);

      const job = await client.triggerCollect({
        sourceId: FIXTURE_SOURCE_ID,
        query: "",
      });
      expect(job).toBeTruthy();
      if (job && "status" in job) {
        expect(job.status).toBe("success");
      }

      await waitForChunks(3);

      const results = await client.search({
        query: "transformer attention",
        maxResults: 5,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.title).toContain("Transformer");
      expect(results[0]?.snippet.length).toBeGreaterThan(10);
      expect(results[0]?.license).toBeTruthy();

      const provider = createDataPlatformSearchProvider(baseUrl);
      const viaEngine = await provider.search("CRISPR Cas9", { maxResults: 3 });
      expect(viaEngine[0]?.title).toContain("CRISPR");
      expect(viaEngine[0]?.snippet).toContain("Cas9");
    });
  });

  it("P-B: search filters.sourceIds 限定 fixture", async () => {
    if (!dbReady) return;

    await withIntegrationHarness(async ({ scheduler, baseUrl }) => {
      await scheduler.trigger(FIXTURE_SOURCE_ID, "");
      await waitForChunks(3);

      const client = createDataPlatformClient(baseUrl);
      const onlyFixture = await client.search({
        query: "economic GDP",
        maxResults: 10,
        filters: { sourceIds: [FIXTURE_SOURCE_ID] },
      });
      expect(onlyFixture.every((r) => r.sourceId === FIXTURE_SOURCE_ID)).toBe(
        true,
      );
      expect(
        onlyFixture.some((r) => r.title.includes("World Bank")),
      ).toBe(true);

      const empty = await client.search({
        query: "economic GDP",
        filters: { sourceIds: ["nonexistent-source-xyz"] },
      });
      expect(empty).toEqual([]);
    });
  });

  it("P-D: getSources + getStats 管理监控", async () => {
    if (!dbReady) return;

    await withIntegrationHarness(async ({ scheduler, baseUrl }) => {
      await scheduler.trigger(FIXTURE_SOURCE_ID, "");
      await waitForChunks(3);

      const client = createDataPlatformClient(baseUrl);
      const sources = await client.getSources();
      expect(sources.some((s) => s.id === FIXTURE_SOURCE_ID)).toBe(true);

      const fixtureRow = sources.find((s) => s.id === FIXTURE_SOURCE_ID);
      expect(fixtureRow?.status).toBe("active");
      expect(Number(fixtureRow?.total_docs ?? 0)).toBeGreaterThanOrEqual(3);

      const stats = await client.getStats();
      expect(stats.totalDocuments).toBeGreaterThanOrEqual(3);
      expect(stats.activeSources).toBeGreaterThanOrEqual(1);
      expect(stats.successfulJobs).toBeGreaterThanOrEqual(1);
    });
  });

  it("P-E: triggerCollect → getJobs 采集闭环", async () => {
    if (!dbReady) return;

    await withIntegrationHarness(async ({ baseUrl }) => {
      const client = createDataPlatformClient(baseUrl);
      const before = await client.getJobs(5);

      const job = await client.triggerCollect({
        sourceId: FIXTURE_SOURCE_ID,
      });
      expect(job).toBeTruthy();
      if (job && "itemsCollected" in job) {
        expect(job.itemsCollected).toBe(3);
      }

      const after = await client.getJobs(5);
      expect(after.length).toBeGreaterThanOrEqual(before.length);
      expect(after[0]?.sourceId).toBe(FIXTURE_SOURCE_ID);
    });
  });

  it("P-F: getSchedules live cron", async () => {
    if (!dbReady) return;

    await withIntegrationHarness(async ({ scheduler, baseUrl }) => {
      scheduler.schedule(FIXTURE_SOURCE_ID, "0 12 * * *", "");

      const client = createDataPlatformClient(baseUrl);
      const schedules = await client.getSchedules();
      expect(schedules?.mode).toBe("live");
      expect(
        schedules?.active.some(
          (s) =>
            s.sourceId === FIXTURE_SOURCE_ID && s.cronExpr === "0 12 * * *",
        ),
      ).toBe(true);
    });
  });

  it("P-Health: health() 含 DB 与 fixture 源", async () => {
    if (!dbReady) return;

    await withIntegrationHarness(async ({ scheduler, baseUrl }) => {
      await scheduler.trigger(FIXTURE_SOURCE_ID, "");
      await waitForChunks(3);

      const client = createDataPlatformClient(baseUrl);
      const h = await client.health();
      expect(h?.ok).toBe(true);
      expect(h?.db).toBe("ok");
      expect(
        h?.sources.some((s) => s.id === FIXTURE_SOURCE_ID),
      ).toBe(true);

      expect(await client.isReachable()).toBe(true);
    });
  });

  it("P-Graceful: 不可达服务返回空、不抛错", async () => {
    const client = createDataPlatformClient("http://127.0.0.1:1");
    expect(await client.search({ query: "test" })).toEqual([]);
    expect(await client.getSources()).toEqual([]);
    expect(await client.getStats()).toEqual({
      totalDocuments: 0,
      activeSources: 0,
      successfulJobs: 0,
    });
    expect(await client.health()).toBeNull();
    expect(await client.isReachable()).toBe(false);
    expect(await DataPlatformClient.fromEnv({})).toBeNull();
  });
});
