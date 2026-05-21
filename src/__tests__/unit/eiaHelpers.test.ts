import { describe, it, expect } from "vitest";
import {
  buildEiaExternalId,
  mapEiaRowToRawJson,
  eiaRowMatchesQuery,
  extractEiaMetrics,
} from "../../connectors/eiaHelpers";

describe("eiaHelpers", () => {
  it("mapEiaRowToRawJson 映射 indicator 与 subsector", () => {
    const row = {
      period: "2024-01-01",
      value: "75.5",
      "product-name": "Crude Oil",
      "area-name": "U.S.",
      units: "$/bbl",
    };
    const { externalId, rawJson } = mapEiaRowToRawJson(row, "petroleum/pri/spt/data", {
      facetSignature: "_default",
      frequency: "daily",
      dataColumns: ["value"],
    });
    expect(externalId).toMatch(/^eia\//);
    expect(externalId).toContain("2024-01-01");
    expect(rawJson.type).toBe("energy_indicator");
    expect(rawJson.top_level).toBe("petroleum");
    expect(rawJson.energy_subsector).toBe("petroleum");
    expect(rawJson.facet_signature).toBe("_default");
    expect(rawJson.value).toBe("75.5");
    expect(rawJson.url).toContain("opendata/browser/petroleum/pri/spt");
  });

  it("mapEiaRowToRawJson 映射 retail-sales 多列与真实 API URL", () => {
    const fetchUrl =
      "https://api.eia.gov/v2/electricity/retail-sales/data?frequency=monthly&data%5B0%5D=price&data%5B1%5D=sales&facets%5Bstateid%5D%5B%5D=CA&facets%5Bsectorid%5D%5B%5D=COM&api_key=secret";
    const row = {
      period: "2025-09",
      stateid: "CA",
      stateDescription: "California",
      sectorid: "COM",
      sectorName: "commercial",
      price: "24.10",
      sales: "8200.5",
      "price-units": "cents per kilowatt-hour",
      "sales-units": "million kilowatt hours",
    };
    const { externalId, rawJson } = mapEiaRowToRawJson(
      row,
      "electricity/retail-sales/data",
      {
        facetSignature: "sectorid=COM|stateid=CA",
        frequency: "monthly",
        dataColumns: ["price", "sales"],
        fetchUrl,
      },
    );
    expect(externalId).toContain("CA-COM");
    expect(externalId).toContain("2025-09");
    expect(rawJson.title).toContain("California");
    expect(rawJson.title).toContain("commercial");
    expect(rawJson.metrics).toEqual({
      price: { value: "24.10", units: "cents per kilowatt-hour" },
      sales: { value: "8200.5", units: "million kilowatt hours" },
    });
    expect(rawJson.value).toBe("24.10");
    expect(rawJson.indicator_code).toBe("CA-COM");
    expect(String(rawJson.abstract)).toContain("price: 24.10");
    expect(String(rawJson.url)).toContain("retail-sales/data");
    expect(String(rawJson.url)).toContain("api_key=REDACTED");
    expect(String(rawJson.url)).not.toContain("secret");
  });

  it("eiaRowMatchesQuery 过滤产品名与州名", () => {
    const row = { "product-name": "Crude Oil WTI" };
    expect(eiaRowMatchesQuery(row, "crude")).toBe(true);
    expect(eiaRowMatchesQuery(row, "solar")).toBe(false);
    expect(eiaRowMatchesQuery({ stateDescription: "California" }, "california")).toBe(
      true,
    );
  });

  it("buildEiaExternalId 含 facet 与 series", () => {
    expect(
      buildEiaExternalId(
        { period: "2024-01", duoarea: "NUS", product: "EPC0" },
        "petroleum/pri/spt/data",
        "sectorid=RES",
      ),
    ).toContain("sectorid=RES");
  });

  it("extractEiaMetrics 跳过空列", () => {
    expect(extractEiaMetrics({ period: "2025-01", price: "1.2" }, ["price", "sales"])).toEqual({
      price: { value: "1.2" },
    });
  });
});
