import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  crawlOecdCatalog,
  parseDataflowList,
} from "../../connectors/oecd/catalogCrawl";

vi.mock("../../storage/models/oecdCatalog", () => ({
  upsertOecdCatalogDataflow: vi.fn().mockResolvedValue(undefined),
  applyYamlTiersToOecdCatalog: vi.fn().mockResolvedValue(undefined),
}));

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../fixtures/oecd-dataflows-snippet.json"),
    "utf-8",
  ),
);

describe("oecd catalogCrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parseDataflowList 解析 SDMX-JSON dataflows", () => {
    const rows = parseDataflowList(FIXTURE);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.agencyID).toBe("OECD.SDD.STES");
    expect(rows[0]?.id).toBe("DSD_KEI@DF_KEI");
  });

  it("crawlOecdCatalog 入库 dataflow 行", async () => {
    const { upsertOecdCatalogDataflow } = await import(
      "../../storage/models/oecdCatalog"
    );
    const result = await crawlOecdCatalog(FIXTURE, [
      {
        agency: "OECD.SDD.STES",
        flowId: "DSD_KEI@DF_KEI",
        key: "OECD.A.B1GQ_Q.GR._T.Y.GY",
        tier: "A",
        title: "GDP",
      },
      {
        agency: "OECD.SDD.NAD.SEEA",
        flowId: "DSD_AEA@DF_AEA",
        key: "OECD.A.EMISSIONS.T_CO2E.N.E.GHG.RES._Z.ESTIMATED",
        tier: "A",
        title: "GHG",
      },
    ]);
    expect(result.dataflows).toBe(3);
    expect(result.oecdAgency).toBe(2);
    expect(upsertOecdCatalogDataflow).toHaveBeenCalled();
  });
});
