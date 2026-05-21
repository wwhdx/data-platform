import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mapSearchItemToRawJson,
  buildSearchListParams,
  sinceToPublishedAfter,
  mapVideoToRawJson,
  extractCommentTexts,
  isYoutubeCommentsEnabled,
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

  it("mapVideoToRawJson 含 contentDetails 与 top_comments", () => {
    const mapped = mapVideoToRawJson(
      "vid1",
      { title: "T", description: "desc" },
      { viewCount: "10" },
      { duration: "PT5M", definition: "hd" },
      ["great video"],
    );
    expect(mapped.rawJson.duration).toBe("PT5M");
    expect(mapped.rawJson.top_comments).toEqual(["great video"]);
  });

  it("extractCommentTexts", () => {
    const texts = extractCommentTexts({
      items: [{ snippet: { topLevelComment: { snippet: { textDisplay: "hi" } } } }],
    });
    expect(texts).toEqual(["hi"]);
  });

  it("isYoutubeCommentsEnabled 读 ENV", () => {
    const prev = process.env.YOUTUBE_ENRICH_COMMENTS_ENABLED;
    process.env.YOUTUBE_ENRICH_COMMENTS_ENABLED = "1";
    expect(isYoutubeCommentsEnabled({})).toBe(true);
    process.env.YOUTUBE_ENRICH_COMMENTS_ENABLED = prev;
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

  it("collect enrich_statistics 拉 videos.list", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [SEARCH_ITEM] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: "abc123xyz",
              snippet: SEARCH_ITEM.snippet,
              statistics: { viewCount: "99" },
              contentDetails: { duration: "PT10M" },
            },
          ],
        }),
      } as Response);

    const c = new YouTubeConnector({
      apiKey: "yt-test",
      sourceOptions: { enrich_statistics: true },
    });
    const docs = [];
    for await (const d of c.collect({ query: "ml", maxItems: 1 })) {
      docs.push(d);
    }
    expect(docs[0]?.rawJson.view_count).toBe(99);
    expect(docs[0]?.rawJson.duration).toBe("PT10M");
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
