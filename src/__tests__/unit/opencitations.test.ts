import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenCitationsConnector } from "../../connectors/opencitations";
import {
  buildOcApiPath,
  extractDoiFromPid,
  mapOcCitationToRawJson,
  opencitationsExternalId,
  parseOcCitationResponse,
} from "../../connectors/opencitationsHelpers";

const CITATION_ROWS = [
  {
    oci: "06101801781-06180334099",
    citing: "omid:br/06101801781 doi:10.7717/peerj-cs.421 pmid:33817056",
    cited: "omid:br/06180334099 doi:10.1108/jd-12-2013-0166",
    creation: "2021-03-10",
    timespan: "P6Y0M1D",
    journal_sc: "no",
    author_sc: "no",
  },
];

describe("OpenCitationsConnector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search by DOI fetches references", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => CITATION_ROWS,
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new OpenCitationsConnector();
    const results = await c.search("10.1108/jd-12-2013-0166", { maxResults: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sourceId: "opencitations",
      title: "Citation: 10.7717/peerj-cs.421 → 10.1108/jd-12-2013-0166",
    });
    expect(fetchMock.mock.calls[0]![0]).toContain("/references/doi%3A10.1108");
  });

  it("collect yields citation edge rawJson and provenance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => CITATION_ROWS,
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new OpenCitationsConnector({ apiKey: "oc-token" });
    const docs = [];
    for await (const doc of c.collect({
      query: "10.1108/jd-12-2013-0166",
      maxItems: 1,
    })) {
      docs.push(doc);
    }

    expect(docs).toHaveLength(1);
    expect(docs[0]!.externalId).toBe("06101801781-06180334099");
    expect(docs[0]!.rawJson).toMatchObject({
      graph_type: "citation_edge",
      citing_doi: "10.7717/peerj-cs.421",
      cited_doi: "10.1108/jd-12-2013-0166",
      oci: "06101801781-06180334099",
    });
    expect(docs[0]!.fetchProvenance?.canonicalUrl).toContain("doi.org");
    expect(fetchMock.mock.calls[0]![1]?.headers?.authorization).toBe("oc-token");
  });

  it("collect rejects non-DOI query without default", async () => {
    const c = new OpenCitationsConnector({
      sourceOptions: { default_collect_query: "" },
    });
    await expect(async () => {
      for await (const _ of c.collect({ query: "not-a-doi", maxItems: 1 })) {
        /* drain */
      }
    }).rejects.toThrow(/seed DOI/i);
  });
});

describe("opencitationsHelpers", () => {
  it("extractDoiFromPid parses doi from PID bundle", () => {
    expect(
      extractDoiFromPid("omid:br/06101801781 doi:10.7717/peerj-cs.421 pmid:33817056"),
    ).toBe("10.7717/peerj-cs.421");
  });

  it("opencitationsExternalId prefers oci", () => {
    expect(opencitationsExternalId(CITATION_ROWS[0]!)).toBe(
      "06101801781-06180334099",
    );
  });

  it("buildOcApiPath encodes doi pid", () => {
    expect(buildOcApiPath("references", "10.1038/nature12373")).toBe(
      "/references/doi%3A10.1038%2Fnature12373",
    );
  });

  it("parseOcCitationResponse filters invalid rows", () => {
    expect(parseOcCitationResponse(CITATION_ROWS)).toHaveLength(1);
    expect(parseOcCitationResponse([{ foo: "bar" }])).toHaveLength(0);
  });

  it("mapOcCitationToRawJson includes graph fields", () => {
    const raw = mapOcCitationToRawJson(
      CITATION_ROWS[0]!,
      "10.1108/jd-12-2013-0166",
      "references",
    );
    expect(raw.citation_mode).toBe("references");
    expect(raw.seed_doi).toBe("10.1108/jd-12-2013-0166");
  });
});
