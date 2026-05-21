import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { crawlFredCatalog } from "../../connectors/fred/catalogCrawl";

vi.mock("../../storage/models/fredCatalog", () => ({
  upsertFredCatalogCategory: vi.fn().mockResolvedValue(undefined),
  upsertFredCatalogSeries: vi.fn().mockResolvedValue(undefined),
  applyYamlTiersToFredCatalogSeries: vi.fn().mockResolvedValue(undefined),
}));

const ROOT_CHILDREN = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../fixtures/fred-categories-snippet.json"),
    "utf-8",
  ),
);

describe("fred catalogCrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crawlFredCatalog BFS 登记 category 与 YAML series", async () => {
    const fetchChildren = vi.fn(async (categoryId: number) => {
      if (categoryId === 0) return ROOT_CHILDREN;
      if (categoryId === 10) {
        return { categories: [{ id: 101, name: "Unemployment", parent_id: 10 }] };
      }
      return { categories: [] };
    });

    const { upsertFredCatalogCategory, upsertFredCatalogSeries } = await import(
      "../../storage/models/fredCatalog"
    );

    const result = await crawlFredCatalog(fetchChildren, [
      { series_id: "GDP", tier: "A", title: "GDP" },
    ]);

    expect(result.categories).toBeGreaterThan(0);
    expect(upsertFredCatalogCategory).toHaveBeenCalled();
    expect(upsertFredCatalogSeries).toHaveBeenCalledWith(
      expect.objectContaining({ seriesId: "GDP", tier: "A" }),
    );
    expect(fetchChildren).toHaveBeenCalledWith(0);
  });
});
