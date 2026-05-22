import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { crawlImfCatalog } from "../../connectors/imf/catalogCrawl";
import { parseDataflowList } from "../../connectors/sdmx/catalogTypes";

vi.mock("../../storage/models/imfCatalog", () => ({
  upsertImfCatalogDataflow: vi.fn().mockResolvedValue(undefined),
  applyYamlTiersToImfCatalog: vi.fn().mockResolvedValue(undefined),
}));

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../fixtures/imf-dataflows-snippet.json"),
    "utf-8",
  ),
);

describe("imf catalogCrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parseDataflowList 解析 IMF SDMX-JSON", () => {
    const rows = parseDataflowList(FIXTURE);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.agencyID).toBe("IMF.RES");
    expect(rows[0]?.id).toBe("WEO");
  });

  it("crawlImfCatalog 入库 dataflow", async () => {
    const { upsertImfCatalogDataflow } = await import(
      "../../storage/models/imfCatalog"
    );
    const result = await crawlImfCatalog(FIXTURE, [
      {
        agency: "IMF.RES",
        flowId: "WEO",
        key: "USA.NGDP_RPCH.A",
        tier: "A",
        title: "US GDP",
      },
    ]);
    expect(result.dataflows).toBe(2);
    expect(result.imfAgency).toBe(2);
    expect(upsertImfCatalogDataflow).toHaveBeenCalled();
  });
});
