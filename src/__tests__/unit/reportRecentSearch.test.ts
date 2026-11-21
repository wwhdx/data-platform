import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAlexConnector } from "../../connectors/openalex";
import { CrossRefConnector } from "../../connectors/crossref";
import { PubMedConnector } from "../../connectors/pubmed";
import { ArxivOaiConnector } from "../../connectors/arxivOai";
import { ClinicalTrialsConnector } from "../../connectors/clinicaltrials";
import { YouTubeConnector } from "../../connectors/youtube";
import { collectSample } from "../../report/samples";
import { reportItem } from "../fixtures/reportFixture";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("report provider recent-search contracts", () => {
  it.each([
    [() => new OpenAlexConnector(), { results: [] }, { sort: "publication_date:desc", filter: "from_publication_date:2026-11-01,to_publication_date:2026-11-20" }],
    [() => new CrossRefConnector(), { message: { items: [] } }, { sort: "published", order: "desc", filter: "from-pub-date:2026-11-01,until-pub-date:2026-11-20" }],
    [() => new PubMedConnector(), { esearchresult: { idlist: [] } }, { sort: "pub_date", datetype: "pdat", mindate: "2026/11/01", maxdate: "2026/11/20" }],
    [() => new ClinicalTrialsConnector(), { studies: [] }, { sort: "LastUpdatePostDate:desc", "filter.advanced": "AREA[LastUpdatePostDate]RANGE[2026-11-01,MAX]" }],
    [() => new YouTubeConnector({ apiKey: "fixture" }), { items: [] }, { order: "date", publishedAfter: "2026-11-01T00:00:00Z", publishedBefore: "2026-11-20T23:59:59Z" }],
  ] as const)("passes provider-specific ordering and date filters %#", async (factory, body, parameters) => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetch);
    await factory().search("test", { maxResults: 3, sortBy: "recent", filters: { dateFrom: "2026-11-01", dateTo: "2026-11-20" } });
    const url = new URL(fetch.mock.calls[0][0]);
    for (const [key, value] of Object.entries(parameters)) expect(url.searchParams.get(key)).toBe(value);
  });

  it("keeps the arXiv query and bounds the submission-date window", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "<feed></feed>" });
    vi.stubGlobal("fetch", fetch);
    await new ArxivOaiConnector().search("machine learning", { sortBy: "recent", filters: { dateFrom: "2026-11-01", dateTo: "2026-11-20" } });
    const params = new URL(fetch.mock.calls[0][0]).searchParams;
    expect(params.get("sortOrder")).toBe("descending");
    expect(params.get("search_query")).toBe("(all:machine learning) AND submittedDate:[202611010000 TO 202611202359]");
  });

  it("falls back to an explicitly historical window without treating it as recent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T04:30:00Z"));
    const connector = new OpenAlexConnector();
    const search = vi.spyOn(connector, "search").mockResolvedValueOnce([]).mockResolvedValueOnce([{
      ...reportItem("Old", "1982-01-01"), url: "https://example.test/old", snippet: "", sourceId: "openalex",
      sourceName: "OpenAlex", score: 1, license: "CC0", commercialUse: true,
    }]);
    const result = await collectSample(connector, "paper", "ai");
    expect(search.mock.calls[0][1]?.filters?.dateFrom).toBe("2026-10-21");
    expect(search.mock.calls[1][1]?.filters?.dateFrom).toBeUndefined();
    expect(result.selection?.mode).toBe("historical");
    expect(result.selection?.limit).toBe(3);
  });
});
