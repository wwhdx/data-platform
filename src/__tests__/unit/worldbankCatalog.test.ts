import { describe, it, expect, vi, beforeEach } from "vitest";
import { crawlWorldbankCatalog } from "../../connectors/worldbank/catalogCrawl";

vi.mock("../../storage/models/worldbankCatalog", () => ({
  upsertWorldbankCatalogIndicator: vi.fn().mockResolvedValue(undefined),
  applyYamlTiersToWorldbankCatalog: vi.fn().mockResolvedValue(undefined),
}));

describe("worldbank catalogCrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crawlWorldbankCatalog 分页入库 indicator", async () => {
    const { upsertWorldbankCatalogIndicator } = await import(
      "../../storage/models/worldbankCatalog"
    );
    const result = await crawlWorldbankCatalog(
      async () => [{ id: "3", value: "Economy" }],
      async (page) => {
        if (page > 1) return { meta: { page: 2, pages: 1, per_page: "2", total: 2 }, items: [] };
        return {
          meta: { page: 1, pages: 1, per_page: "2", total: 2 },
          items: [
            { id: "NY.GDP.MKTP.CD", name: "GDP", topics: [{ id: "3", value: "Economy" }] },
            { id: "SP.POP.TOTL", name: "Population", topics: [{ id: "3", value: "Economy" }] },
          ],
        };
      },
      [{ code: "NY.GDP.MKTP.CD", tier: "A", title: "GDP" }],
    );
    expect(result.indicators).toBe(2);
    expect(result.topics).toBe(1);
    expect(upsertWorldbankCatalogIndicator).toHaveBeenCalledTimes(2);
  });
});
