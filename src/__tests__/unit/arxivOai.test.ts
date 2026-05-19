import { describe, it, expect, vi, afterEach } from "vitest";
import { ArxivOaiConnector } from "../../connectors/arxivOai";

const OAI_PAGE = `<?xml version="1.0"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2401.00001</identifier><datestamp>2024-01-02</datestamp></header>
      <metadata>
        <arXiv xmlns="http://arxiv.org/OAI/arXiv/">
          <id>2401.00001</id>
          <title>Collect Test Paper</title>
          <abstract>Abstract for OAI collect test.</abstract>
          <created>2024-01-01</created>
          <authors><author><name>Test Author</name></author></authors>
          <categories>cs.LG</categories>
        </arXiv>
      </metadata>
    </record>
  </ListRecords>
</OAI-PMH>`;

const ATOM_PAGE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00099v1</id>
    <title>Search Hit</title>
    <summary>Atom summary for search.</summary>
    <published>2024-02-01T00:00:00Z</published>
  </entry>
</feed>`;

describe("ArxivOaiConnector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search uses Legacy Atom API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => ATOM_PAGE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new ArxivOaiConnector();
    const results = await c.search("transformer", { maxResults: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Search Hit",
      sourceId: "arxiv_oai",
      url: "https://arxiv.org/abs/2401.00099v1",
    });
    expect(fetchMock.mock.calls[0]![0]).toContain("export.arxiv.org/api/query");
    expect(fetchMock.mock.calls[0]![0]).toContain("search_query=all%3Atransformer");
  });

  it("collect yields abstract and provenance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => OAI_PAGE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new ArxivOaiConnector();
    const docs = [];
    for await (const doc of c.collect({ since: "2024-01-01", maxItems: 1 })) {
      docs.push(doc);
    }

    expect(docs).toHaveLength(1);
    expect(docs[0]!.rawJson).toMatchObject({
      title: "Collect Test Paper",
      abstract: "Abstract for OAI collect test.",
      arxiv_id: "2401.00001",
      publication_date: "2024-01-01",
    });
    expect(docs[0]!.fetchProvenance?.canonicalUrl).toBe(
      "https://arxiv.org/abs/2401.00001",
    );
    expect(docs[0]!.fetchProvenance?.batchRequest?.curl).toContain("curl");
    expect(fetchMock.mock.calls[0]![0]).toContain("verb=ListRecords");
    expect(fetchMock.mock.calls[0]![0]).toContain("metadataPrefix=arXiv");
  });
});
