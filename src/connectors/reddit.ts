import type {
  ConnectorMeta,
  ConnectorConfig,
  RawDocument,
  SearchResult,
  CollectParams,
  SearchOptions,
} from "../types";
import { OAuth2ClientCredentials } from "../lib/oauth2ClientCredentials";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";
import { validateCredentialsForCollect } from "./credentials";
import {
  REDDIT_TOKEN_URL,
  REDDIT_API_BASE,
  REDDIT_PAGE_LIMIT,
  extractPosts,
  mapRedditPostToRawJson,
  parseListingKind,
  parseSubredditsOption,
  sinceToUtcEpoch,
  yieldPostsFromListing,
  type RedditListing,
} from "./redditHelpers";

export const REDDIT_META: ConnectorMeta = {
  id: "reddit",
  name: "Reddit",
  baseUrl: REDDIT_API_BASE,
  license: "Reddit Data API Terms",
  commercialUse: false,
  authType: "oauth2",
  rateLimit: "100 QPM (OAuth client id)",
  description: "公开 subreddit 热帖/搜索（client_credentials）",
};

export class RedditConnector extends BaseConnector {
  readonly meta: ConnectorMeta = REDDIT_META;
  private readonly oauth: OAuth2ClientCredentials;
  private readonly apiSecret?: string;

  constructor(config: ConnectorConfig = {}) {
    const ua =
      config.userAgent?.trim() ||
      process.env.REDDIT_USER_AGENT?.trim() ||
      "web:wangye-data-platform:0.1 (by /u/wangye-bot)";
    super({ ...config, userAgent: ua }, REDDIT_META.baseUrl);
    this.apiSecret = config.apiSecret;
    this.rateLimiter = RateLimiter.fromRPS(1.5, 600);
    const tokenUrl =
      typeof config.sourceOptions?.token_url === "string"
        ? config.sourceOptions.token_url
        : REDDIT_TOKEN_URL;
    this.oauth = new OAuth2ClientCredentials({
      tokenUrl,
      clientId: config.apiKey ?? "",
      clientSecret: config.apiSecret ?? "",
      tokenHeaders: { "User-Agent": ua },
    });
  }

  private credentialError(): string | null {
    return validateCredentialsForCollect(
      REDDIT_META.id,
      this.apiKey,
      this.apiSecret,
    );
  }

  private async redditGet(path: string, retry = true): Promise<Response> {
    const token = await this.oauth.getAccessToken();
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    const url = path.startsWith("http")
      ? path
      : `${root}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await this.fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if ((res.status === 401 || res.status === 403) && retry) {
      this.oauth.invalidate();
      return this.redditGet(path, false);
    }
    this.assertAuthorizedResponse(res);
    return res;
  }

  private async fetchListing(path: string): Promise<RedditListing> {
    const res = await this.redditGet(path);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Reddit API 失败 (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }
    return (await res.json()) as RedditListing;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const credErr = this.credentialError();
    if (credErr) throw new Error(credErr);

    const maxResults = opts?.maxResults ?? 10;
    const sp = new URLSearchParams({
      q: query,
      sort: "relevance",
      limit: String(Math.min(maxResults, REDDIT_PAGE_LIMIT)),
      type: "link",
    });
    const listing = await this.fetchListing(`/search?${sp}`);
    return extractPosts(listing)
      .slice(0, maxResults)
      .map((post) => {
        const { rawJson } = mapRedditPostToRawJson(post);
        return {
          title: String(rawJson.title),
          url: String(rawJson.url ?? ""),
          snippet: String(rawJson.abstract ?? "").slice(0, 300),
          sourceId: REDDIT_META.id,
          sourceName: REDDIT_META.name,
          publishedAt: rawJson.publication_date as string | undefined,
          score: post.score ?? 0,
          license: REDDIT_META.license,
          commercialUse: REDDIT_META.commercialUse,
        };
      });
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = this.credentialError();
    if (credErr) throw new Error(credErr);

    const maxItems = params.maxItems ?? Infinity;
    const sinceEpoch = sinceToUtcEpoch(params.since);
    const q = params.query?.trim();
    const fetcher = (p: string) => this.fetchListing(p);

    if (q) {
      const sp = new URLSearchParams({
        q,
        sort: "new",
        limit: String(REDDIT_PAGE_LIMIT),
        type: "link",
      });
      yield* yieldPostsFromListing(
        fetcher,
        `/search?${sp}`,
        sinceEpoch,
        maxItems,
        REDDIT_META.id,
        params.signal,
      );
      return;
    }

    const subs = parseSubredditsOption(this.sourceOptions);
    const kind = parseListingKind(this.sourceOptions);
    const perSub = Math.max(1, Math.ceil(maxItems / subs.length));

    for (const sub of subs) {
      if (params.signal?.aborted) break;
      yield* yieldPostsFromListing(
        fetcher,
        `/r/${encodeURIComponent(sub)}/${kind}`,
        sinceEpoch,
        perSub,
        REDDIT_META.id,
        params.signal,
      );
    }
  }
}
