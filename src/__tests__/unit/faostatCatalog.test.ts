import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeFaostatCatalogBody } from "../../connectors/faostat/catalogFetch";
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

  it("normalizeFaostatCatalogBody 解析 references map", () => {
    const body = normalizeFaostatCatalogBody({
      references: {
        "urn:sdmx:org.sdmx.infomodel.datastructure.Dataflow=FAO:DF_SDG_2_1_1(1.0)":
          { id: "DF_SDG_2_1_1", name: "undernourishment" },
      },
    });
    expect(body.data?.dataflows).toHaveLength(1);
    expect(body.data?.dataflows?.[0]?.id).toBe("DF_SDG_2_1_1");
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
