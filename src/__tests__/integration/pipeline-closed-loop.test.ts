import { describe, it, expect, beforeAll } from "vitest";
import { createDataPlatformSearchProvider } from "../../adapters/engineCore";
import { FIXTURE_SOURCE_ID } from "../fixtures/fixtureConnector";
import { checkDbAvailable } from "./helpers/dbAvailable";
import { withIntegrationHarness } from "./helpers/harness";
import { waitForChunks } from "./helpers/waitForChunks";

let dbReady = false;

describe("I 轨：pipeline closed loop", () => {
  beforeAll(async () => {
    dbReady = await checkDbAvailable();
  });

  it("collect → embed → search → SearchProvider", async () => {
    if (!dbReady) return;

    await withIntegrationHarness(async ({ scheduler, baseUrl }) => {
      const job = await scheduler.trigger(FIXTURE_SOURCE_ID, "");
      expect(job.status).toBe("success");
      expect(job.itemsCollected).toBe(3);

      await waitForChunks(3);

      const res = await fetch(`${baseUrl}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "transformer attention",
          maxResults: 5,
        }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        results: Array<{ title: string; snippet: string }>;
        totalCount: number;
      };
      expect(body.totalCount).toBeGreaterThan(0);
      expect(
        body.results.some((r) => r.title.includes("Transformer")),
      ).toBe(true);

      const provider = createDataPlatformSearchProvider(baseUrl);
      expect(provider.id).toBe("data-platform");

      const viaAdapter = await provider.search("transformer attention", {
        maxResults: 5,
      });
      expect(viaAdapter.length).toBeGreaterThan(0);
      expect(viaAdapter[0]?.title).toContain("Transformer");
      expect(viaAdapter[0]?.snippet.length).toBeGreaterThan(0);
    });
  });
});
