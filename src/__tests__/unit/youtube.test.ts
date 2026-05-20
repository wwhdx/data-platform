import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mapSearchItemToRawJson,
  buildSearchListParams,
  sinceToPublishedAfter,
} from "../../connectors/youtubeHelpers";
import { YouTubeConnector } from "../../connectors/youtube";

const SEARCH_ITEM = {
  id: { videoId: "abc123xyz" },
  snippet: {
    title: "ML Tutorial",
    description: "Intro to transformers.",
    channelTitle: "AI Channel",
    publishedAt: "2024-06-01T12:00:00Z",
  },
};

describe("youtube helpers", () => {
  it("mapSearchItemToRawJson", () => {
    const mapped = mapSearchItemToRawJson(SEARCH_ITEM);
    expect(mapped?.externalId).toBe("abc123xyz");
    expect(mapped?.rawJson.url).toContain("youtube.com/watch?v=abc123xyz");
    expect(mapped?.rawJson.abstract).toContain("transformers");
  });

  it("buildSearchListParams 含 key 与 publishedAfter", () => {
    const sp = buildSearchListParams({
      query: "ai",
      maxResults: 10,
      since: "2024-01-01",
      apiKey: "test-key",
    });
    expect(sp.get("key")).toBe("test-key");
    expect(sp.get("type")).toBe("video");
    expect(sp.get("publishedAfter")).toBe("2024-01-01T00:00:00Z");
  });

  it("sinceToPublishedAfter 非法日期返回 undefined", () => {
    expect(sinceToPublishedAfter("bad")).toBeUndefined();
  });
});

describe("YouTubeConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 解析 search.list", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [SEARCH_ITEM] }),
    } as Response);

    const c = new YouTubeConnector({ apiKey: "yt-test" });
    const docs = [];
    for await (const d of c.collect({ query: "ml", maxItems: 5 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.sourceId).toBe("youtube");
    expect(docs[0]?.externalId).toBe("abc123xyz");
  });

  it("缺 Key 时 collect 抛错", async () => {
    const c = new YouTubeConnector();
    await expect(async () => {
      for await (const _ of c.collect({ maxItems: 1 })) {
        /* drain */
      }
    }).rejects.toThrow(/YOUTUBE_API_KEY/);
  });
});
