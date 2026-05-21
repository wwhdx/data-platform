import { describe, it, expect, vi, afterEach } from "vitest";
import { CoreConnector } from "../../connectors/core";
import {
  buildCoreCollectQuery,
  buildCoreCollectSearchQuery,
  buildCoreSearchQuery,
  CORE_ATTRIBUTION,
  mapCoreOutputToRawJson,
  pickCoreAbstract,
  pickCoreTitle,
} from "../../connectors/coreHelpers";

const SEARCH_PAGE = {
  totalHits: 1,
  limit: 10,
  offset: 0,
  results: [
    {
      id: 80549003,
      title: "CORE Collect Test",
      abstract: "Abstract for CORE collect test.",
      doi: "10.1007/s002210100705",
      authors: ["Author, A."],
      published_date: "2020-06-01T00:00:00Z",
      license: "http://creativecommons.org/licenses/by/4.0/",
    },
  ],
};

const SINGLE_OUTPUT = {
  id: 999,
  title: "Single Output Hit",
  abstract: "Single output abstract.",
  doi: "10.5555/example",
};

describe("CoreConnector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search by numeric id uses GET /outputs/{id}", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SINGLE_OUTPUT,
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new CoreConnector({ apiKey: "test-key" });
    const results = await c.search("999", { maxResults: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Single Output Hit",
      sourceId: "core",
      url: "https://doi.org/10.5555/example",
    });
    expect(fetchMock.mock.calls[0]![0]).toContain("/outputs/999");
    expect(fetchMock.mock.calls[0]![1]?.headers?.Authorization).toBe(
      "bearer test-key",
    );
  });

  it("collect yields abstract, attribution and provenance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SEARCH_PAGE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const c = new CoreConnector({ apiKey: "test-key" });
    const docs = [];
    for await (const doc of c.collect({
      since: "2020-01-01",
      maxItems: 1,
      query: "neuroscience",
    })) {
      docs.push(doc);
    }

    expect(docs).toHaveLength(1);
    expect(docs[0]!.rawJson).toMatchObject({
      title: "CORE Collect Test",
      abstract: "Abstract for CORE collect test.",
      doi: "10.1007/s002210100705",
      core_attribution: CORE_ATTRIBUTION,
    });
    expect(docs[0]!.fetchProvenance?.canonicalUrl).toBe(
      "https://doi.org/10.1007/s002210100705",
    );
    expect(fetchMock.mock.calls[0]![0]).toContain("/search/outputs?");
    expect(fetchMock.mock.calls[0]![0]).toContain("yearPublished");
    expect(fetchMock.mock.calls[0]![0]).toContain("title%3A");
  });

  it("collect fails without CORE_API_KEY", async () => {
    const c = new CoreConnector();
    await expect(async () => {
      for await (const _ of c.collect({ maxItems: 1 })) {
        /* drain */
      }
    }).rejects.toThrow(/CORE_API_KEY/);
  });
});

describe("coreHelpers", () => {
  it("buildCoreSearchQuery wraps plain text as fullText", () => {
    expect(buildCoreSearchQuery("climate change")).toBe(
      'fullText:"climate change"',
    );
  });

  it("buildCoreSearchQuery preserves DOI field query", () => {
    expect(buildCoreSearchQuery("10.1007/s002210100705")).toBe(
      'doi:"10.1007/s002210100705"',
    );
  });

  it("buildCoreCollectQuery uses title + yearPublished filter", () => {
    expect(buildCoreCollectQuery("machine learning", "2024-01-01")).toBe(
      'title:"machine learning" AND yearPublished>=2024',
    );
  });

  it("buildCoreCollectSearchQuery uses title not fullText", () => {
    expect(buildCoreCollectSearchQuery("neural networks")).toBe(
      'title:"neural networks"',
    );
  });

  it("mapCoreOutputToRawJson preserves API attribution when present", () => {
    const raw = mapCoreOutputToRawJson({
      title: "T",
      abstract: "A",
      core_attribution: "Custom CORE attribution",
    });
    expect(raw.core_attribution).toBe("Custom CORE attribution");
    expect(pickCoreTitle({})).toBe("Untitled");
    expect(pickCoreAbstract({ full_text: "x".repeat(3000) }).length).toBe(2000);
  });
});
