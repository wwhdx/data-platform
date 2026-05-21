import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapFredSeriesToRawJson } from "../../connectors/fredHelpers";
import { FredConnector } from "../../connectors/fred";

describe("fred helpers", () => {
  it("mapFredSeriesToRawJson 含最新观测", () => {
    const { rawJson } = mapFredSeriesToRawJson(
      { id: "GDP", title: "Gross Domestic Product", units: "Billions" },
      { date: "2024-01-01", value: "100" },
      "Billions",
    );
    expect(String(rawJson.abstract)).toContain("100");
    expect(rawJson.type).toBe("economic_indicator");
  });
});

describe("FredConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 缺 Key 时抛错", async () => {
    const c = new FredConnector({});
    await expect(async () => {
      for await (const _ of c.collect({ maxItems: 1 })) {
        /* empty */
      }
    }).rejects.toThrow(/FRED_API_KEY/);
  });

  it("collect YAML Tier A 序列", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          seriess: [{ id: "GDP", title: "Gross Domestic Product", notes: "US GDP" }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          units: "Billions",
          observations: [{ date: "2024-01-01", value: "100" }],
        }),
      } as Response);

    const c = new FredConnector({
      apiKey: "fred-test-key",
      sourceOptions: { fred_series_file: "config/fred-series.yml", fred_tier_filter: "A" },
    });
    const docs = [];
    for await (const d of c.collect({ maxItems: 1 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toBe("GDP");
    expect(docs[0]?.rawJson.collect_tier).toBe("A");
  });
});
