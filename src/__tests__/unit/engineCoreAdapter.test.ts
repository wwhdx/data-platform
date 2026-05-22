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
});
