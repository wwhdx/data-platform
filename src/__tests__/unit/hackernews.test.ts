import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapHnItemToRawJson, itemPassesSince } from "../../connectors/hackernewsHelpers";
import {
  shouldFetchHnStoryUrl,
  stripHtmlToText,
  isHnUrlFulltextEnabled,
} from "../../connectors/hackernewsUrlFulltext";
import { HackerNewsConnector } from "../../connectors/hackernews";

describe("hackernews helpers", () => {
  it("mapHnItemToRawJson", () => {
    const { externalId, rawJson } = mapHnItemToRawJson({
      id: 42,
      title: "Show HN: Test",
      url: "https://example.com",
      time: 1700000000,
      score: 100,
    });
    expect(externalId).toBe("42");
    expect(rawJson.url).toBe("https://example.com");
  });

  it("mapHnItemToRawJson 含 fulltext", () => {
    const { rawJson } = mapHnItemToRawJson(
      { id: 1, title: "T", url: "https://example.com/article" },
      "article body text",
    );
    expect(rawJson.fulltext).toBe("article body text");
    expect(rawJson.fulltext_source).toBe("linked_url");
  });

  it("itemPassesSince", () => {
    const item = { id: 1, time: 1700000000 };
    expect(itemPassesSince(item, "2023-01-01")).toBe(true);
    expect(itemPassesSince(item, "2030-01-01")).toBe(false);
  });
});

describe("hackernewsUrlFulltext", () => {
  it("shouldFetchHnStoryUrl 跳过 HN 自身链接", () => {
    expect(shouldFetchHnStoryUrl("https://news.ycombinator.com/item?id=1")).toBe(false);
    expect(shouldFetchHnStoryUrl("https://example.com/post")).toBe(true);
  });

  it("stripHtmlToText", () => {
    const text = stripHtmlToText("<p>Hello <b>world</b></p>", 1000);
    expect(text).toContain("Hello");
    expect(text).toContain("world");
  });

  it("isHnUrlFulltextEnabled 默认 false", () => {
    const prev = process.env.HACKERNEWS_URL_FULLTEXT_ENABLED;
    delete process.env.HACKERNEWS_URL_FULLTEXT_ENABLED;
    expect(isHnUrlFulltextEnabled()).toBe(false);
    process.env.HACKERNEWS_URL_FULLTEXT_ENABLED = prev;
  });
});

describe("HackerNewsConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.HACKERNEWS_URL_FULLTEXT_ENABLED;
  });

  it("collect 拉取 top story", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [99],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 99,
          type: "story",
          title: "AI news",
          time: 1700000000,
        }),
      } as Response);

    const c = new HackerNewsConnector();
    const docs = [];
    for await (const d of c.collect({ maxItems: 5 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toBe("99");
  });

  it("collect 外链 fulltext 可选", async () => {
    process.env.HACKERNEWS_URL_FULLTEXT_ENABLED = "1";
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [99],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 99,
          type: "story",
          title: "Article",
          url: "https://example.com/article",
          time: 1700000000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "text/html" },
        text: async () => "<html><body><p>" + "word ".repeat(50) + "</p></body></html>",
      } as Response);

    const c = new HackerNewsConnector();
    const docs = [];
    for await (const d of c.collect({ maxItems: 1 })) {
      docs.push(d);
    }
    expect(String(docs[0]?.rawJson.fulltext)).toContain("word");
  });
});
