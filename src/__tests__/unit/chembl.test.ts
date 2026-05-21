import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChemblConnector } from "../../connectors/chembl";

describe("ChemblConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 解析分子搜索结果", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        molecules: [
          {
            molecule_chembl_id: "CHEMBL25",
            pref_name: "Aspirin",
            max_phase: 4,
          },
        ],
        page_meta: { total_count: 1, limit: 50, offset: 0 },
      }),
    } as Response);

    const c = new ChemblConnector({});
    const docs = [];
    for await (const d of c.collect({ query: "aspirin", maxItems: 2 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toBe("CHEMBL25");
    expect(docs[0]?.rawJson.title).toBe("Aspirin");
    expect(docs[0]?.fetchProvenance?.canonicalUrl).toContain("CHEMBL25");
  });
});
