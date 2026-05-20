import { describe, it, expect, vi, afterEach } from "vitest";
import { BiorxivOaiConnector } from "../../connectors/biorxivOai";

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
      title: "OAI Collect Test",
      authors: "Author, A.",
      doi: "10.1101/2024.01.01.000001",
      date: "2024-01-01",
      version: "1",
      abstract: "Abstract for bioRxiv collect test.",
      license: "cc_by",
      category: "neuroscience",
      server: "bioRxiv",
    },
  ],
};

const DOI_PAGE = {
  collection: [
    {
      title: "DOI Lookup Hit",
      authors: "Author, B.",
      doi: "10.1101/2024.01.01.000099",
      date: "2024-01-02",
      version: "1",
      abstract: "Single DOI abstract.",
      license: "cc_by",
      server: "bioRxiv",
    },
  ],
};

describe("BiorxivOaiConnector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search by DOI uses single-paper endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => DOI_PAGE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new BiorxivOaiConnector();
    const results = await c.search("10.1101/2024.01.01.000099", {
      maxResults: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "DOI Lookup Hit",
      sourceId: "biorxiv_oai",
    });
    expect(fetchMock.mock.calls[0]![0]).toContain(
      "/details/biorxiv/10.1101%2F2024.01.01.000099/na/json",
    );
  });

  it("collect yields abstract and provenance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => DETAILS_PAGE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new BiorxivOaiConnector();
    const docs = [];
    for await (const doc of c.collect({ since: "2024-01-01", maxItems: 1 })) {
      docs.push(doc);
    }

    expect(docs).toHaveLength(1);
    expect(docs[0]!.rawJson).toMatchObject({
      title: "OAI Collect Test",
      abstract: "Abstract for bioRxiv collect test.",
      doi: "10.1101/2024.01.01.000001",
      publication_date: "2024-01-01",
    });
    expect(docs[0]!.fetchProvenance?.canonicalUrl).toContain(
      "10.1101/2024.01.01.000001",
    );
    expect(fetchMock.mock.calls[0]![0]).toContain(
      "api.biorxiv.org/details/biorxiv/2024-01-01",
    );
  });
});
