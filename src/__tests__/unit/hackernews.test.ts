import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapHnItemToRawJson, itemPassesSince } from "../../connectors/hackernewsHelpers";
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

  it("itemPassesSince", () => {
    const item = { id: 1, time: 1700000000 };
    expect(itemPassesSince(item, "2023-01-01")).toBe(true);
    expect(itemPassesSince(item, "2030-01-01")).toBe(false);
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
});
