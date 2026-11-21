import { afterEach, describe, expect, it, vi } from "vitest";
import { HackerNewsConnector } from "../../connectors/hackernews";
import { GitHubConnector } from "../../connectors/github";
import { OpenAlexConnector } from "../../connectors/openalex";
import { SemanticScholarConnector } from "../../connectors/semanticscholar";
import { OpenCitationsConnector } from "../../connectors/opencitations";
import { YouTubeConnector } from "../../connectors/youtube";
import { collectSample } from "../../report/samples";
import { prepareReportSource } from "../../report/prepareSource";
import { sampleFingerprint } from "../../report/history";
import { reportItem, reportSource, REPORT_TIME } from "../fixtures/reportFixture";
import type { BaseConnector } from "../../connectors/base";
import type { ReportSampleKind } from "../../report/types";

afterEach(() => vi.unstubAllGlobals());
describe("search sample relation propagation", () => {
  it("retains the HN id through search, report normalization and article URL selection", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => new Response(JSON.stringify(
      String(input).includes("topstories") ? [123] : { id: 123, type: "story", title: "Probe post", url: "https://example.org/article" },
    ), { status: 200 })));
    const sample = await collectSample(new HackerNewsConnector(), "post", "probe", 1);
    const source = reportSource("hackernews", sample.items);
    source.sample.kind = "post";
    const prepared = prepareReportSource(source, undefined, "probe", REPORT_TIME);
    expect(prepared.sample.items[0].url).toBe("https://example.org/article");
    expect(prepared.sample.items[0].links?.[0].url).toBe("https://news.ycombinator.com/item?id=123");
  });
  const cases: Array<{ connector: BaseConnector; kind: ReportSampleKind; response: unknown; url: string }> = [
    { connector: new GitHubConnector(), kind: "repo", response: { items: [{ id: 1, full_name: "owner/repo", html_url: "https://github.com/owner/repo", description: "Repo" }] }, url: "https://github.com/owner/repo/stargazers" },
    { connector: new OpenAlexConnector(), kind: "paper", response: { results: [{ id: "https://openalex.org/W123", title: "Paper" }] }, url: "https://openalex.org/works/W123" },
    { connector: new SemanticScholarConnector(), kind: "paper", response: { data: [{ paperId: "paper123", title: "Paper" }] }, url: "https://www.semanticscholar.org/paper/paper123" },
    { connector: new OpenCitationsConnector(), kind: "paper", response: [{ oci: "edge", citing: "doi:10.1000/a", cited: "doi:10.1000/b" }], url: "https://doi.org/10.1000/a" },
    { connector: new YouTubeConnector({ apiKey: "test-key" }), kind: "video", response: { items: [{ id: { videoId: "video" }, snippet: { title: "Video" } }] }, url: "https://www.youtube.com/watch?v=video#comments" },
  ];
  it.each(cases)("keeps $kind source links when report sampling succeeds via search", async ({ connector, kind, response, url }) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })));
    const sample = await collectSample(connector, kind, "10.1000/a", 1);
    expect(sample.items[0]?.links?.some(link => link.url === url)).toBe(true);
  });
  it("observes changes in displayed comment excerpts and reference lists", () => {
    const item = { ...reportItem("Video"), comments: ["Original"] };
    expect(sampleFingerprint([item])).not.toBe(sampleFingerprint([{ ...item, comments: ["Changed"] }]));
    expect(sampleFingerprint([item])).not.toBe(sampleFingerprint([{ ...item,
      references: [{ kind: "reference", label: "Paper", url: "https://doi.org/10.1000/a" }] }]));
  });
});
