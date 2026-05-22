import { describe, it, expect, vi, beforeEach } from "vitest";
import { crawlCensusCatalog } from "../../connectors/census/catalogCrawl";

vi.mock("../../storage/models/censusCatalog", () => ({
  upsertCensusCatalogDataset: vi.fn().mockResolvedValue(undefined),
  applyYamlTiersToCensusCatalog: vi.fn().mockResolvedValue(undefined),
}));

describe("census catalogCrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crawlCensusCatalog 解析 discovery 片段", async () => {
    const { upsertCensusCatalogDataset } = await import(
      "../../storage/models/censusCatalog"
    );
    const result = await crawlCensusCatalog(
      {
        dataset: [
          {
            title: "M3 Manufacturing",
            c_dataset: ["timeseries", "eits", "m3"],
            c_isCube: true,
          },
        ],
      },
      [
        {
          path: "timeseries/eits/m3",
          get: "cell_value",
          tier: "A",
          title: "M3",
        },
      ],
    );
    expect(result.datasets).toBe(1);
    expect(upsertCensusCatalogDataset).toHaveBeenCalled();
  });
});
