import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PubchemConnector } from "../../connectors/pubchem";

describe("PubchemConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 按名称拉取 CID 与属性", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ IdentifierList: { CID: [2244] } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          PropertyTable: {
            Properties: [
              {
                CID: 2244,
                Title: "Aspirin",
                MolecularFormula: "C9H8O4",
              },
            ],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          InformationList: { Information: [{ Description: "Analgesic" }] },
        }),
      } as Response);

    const c = new PubchemConnector({});
    const docs = [];
    for await (const d of c.collect({ query: "aspirin", maxItems: 1 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toBe("CID2244");
    expect(String(docs[0]?.rawJson.abstract)).toContain("Analgesic");
  });
});
