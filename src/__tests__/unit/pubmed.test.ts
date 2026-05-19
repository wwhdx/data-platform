import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildEntrezCollectTerm,
  normalizeEntrezBaseUrl,
  parseEsummaryRecord,
} from "../../connectors/pubmedHelpers";
import { PubMedConnector } from "../../connectors/pubmed";
import { setExpandedSources } from "../../config/runtime";

describe("pubmedHelpers", () => {
  it("normalizeEntrezBaseUrl adds trailing slash", () => {
    expect(normalizeEntrezBaseUrl("https://eutils.ncbi.nlm.nih.gov/entrez/eutils"))
      .toBe("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/");
  });

  it("buildEntrezCollectTerm includes edat range", () => {
    const term = buildEntrezCollectTerm({
      since: "2026-05-01",
      query: "cancer",
    });
    expect(term).toContain("cancer");
    expect(term).toContain("[edat]");
  });

  it("parseEsummaryRecord maps title and uid", () => {
    const rec = parseEsummaryRecord("123", {
      uid: "123",
      title: "Test Article",
      pubdate: "2026 Jan",
      source: "Nature",
      authors: [{ name: "Smith J" }],
    });
    expect(rec?.uid).toBe("123");
    expect(rec?.title).toBe("Test Article");
    expect(rec?.snippet).toContain("Smith J");
  });
});

describe("PubMedConnector", () => {
  beforeEach(() => {
    setExpandedSources([
      {
        id: "pubmed",
        name: "PubMed",
        enabled: false,
        base_url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
        auth_type: "query_param_key",
        rate_limit: "10/sec",
        license: "public domain",
        commercial_use: true,
        schedule: "0 10 * * *",
        profile: "ncbi_eutils",
        options: { entrez_db: "pubmed" },
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses entrez_db from sourceOptions", () => {
    const c = new PubMedConnector({
      baseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
      sourceOptions: { entrez_db: "pubmed" },
    });
    expect((c as unknown as { entrezDb: string }).entrezDb).toBe("pubmed");
  });

  it("search calls esearch and esummary", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          esearchresult: { idlist: ["1"], count: "1" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            uids: ["1"],
            "1": {
              uid: "1",
              title: "Paper",
              pubdate: "2026",
              source: "J",
              authors: [],
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const c = new PubMedConnector({
      baseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
      sourceOptions: { entrez_db: "pubmed" },
    });
    const results = await c.search("asthma", { maxResults: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Paper");
    expect(fetchMock.mock.calls[0]![0]).toContain("esearch.fcgi");
    expect(fetchMock.mock.calls[0]![0]).toContain("db=pubmed");
  });
});
