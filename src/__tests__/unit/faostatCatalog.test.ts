import { describe, it, expect, vi, beforeEach } from "vitest";
import { crawlFaostatCatalog } from "../../connectors/faostat/catalogCrawl";
import * as fs from "fs";
import * as path from "path";

vi.mock("../../storage/models/faostatCatalog", () => ({
  upsertFaostatCatalogDataflow: vi.fn().mockResolvedValue(undefined),
  applyYamlTiersToFaostatCatalog: vi.fn().mockResolvedValue(undefined),
}));

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../fixtures/faostat-dataflows-snippet.json"),
    "utf-8",
  ),
);

describe("faostat catalogCrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crawlFaostatCatalog 入库 dataflow", async () => {
    const { upsertFaostatCatalogDataflow } = await import(
      "../../storage/models/faostatCatalog"
    );
    const result = await crawlFaostatCatalog(fixture, [
      {
        agency: "FAO",
        flowId: "DF_SDG_2_1_1",
        key: "all",
        tier: "A",
        title: "undernourishment",
      },
    ]);
    expect(result.dataflows).toBe(2);
    expect(upsertFaostatCatalogDataflow).toHaveBeenCalled();
  });
});
