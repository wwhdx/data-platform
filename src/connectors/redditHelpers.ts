import type { RawDocument } from "../types";

/** Reddit Data API（oauth.reddit.com）→ RawDocument */

export const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
export const REDDIT_API_BASE = "https://oauth.reddit.com";
export const REDDIT_DEFAULT_SUBREDDITS = [
  "MachineLearning",
  "technology",
  "science",
] as const;
export const REDDIT_PAGE_LIMIT = 25;
export const REDDIT_MAX_PAGES = 20;

export interface RedditPostData {
  id: string;
  name?: string;
  title: string;
  selftext?: string;
  url?: string;
  permalink?: string;
  subreddit?: string;
  author?: string;
  created_utc?: number;
  score?: number;
  num_comments?: number;
}

export interface RedditListing {
  data?: {
    children?: Array<{ kind?: string; data?: RedditPostData }>;
    after?: string | null;
  };
}

export function parseSubredditsOption(
  options: Record<string, unknown> | undefined,
): string[] {
  const raw = options?.subreddits;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [...REDDIT_DEFAULT_SUBREDDITS];
}

export function parseListingKind(
  options: Record<string, unknown> | undefined,
): "hot" | "new" {
  const k = options?.listing;
  return k === "new" ? "new" : "hot";
}

export function sinceToUtcEpoch(since?: string): number | undefined {
  if (!since?.trim()) return undefined;
  const t = Date.parse(since.trim());
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

export function postPassesSince(
  post: RedditPostData,
  sinceEpoch?: number,
): boolean {
  if (sinceEpoch === undefined) return true;
  const created = post.created_utc;
  return typeof created === "number" && created >= sinceEpoch;
}

export function buildRedditPermalink(permalink?: string): string {
  if (!permalink) return "";
  if (permalink.startsWith("http")) return permalink;
  return `https://www.reddit.com${permalink.startsWith("/") ? permalink : `/${permalink}`}`;
}

export function extractPosts(listing: RedditListing): RedditPostData[] {
  const children = listing.data?.children ?? [];
  return children
    .filter((c) => c.kind === "t3" && c.data?.id)
    .map((c) => c.data!);
}

/** 分页拉取 listing 并产出 RawDocument */
export async function* yieldPostsFromListing(
  fetchListing: (pathWithQuery: string) => Promise<RedditListing>,
  basePath: string,
  sinceEpoch: number | undefined,
  maxItems: number,
  sourceId: string,
  signal?: AbortSignal,
): AsyncGenerator<RawDocument> {
  let after: string | undefined;
  let pages = 0;
  let yielded = 0;

  while (yielded < maxItems && pages < REDDIT_MAX_PAGES) {
    if (signal?.aborted) break;
    const sp = new URLSearchParams({ limit: String(REDDIT_PAGE_LIMIT) });
    if (after) sp.set("after", after);
    const listing = await fetchListing(`${basePath}?${sp}`);
    const posts = extractPosts(listing);
    if (posts.length === 0) break;

    const now = new Date();
    for (const post of posts) {
      if (!postPassesSince(post, sinceEpoch)) continue;
      const { externalId, rawJson } = mapRedditPostToRawJson(post);
      yield { sourceId, externalId, rawJson, fetchedAt: now };
      yielded++;
      if (yielded >= maxItems) return;
    }

    after = listing.data?.after ?? undefined;
    pages++;
    if (!after) break;
  }
}

export function mapRedditPostToRawJson(post: RedditPostData): {
  externalId: string;
  rawJson: Record<string, unknown>;
} {
  const externalId = post.name ?? `t3_${post.id}`;
  const body = (post.selftext ?? "").trim();
  const link =
    post.url && !post.url.includes("reddit.com")
      ? post.url
      : buildRedditPermalink(post.permalink);
  const pubDate = post.created_utc
    ? new Date(post.created_utc * 1000).toISOString().slice(0, 10)
    : undefined;

  return {
    externalId,
    rawJson: {
      title: post.title,
      abstract: body.slice(0, 4000) || post.title,
      publication_date: pubDate,
      type: "reddit_post",
      url: link,
      subreddit: post.subreddit,
      author: post.author,
      score: post.score,
      num_comments: post.num_comments,
      reddit_id: post.id,
      reddit_name: post.name,
      data_source: "reddit",
    },
  };
}
