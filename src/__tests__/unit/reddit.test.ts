import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractPosts,
  mapRedditPostToRawJson,
  parseSubredditsOption,
  postPassesSince,
  sinceToUtcEpoch,
} from "../../connectors/redditHelpers";
import { RedditConnector } from "../../connectors/reddit";

const SAMPLE_LISTING = {
  data: {
    children: [
      {
        kind: "t3",
        data: {
          id: "abc123",
          name: "t3_abc123",
          title: "Test ML post",
          selftext: "Body text here",
          subreddit: "MachineLearning",
          author: "user1",
          created_utc: 1_700_000_000,
          score: 42,
          permalink: "/r/MachineLearning/comments/abc123/test/",
        },
      },
    ],
    after: null,
  },
};

describe("reddit helpers", () => {
  it("parseSubredditsOption 默认与数组", () => {
    expect(parseSubredditsOption(undefined)).toContain("MachineLearning");
    expect(parseSubredditsOption({ subreddits: ["python"] })).toEqual([
      "python",
    ]);
  });

  it("sinceToUtcEpoch", () => {
    expect(sinceToUtcEpoch("2024-01-01")).toBeGreaterThan(0);
  });

  it("postPassesSince", () => {
    const post = SAMPLE_LISTING.data!.children![0]!.data!;
    expect(postPassesSince(post, sinceToUtcEpoch("2020-01-01"))).toBe(true);
    expect(postPassesSince(post, sinceToUtcEpoch("2030-01-01"))).toBe(false);
  });

  it("extractPosts + mapRedditPostToRawJson", () => {
    const posts = extractPosts(SAMPLE_LISTING);
    expect(posts).toHaveLength(1);
    const { externalId, rawJson } = mapRedditPostToRawJson(posts[0]!);
    expect(externalId).toBe("t3_abc123");
    expect(rawJson.title).toBe("Test ML post");
    expect(rawJson.data_source).toBe("reddit");
    expect(String(rawJson.url)).toContain("reddit.com");
  });
});

describe("RedditConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 缺凭证时失败", async () => {
    const c = new RedditConnector();
    await expect(async () => {
      for await (const _ of c.collect({ maxItems: 1 })) {
        /* drain */
      }
    }).rejects.toThrow(/REDDIT_/);
  });

  it("search OAuth + listing", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "tok",
          expires_in: 3600,
          token_type: "bearer",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => SAMPLE_LISTING,
      } as Response);

    const prev = {
      id: process.env.REDDIT_CLIENT_ID,
      secret: process.env.REDDIT_CLIENT_SECRET,
      ua: process.env.REDDIT_USER_AGENT,
    };
    process.env.REDDIT_CLIENT_ID = "cid";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    process.env.REDDIT_USER_AGENT = "web:test:1.0 (by /u/tester)";

    const c = new RedditConnector({
      apiKey: "cid",
      apiSecret: "secret",
      userAgent: "web:test:1.0 (by /u/tester)",
    });
    const results = await c.search("machine learning", { maxResults: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.sourceId).toBe("reddit");
    expect(global.fetch).toHaveBeenCalledTimes(2);

    if (prev.id === undefined) delete process.env.REDDIT_CLIENT_ID;
    else process.env.REDDIT_CLIENT_ID = prev.id;
    if (prev.secret === undefined) delete process.env.REDDIT_CLIENT_SECRET;
    else process.env.REDDIT_CLIENT_SECRET = prev.secret;
    if (prev.ua === undefined) delete process.env.REDDIT_USER_AGENT;
    else process.env.REDDIT_USER_AGENT = prev.ua;
  });
});
