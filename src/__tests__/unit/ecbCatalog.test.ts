import { describe, it, expect, vi, beforeEach } from "vitest";
import { crawlEcbCatalog } from "../../connectors/ecb/catalogCrawl";
import { parseDataflowXml } from "../../connectors/sdmx/catalogXmlParse";

vi.mock("../../storage/models/ecbCatalog", () => ({
  upsertEcbCatalogDataflow: vi.fn().mockResolvedValue(undefined),
  applyYamlTiersToEcbCatalog: vi.fn().mockResolvedValue(undefined),
}));

const ECB_XML = `<?xml version='1.0' encoding='UTF-8'?>
<mes:Structure xmlns:str="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure"
 xmlns:com="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common"
 xmlns:mes="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message">
<mes:Structures><str:Dataflows>
<str:Dataflow agencyID="ECB" id="EXR" isFinal="true">
<com:Name xml:lang="en">Exchange Rates</com:Name>
</str:Dataflow>
<str:Dataflow agencyID="ECB" id="BSI" isFinal="true">
<com:Name xml:lang="en">Balance Sheet Items</com:Name>
</str:Dataflow>
</str:Dataflows></mes:Structures></mes:Structure>`;

describe("ecb catalogCrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parseDataflowXml 解析 ECB dataflow", () => {
    const body = parseDataflowXml(ECB_XML);
    expect(body.data?.dataflows).toHaveLength(2);
    expect(body.data?.dataflows?.[0]?.id).toBe("EXR");
  });

  it("crawlEcbCatalog 入库", async () => {
    const { upsertEcbCatalogDataflow } = await import(
      "../../storage/models/ecbCatalog"
    );
    const body = parseDataflowXml(ECB_XML);
    const result = await crawlEcbCatalog(body, [
      {
        flowId: "EXR",
        key: "D.USD.EUR.SP00.A",
        tier: "A",
        title: "USD/EUR",
      },
    ]);
    expect(result.dataflows).toBe(2);
    expect(upsertEcbCatalogDataflow).toHaveBeenCalled();
  });
});
