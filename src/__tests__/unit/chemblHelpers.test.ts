import { describe, it, expect } from "vitest";
import {
  buildChemblAbstract,
  mapChemblToRawJson,
  pickChemblTitle,
} from "../../connectors/chemblHelpers";

describe("chemblHelpers", () => {
  it("mapChemblToRawJson 含 title 与 abstract", () => {
    const raw = mapChemblToRawJson({
      molecule_chembl_id: "CHEMBL25",
      pref_name: "Aspirin",
      max_phase: 4,
      molecule_structures: { canonical_smiles: "CC(=O)Oc1ccccc1C(=O)O" },
    });
    expect(pickChemblTitle({ pref_name: "Aspirin" })).toBe("Aspirin");
    expect(String(raw.title)).toBe("Aspirin");
    expect(String(raw.abstract)).toContain("SMILES");
    expect(raw.type).toBe("molecule");
  });

  it("buildChemblAbstract 拼接属性", () => {
    const abs = buildChemblAbstract({
      molecule_type: "Small molecule",
      max_phase: 4,
    });
    expect(abs).toContain("Small molecule");
    expect(abs).toContain("phase: 4");
  });
});
