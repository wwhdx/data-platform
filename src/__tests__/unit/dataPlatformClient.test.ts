import { describe, it, expect, vi } from "vitest";
import { createDataPlatformClient } from "../../client/dataPlatformClient";

describe("unit: DataPlatformClient", () => {
  it("search 映射 POST /api/search results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "T",
            url: "https://x",
            snippet: "s",
            sourceId: "openalex",
            sourceName: "OpenAlex",
            score: 1,
            license: "CC0",
            commercialUse: true,
          },
        ],
        totalCount: 1,
        tookMs: 1,
      }),
    });

    const client = createDataPlatformClient("http://dp.test", { fetchImpl });
    const results = await client.search({ query: "q" });
    expect(results).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://dp.test/api/search",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("网络失败返回空数组", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createDataPlatformClient("http://dp.test", { fetchImpl });
    expect(await client.search({ query: "q" })).toEqual([]);
  });
});
