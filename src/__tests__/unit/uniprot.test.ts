import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UniprotConnector } from "../../connectors/uniprot";
import { UNIPROT_SEARCH_FIELDS } from "../../connectors/uniprotHelpers";

describe("UniprotConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 按 query 拉取蛋白条目", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        results: [
          {
            primaryAccession: "P01308",
            uniProtkbId: "INS_HUMAN",
            organism: { scientificName: "Homo sapiens" },
            proteinDescription: {
              recommendedName: { fullName: { value: "Insulin" } },
            },
            genes: [{ geneName: { value: "INS" } }],
            comments: [
              {
                commentType: "FUNCTION",
                texts: [{ value: "Glucose regulation" }],
              },
            ],
            sequence: { length: 110 },
          },
        ],
      }),
    } as Response);

    const c = new UniprotConnector({});
    const docs = [];
    for await (const d of c.collect({ query: "insulin", maxItems: 1 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toBe("P01308");
    expect(String(docs[0]?.rawJson.abstract)).toContain("Glucose regulation");
    expect(docs[0]?.fetchProvenance?.canonicalUrl).toContain("P01308");

    const url = String(vi.mocked(global.fetch).mock.calls[0]?.[0]);
    expect(url).toContain("protein_existence");
    expect(UNIPROT_SEARCH_FIELDS.split(",")).not.toContain("existence");
  });

  it("collect 遇 HTTP 400 抛错而非静默空结果", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () =>
        '{"messages":["Invalid fields parameter value \'existence\'"]}',
    } as Response);

    const c = new UniprotConnector({});
    await expect(async () => {
      for await (const _ of c.collect({ query: "insulin", maxItems: 1 })) {
        /* drain */
      }
    }).rejects.toThrow(/UniProt HTTP 400/);
  });
});
