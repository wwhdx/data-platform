import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SemanticScholarConnector,
  SEMANTIC_SCHOLAR_META,
} from "../../connectors/semanticscholar";

describe("SemanticScholarConnector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collect attaches provenance with batch and document requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        total: 1,
        data: [
          {
            paperId: "abc123",
            title: "Test Paper",
            abstract: "Test abstract.",
            url: "https://www.semanticscholar.org/paper/abc123",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new SemanticScholarConnector({ apiKey: "s2-key" });
    const docs = [];
    for await (const doc of c.collect({ query: "ml", maxItems: 1, since: "2024-01-01" })) {
      docs.push(doc);
    }

    expect(docs).toHaveLength(1);
    expect(docs[0]?.sourceId).toBe(SEMANTIC_SCHOLAR_META.id);
    expect(docs[0]?.fetchProvenance?.documentRequest?.url).toContain("/paper/abc123");
    expect(docs[0]?.fetchProvenance?.batchRequest?.url).toContain("/paper/search");
    expect(docs[0]?.fetchProvenance?.canonicalUrl).toContain("semanticscholar.org");
  });
});
