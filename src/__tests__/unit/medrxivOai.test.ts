import { describe, it, expect, vi, afterEach } from "vitest";
import { MedrxivOaiConnector } from "../../connectors/medrxivOai";

const DETAILS_PAGE = {
  messages: [
    {
      status: "ok",
      cursor: 0,
      total: 1,
      interval: "2024-01-01:2024-01-02",
    },
  ],
  collection: [
    {
      title: "medRxiv Collect Test",
      authors: "Author, A.",
      doi: "10.1101/2024.01.01.000002",
      date: "2024-01-01",
      version: "1",
      abstract: "Abstract for medRxiv collect test.",
      license: "cc_by",
      category: "epidemiology",
      server: "medRxiv",
    },
  ],
};

const DOI_PAGE = {
  collection: [
    {
      title: "medRxiv DOI Hit",
      authors: "Author, C.",
      doi: "10.1101/2024.01.01.000199",
      date: "2024-01-02",
      version: "1",
      abstract: "Single medRxiv DOI abstract.",
      license: "cc_by",
      server: "medRxiv",
    },
  ],
};

describe("MedrxivOaiConnector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search by DOI uses medrxiv details endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => DOI_PAGE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new MedrxivOaiConnector();
    const results = await c.search("10.1101/2024.01.01.000199", {
      maxResults: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "medRxiv DOI Hit",
      sourceId: "medrxiv_oai",
      url: "https://www.medrxiv.org/content/10.1101/2024.01.01.000199v1",
    });
    expect(fetchMock.mock.calls[0]![0]).toContain(
      "/details/medrxiv/10.1101%2F2024.01.01.000199/na/json",
    );
  });

  it("collect yields abstract, medrxiv canonical URL, and provenance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => DETAILS_PAGE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new MedrxivOaiConnector();
    const docs = [];
    for await (const doc of c.collect({ since: "2024-01-01", maxItems: 1 })) {
      docs.push(doc);
    }

    expect(docs).toHaveLength(1);
    expect(docs[0]!.sourceId).toBe("medrxiv_oai");
    expect(docs[0]!.rawJson).toMatchObject({
      title: "medRxiv Collect Test",
      abstract: "Abstract for medRxiv collect test.",
      doi: "10.1101/2024.01.01.000002",
      server: "medRxiv",
      url: "https://www.medrxiv.org/content/10.1101/2024.01.01.000002v1",
    });
    expect(docs[0]!.fetchProvenance?.canonicalUrl).toContain(
      "www.medrxiv.org/content/10.1101/2024.01.01.000002",
    );
    expect(fetchMock.mock.calls[0]![0]).toContain(
      "api.biorxiv.org/details/medrxiv/2024-01-01",
    );
  });
});
