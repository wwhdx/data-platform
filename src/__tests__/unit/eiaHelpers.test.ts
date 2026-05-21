import { describe, it, expect } from "vitest";
import {
  eiaExternalId,
  mapEiaRowToRawJson,
  eiaRowMatchesQuery,
} from "../../connectors/eiaHelpers";

describe("eiaHelpers", () => {
  it("mapEiaRowToRawJson 映射 indicator 字段", () => {
    const row = {
      period: "2024-01-01",
      value: "75.5",
      "product-name": "Crude Oil",
      "area-name": "U.S.",
      units: "$/bbl",
    };
    const { externalId, rawJson } = mapEiaRowToRawJson(row, "petroleum/pri/spt/data");
    expect(externalId).toContain("2024-01-01");
    expect(rawJson.type).toBe("energy_indicator");
    expect(rawJson.indicator_name).toBeTruthy();
    expect(rawJson.value).toBe("75.5");
  });

  it("eiaRowMatchesQuery 过滤产品名", () => {
    const row = { "product-name": "Crude Oil WTI" };
    expect(eiaRowMatchesQuery(row, "crude")).toBe(true);
    expect(eiaRowMatchesQuery(row, "solar")).toBe(false);
  });

  it("eiaExternalId 稳定", () => {
    expect(
      eiaExternalId(
        { period: "2024-01", duoarea: "NUS", product: "EPC0" },
        "route",
      ),
    ).toContain("2024-01");
  });
});
