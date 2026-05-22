import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchOecdDataflowList } from "../../connectors/oecd/catalogFetch";

describe("oecd catalogFetch", () => {
  const origInterval = process.env.OECD_CATALOG_AGENCY_INTERVAL_MS;
  const origMode = process.env.OECD_CATALOG_FETCH_MODE;

  beforeEach(() => {
    process.env.OECD_CATALOG_AGENCY_INTERVAL_MS = "500";
    process.env.OECD_CATALOG_FETCH_MODE = "agency";
  });

  afterEach(() => {
    if (origInterval === undefined) {
      delete process.env.OECD_CATALOG_AGENCY_INTERVAL_MS;
    } else {
      process.env.OECD_CATALOG_AGENCY_INTERVAL_MS = origInterval;
    }
    if (origMode === undefined) {
      delete process.env.OECD_CATALOG_FETCH_MODE;
    } else {
      process.env.OECD_CATALOG_FETCH_MODE = origMode;
    }
  });

  it("全量 500 后按 agency 分批合并（XML）", async () => {
    const fullBody = JSON.stringify({
      data: { dataflows: [{ id: "DF_X", agencyID: "ESTAT", name: "x" }] },
    });
    const agencyXml = `<?xml version="1.0"?><message:Structure xmlns:structure="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure" xmlns:common="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common">
      <structure:Dataflow id="DSD_KEI@DF_KEI" agencyID="OECD.SDD.STES"><common:Name>KEI</common:Name></structure:Dataflow>
    </message:Structure>`;

    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("/dataflow?references=none")) {
        return new Response("error", { status: 500 });
      }
      if (url.includes("/dataflow/OECD.SDD.STES")) {
        return new Response(agencyXml, { status: 200 });
      }
      if (url.includes("/dataflow/ESTAT")) {
        return new Response(fullBody, { status: 200 });
      }
      return new Response(JSON.stringify({ data: { dataflows: [] } }), {
        status: 200,
      });
    });

    const body = await fetchOecdDataflowList(fetchFn);
    const ids = (body.data?.dataflows ?? []).map((d) => `${d.agencyID},${d.id}`);
    expect(ids).toContain("OECD.SDD.STES,DSD_KEI@DF_KEI");
    expect(ids).toContain("ESTAT,DF_X");
  });
});
