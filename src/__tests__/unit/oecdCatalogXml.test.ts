import { describe, it, expect } from "vitest";
import { parseDataflowXml } from "../../connectors/oecd/catalogXmlParse";

const SNIPPET = `<?xml version="1.0" encoding="utf-8"?>
<message:Structure xmlns:structure="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure" xmlns:common="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common">
  <message:Structures>
    <structure:Dataflows>
      <structure:Dataflow id="DSD_KEI@DF_KEI" agencyID="OECD.SDD.STES" version="4.0" isFinal="true">
        <common:Name xml:lang="en">Key short-term economic indicators</common:Name>
      </structure:Dataflow>
      <structure:Dataflow id="DSD_AEA@DF_AEA" agencyID="OECD.SDD.NAD.SEEA" isFinal="true">
        <common:Name xml:lang="en">Air Emissions Accounts</common:Name>
        <common:Description xml:lang="en">AEA desc</common:Description>
      </structure:Dataflow>
    </structure:Dataflows>
  </message:Structures>
</message:Structure>`;

describe("oecd catalogXmlParse", () => {
  it("parseDataflowXml 提取 id/agency/name", () => {
    const body = parseDataflowXml(SNIPPET);
    expect(body.data?.dataflows).toHaveLength(2);
    const kei = body.data!.dataflows!.find((d) => d.id === "DSD_KEI@DF_KEI");
    expect(kei?.agencyID).toBe("OECD.SDD.STES");
    expect(kei?.name).toContain("Key short-term");
    const aea = body.data!.dataflows!.find((d) => d.id === "DSD_AEA@DF_AEA");
    expect(aea?.description).toBe("AEA desc");
  });
});
