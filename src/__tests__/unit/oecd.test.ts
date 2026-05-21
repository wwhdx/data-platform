import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OecdConnector } from "../../connectors/oecd";
import {
  mapSdmxJsonToDocuments,
  type SdmxJsonResponse,
} from "../../connectors/oecdHelpers";

const SAMPLE_RESPONSE: SdmxJsonResponse = {
  data: {
    structures: [
      {
        name: "Key short-term economic indicators",
        dimensions: {
          observation: [
            {
              id: "REF_AREA",
              values: [{ id: "OECD", name: "OECD - Total" }],
            },
            { id: "FREQ", values: [{ id: "A", name: "Annual" }] },
            {
              id: "MEASURE",
              values: [{ id: "B1GQ_Q", name: "Gross domestic product, volume" }],
            },
            {
              id: "UNIT_MEASURE",
              values: [{ id: "GR", name: "Growth rate" }],
            },
            { id: "ACTIVITY", values: [{ id: "_T", name: "Total" }] },
            { id: "ADJUSTMENT", values: [{ id: "Y", name: "Calendar adjusted" }] },
            {
              id: "TRANSFORMATION",
              values: [{ id: "GY", name: "Annual growth/change" }],
            },
            { id: "TIME_PERIOD", values: [{ id: "2023", name: "2023" }] },
          ],
        },
      },
    ],
    dataSets: [{ observations: { "0:0:0:0:0:0:0:0": [1.73, 0, 0, 0, null] } }],
  },
};

describe("oecdHelpers", () => {
  it("mapSdmxJsonToDocuments 解析 SDMX-JSON 观测值", () => {
    const query = {
      agency: "OECD.SDD.STES",
      flowId: "DSD_KEI@DF_KEI",
      title: "GDP growth OECD",
      key: "OECD.A.B1GQ_Q.GR._T.Y.GY",
    };
    const docs = mapSdmxJsonToDocuments(
      query,
      SAMPLE_RESPONSE,
      "https://sdmx.oecd.org/public/rest/",
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toContain("dsd_kei_df_kei");
    expect(docs[0]?.rawJson.value).toBe(1.73);
    expect(docs[0]?.rawJson.type).toBe("macro_indicator");
    expect(String(docs[0]?.rawJson.url)).toContain("DSD_KEI@DF_KEI");
  });
});

describe("OecdConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 解析 GDP 序列", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => SAMPLE_RESPONSE,
    } as Response);

    const c = new OecdConnector({});
    const docs = [];
    for await (const d of c.collect({ maxItems: 1, query: "gdp" })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.sourceId).toBe("oecd");
    expect(docs[0]?.fetchProvenance?.documentRequest?.url).toContain(
      "B1GQ_Q",
    );
  });

  it("search 按 query 过滤核心序列", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_RESPONSE,
    } as Response);

    const c = new OecdConnector({});
    const results = await c.search("unemployment", { maxResults: 5 });
    expect(results.length).toBe(1);
    expect(results[0]?.sourceId).toBe("oecd");
  });
});
