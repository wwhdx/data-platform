import { describe, it, expect } from "vitest";
import { buildFacetSignature, planFacetRequests } from "../../connectors/eia/facetPlan";

describe("eia facetPlan", () => {
  it("buildFacetSignature 排序稳定", () => {
    expect(buildFacetSignature({ stateid: "CO", sectorid: "RES" })).toBe(
      "sectorid=RES|stateid=CO",
    );
    expect(buildFacetSignature({})).toBe("_default");
  });

  it("planFacetRequests 笛卡尔积带上限", () => {
    const plans = planFacetRequests(
      "electricity/retail-sales/data",
      {
        path: "electricity/retail-sales/data",
        tier: "A",
        facets: { sectorid: ["RES", "COM"], stateid: ["CA", "TX", "NY"] },
      },
      { defaultFrequency: "monthly", maxCombos: 4 },
    );
    expect(plans.length).toBe(4);
    expect(plans[0]?.facetSignature).toContain("sectorid=");
  });
});
