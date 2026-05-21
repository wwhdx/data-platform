import { describe, it, expect } from "vitest";
import {
  looksLikeFormula,
  mapMpToRawJson,
  pickMpTitle,
} from "../../connectors/materialsProjectHelpers";

describe("materialsProjectHelpers", () => {
  it("looksLikeFormula 识别化学式", () => {
    expect(looksLikeFormula("Fe2O3")).toBe(true);
    expect(looksLikeFormula("lithium battery")).toBe(false);
  });

  it("mapMpToRawJson 含材料属性", () => {
    const raw = mapMpToRawJson({
      material_id: "mp-149",
      formula_pretty: "Si",
      band_gap: 1.1,
      is_stable: true,
    });
    expect(pickMpTitle({ formula_pretty: "Si", material_id: "mp-149" })).toBe(
      "Si (mp-149)",
    );
    expect(String(raw.abstract)).toContain("Band gap");
    expect(raw.type).toBe("material");
  });
});
