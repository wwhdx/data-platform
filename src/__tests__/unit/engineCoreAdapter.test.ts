import { describe, it, expect, vi, afterEach } from "vitest";
import { createDataPlatformSearchProvider } from "../../adapters/engineCore";

describe("unit/adapters: engineCore SearchProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search 请求体应透传 industry 与 industryStrict", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createDataPlatformSearchProvider("http://test.local:3400");
    await provider.search("光伏 AI", {
      maxResults: 8,
      industry: "能源",
      industryStrict: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local:3400/api/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "光伏 AI",
          maxResults: 8,
          industry: "能源",
          industryStrict: true,
        }),
      }),
    );
  });

  it("industryStrict 未显式 true 时不写入请求体", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createDataPlatformSearchProvider("http://test.local:3400");
    await provider.search("query", { industry: "医疗" });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body).toEqual({ query: "query", industry: "医疗" });
    expect(body).not.toHaveProperty("industryStrict");
  });

  it("domainSignal 应原样透传至 SearchProviderResult", async () => {
    const domainSignal = {
      citationCount: 12,
      trendScore: 72,
      recentDocCount: 8,
      industryTag: "能源",
      trlHint: "pilot",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: "光伏 AI 应用",
              url: "https://example.com/a",
              snippet: "snippet",
              domainSignal,
            },
          ],
        }),
      }),
    );

    const provider = createDataPlatformSearchProvider("http://test.local:3400");
    const results = await provider.search("光伏");

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "光伏 AI 应用",
      url: "https://example.com/a",
      snippet: "snippet",
      domainSignal,
    });
    expect(results[0]!.domainSignal).toBe(domainSignal);
  });
});
