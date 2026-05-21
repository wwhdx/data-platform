import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EurostatConnector } from "../../connectors/eurostat";
import {
  mapJsonStatToDocuments,
  type JsonStatDataset,
} from "../../connectors/eurostatHelpers";

const SAMPLE_DATASET: JsonStatDataset = {
  label: "Gross domestic product (GDP)",
  value: { "0": 17256923.3 },
  id: ["freq", "unit", "na_item", "geo", "time"],
  size: [1, 1, 1, 1, 1],
  dimension: {
    freq: {
      label: "Time frequency",
      category: { index: { A: 0 }, label: { A: "Annual" } },
    },
    unit: {
      label: "Unit of measure",
      category: {
        index: { CP_MEUR: 0 },
        label: { CP_MEUR: "Current prices, million euro" },
      },
    },
    na_item: {
      label: "National accounts indicator",
      category: { index: { B1GQ: 0 }, label: { B1GQ: "GDP" } },
    },
    geo: {
      label: "Geo",
      category: {
        index: { EU27_2020: 0 },
        label: { EU27_2020: "European Union - 27 countries" },
      },
    },
    time: {
      label: "Time",
      category: { index: { "2023": 0 }, label: { "2023": "2023" } },
    },
  },
};

describe("eurostatHelpers", () => {
  it("mapJsonStatToDocuments 解析 JSON-stat 观测值", () => {
    const docs = mapJsonStatToDocuments("nama_10_gdp", SAMPLE_DATASET);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toContain("nama_10_gdp");
    expect(docs[0]?.rawJson.value).toBe(17256923.3);
    expect(docs[0]?.rawJson.type).toBe("macro_indicator");
    const url = String(docs[0]?.rawJson.url);
    expect(url).toContain("statistics/1.0/data/nama_10_gdp");
    expect(url).toContain("geo=EU27_2020");
    expect(url).toContain("time=2023");
  });
});

describe("EurostatConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 在 error: [] 时仍解析（非空数组才算失败）", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: [], ...SAMPLE_DATASET }),
    } as Response);

    const c = new EurostatConnector({});
    const docs = [];
    for await (const d of c.collect({ maxItems: 1, query: "gdp" })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
  });

  it("collect 解析 GDP 序列", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => SAMPLE_DATASET,
    } as Response);

    const c = new EurostatConnector({});
    const docs = [];
    for await (const d of c.collect({ maxItems: 1, query: "gdp" })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.sourceId).toBe("eurostat");
    expect(docs[0]?.fetchProvenance?.documentRequest?.url).toContain(
      "nama_10_gdp",
    );
  });

  it("search 按 query 过滤核心序列", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => SAMPLE_DATASET,
    } as Response);

    const c = new EurostatConnector({});
    const results = await c.search("gdp", { maxResults: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.sourceId).toBe("eurostat");
  });
});
