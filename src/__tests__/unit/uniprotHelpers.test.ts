import { describe, it, expect } from "vitest";
import {
  mapUniprotToRawJson,
  parseUniprotNextUrl,
  pickUniprotTitle,
  buildUniprotAbstract,
  buildUniprotSearchUrl,
  UNIPROT_SEARCH_FIELDS,
} from "../../connectors/uniprotHelpers";

describe("uniprotHelpers", () => {
  const sample = {
    primaryAccession: "P01308",
    uniProtkbId: "INS_HUMAN",
    organism: { scientificName: "Homo sapiens", commonName: "Human" },
    proteinDescription: {
      recommendedName: { fullName: { value: "Insulin" } },
    },
    genes: [{ geneName: { value: "INS" } }],
    comments: [
      {
        commentType: "FUNCTION",
        texts: [{ value: "Regulates blood glucose." }],
      },
    ],
    sequence: { length: 110 },
    proteinExistence: "1: Evidence at protein level",
  };

  it("mapUniprotToRawJson 含蛋白字段", () => {
    const { externalId, rawJson } = mapUniprotToRawJson(sample);
    expect(externalId).toBe("P01308");
    expect(pickUniprotTitle(sample)).toBe("Insulin");
    expect(String(rawJson.abstract)).toContain("Regulates blood glucose");
    expect(rawJson.type).toBe("protein");
    expect(rawJson.gene).toBe("INS");
  });

  it("buildUniprotAbstract 拼接 organism 与 function", () => {
    const abstract = buildUniprotAbstract(sample);
    expect(abstract).toContain("Homo sapiens");
    expect(abstract).toContain("Gene: INS");
  });

  it("parseUniprotNextUrl 解析 Link rel=next", () => {
    const link =
      '<https://rest.uniprot.org/uniprotkb/search?cursor=abc&size=2>; rel="next"';
    expect(parseUniprotNextUrl(link)).toContain("cursor=abc");
    expect(parseUniprotNextUrl(null)).toBeUndefined();
  });

  it("buildUniprotSearchUrl 含合法 fields", () => {
    const url = buildUniprotSearchUrl("https://rest.uniprot.org/", "insulin", 1);
    const fields = UNIPROT_SEARCH_FIELDS.split(",");
    expect(fields).toContain("protein_existence");
    expect(fields).not.toContain("existence");
    expect(url).toContain("protein_existence");
  });
});
