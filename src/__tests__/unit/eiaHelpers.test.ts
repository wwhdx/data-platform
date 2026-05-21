import { describe, it, expect } from "vitest";
import {
  buildEiaExternalId,
  mapEiaRowToRawJson,
  eiaRowMatchesQuery,
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
    });
    expect(externalId).toMatch(/^eia\//);
    expect(externalId).toContain("2024-01-01");
    expect(rawJson.type).toBe("energy_indicator");
    expect(rawJson.top_level).toBe("petroleum");
    expect(rawJson.energy_subsector).toBe("petroleum");
    expect(rawJson.facet_signature).toBe("_default");
  });

  it("eiaRowMatchesQuery 过滤产品名", () => {
    const row = { "product-name": "Crude Oil WTI" };
    expect(eiaRowMatchesQuery(row, "crude")).toBe(true);
    expect(eiaRowMatchesQuery(row, "solar")).toBe(false);
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
});
