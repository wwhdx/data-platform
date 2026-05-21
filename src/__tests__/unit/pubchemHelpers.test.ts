import { describe, it, expect } from "vitest";
import {
  mapPubchemToRawJson,
  parsePubchemCids,
  pickPubchemTitle,
} from "../../connectors/pubchemHelpers";

describe("pubchemHelpers", () => {
  it("parsePubchemCids 解析 CID 列表", () => {
    expect(parsePubchemCids({ IdentifierList: { CID: [2244, 702] } })).toEqual([
      2244, 702,
    ]);
  });

  it("mapPubchemToRawJson 含化合物字段", () => {
    const { externalId, rawJson } = mapPubchemToRawJson(
      {
        CID: 2244,
        Title: "Aspirin",
        MolecularFormula: "C9H8O4",
        MolecularWeight: 180.16,
      },
      "Pain reliever",
    );
    expect(externalId).toBe("CID2244");
    expect(pickPubchemTitle({ Title: "Aspirin" })).toBe("Aspirin");
    expect(String(rawJson.abstract)).toContain("Pain reliever");
    expect(rawJson.type).toBe("compound");
  });
});
