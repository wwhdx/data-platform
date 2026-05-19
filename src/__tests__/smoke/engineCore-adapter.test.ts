import { describe, it, expect, vi, afterEach } from "vitest";
import { createDataPlatformSearchProvider } from "../../adapters/engineCore";

describe("createDataPlatformSearchProvider (engine-core 契约)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POST /api/search 并映射 results 为 SearchProvider 形状", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "Attention Is All You Need",
            url: "https://openalex.org/W123",
            snippet: "We propose the Transformer…",
          },
        ],
        totalCount: 1,
        tookMs: 12,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createDataPlatformSearchProvider("http://test.local:3400");
    expect(provider.id).toBe("data-platform");

    const results = await provider.search("transformer", { maxResults: 5 });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local:3400/api/search",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "transformer", maxResults: 5 }),
      }),
    );
    expect(results).toEqual([
      {
        title: "Attention Is All You Need",
        url: "https://openalex.org/W123",
        snippet: "We propose the Transformer…",
      },
    ]);
  });

  it("HTTP 非 2xx 时返回空数组（降级）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    const provider = createDataPlatformSearchProvider("http://test.local:3400");
    const results = await provider.search("query");
    expect(results).toEqual([]);
  });

  it("网络失败时返回空数组（降级）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const provider = createDataPlatformSearchProvider("http://test.local:3400");
    const results = await provider.search("query");
    expect(results).toEqual([]);
  });

  it("opts.signal 已 abort 时返回空数组", async () => {
    const controller = new AbortController();
    controller.abort();

    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      }
      return Promise.resolve({ ok: true, json: async () => ({ results: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createDataPlatformSearchProvider("http://test.local:3400");
    const results = await provider.search("q", { signal: controller.signal });
    expect(results).toEqual([]);
  });
});
