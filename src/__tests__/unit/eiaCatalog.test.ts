import { describe, it, expect, vi, beforeEach } from "vitest";
import { crawlEiaCatalog } from "../../connectors/eia/catalogCrawl";
import type { EiaJsonFetcher } from "../../connectors/eia/api";

vi.mock("../../storage/models/eiaCatalogRoute", () => ({
  upsertEiaCatalogRoute: vi.fn().mockResolvedValue(undefined),
  applyYamlTiersToCatalog: vi.fn().mockResolvedValue(undefined),
}));

describe("crawlEiaCatalog", () => {
  const fetchMeta = vi.fn<EiaJsonFetcher>();

  beforeEach(() => {
    fetchMeta.mockReset();
  });

  it("遍历 routes 并登记叶子 /data", async () => {
    fetchMeta.mockImplementation(async (route) => {
      if (route === "") {
        return {
          response: {
            routes: [{ id: "petroleum", name: "Petroleum" }],
          },
        };
      }
      if (route === "petroleum") {
        return {
          response: {
            routes: [{ id: "pri", name: "Prices" }],
          },
        };
      }
      if (route === "petroleum/pri") {
        return { response: { id: "pri", name: "Prices" } };
      }
      if (route === "petroleum/pri/data") {
        return {
          response: {
            frequency: [{ id: "daily" }],
            total: "100",
            data: [{ period: "2024-01-01", value: "1" }],
          },
        };
      }
      return null;
    });

    const result = await crawlEiaCatalog(fetchMeta, [
      { path: "petroleum/pri/data", tier: "A", collect_enabled: true },
    ]);
    expect(result.discovered).toBe(1);
    expect(result.topLevelsSeen).toContain("petroleum");
    expect(fetchMeta).toHaveBeenCalled();
  });
});
