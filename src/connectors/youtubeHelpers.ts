/** YouTube Data API v3 — search.list / videos.list 响应片段 */

export interface YtThumbnail {
  url?: string;
}

export interface YtSnippet {
  title?: string;
  description?: string;
  channelTitle?: string;
  publishedAt?: string;
  thumbnails?: { default?: YtThumbnail; medium?: YtThumbnail };
}

export interface YtSearchItem {
  id?: { videoId?: string; kind?: string };
  snippet?: YtSnippet;
}

export interface YtVideoItem {
  id?: string;
  snippet?: YtSnippet;
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

export interface YtSearchListResponse {
  items?: YtSearchItem[];
  nextPageToken?: string;
}

export interface YtVideoListResponse {
  items?: YtVideoItem[];
}

export function videoIdFromSearchItem(item: YtSearchItem): string | null {
  const id = item.id?.videoId?.trim();
  return id || null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function sinceToPublishedAfter(since?: string): string | undefined {
  if (!since?.trim()) return undefined;
  const d = since.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return undefined;
  return `${d}T00:00:00Z`;
}

export function buildSearchListParams(opts: {
  query: string;
  maxResults: number;
  pageToken?: string;
  since?: string;
  apiKey: string;
  relevanceLanguage?: string;
}): URLSearchParams {
  const sp = new URLSearchParams({
    part: "snippet",
    q: opts.query,
    type: "video",
    maxResults: String(Math.min(Math.max(opts.maxResults, 1), 50)),
    key: opts.apiKey,
  });
  const after = sinceToPublishedAfter(opts.since);
  if (after) sp.set("publishedAfter", after);
  if (opts.pageToken) sp.set("pageToken", opts.pageToken);
  if (opts.relevanceLanguage) sp.set("relevanceLanguage", opts.relevanceLanguage);
  return sp;
}

export function buildVideosListParams(
  videoIds: string[],
  apiKey: string,
): URLSearchParams {
  return new URLSearchParams({
    part: "snippet,statistics",
    id: videoIds.join(","),
    key: apiKey,
  });
}

export function mapVideoToRawJson(
  videoId: string,
  snippet?: YtSnippet,
  statistics?: YtVideoItem["statistics"],
): { externalId: string; rawJson: Record<string, unknown> } {
  const desc = snippet?.description?.trim() ?? "";
  const abstract = desc.length > 8000 ? `${desc.slice(0, 8000)}…` : desc;
  return {
    externalId: videoId,
    rawJson: {
      title: snippet?.title?.trim() || videoId,
      abstract: abstract || snippet?.title?.trim(),
      publication_date: snippet?.publishedAt?.slice(0, 10),
      channel_title: snippet?.channelTitle,
      url: watchUrl(videoId),
      type: "video",
      view_count: statistics?.viewCount
        ? Number.parseInt(statistics.viewCount, 10)
        : undefined,
      like_count: statistics?.likeCount
        ? Number.parseInt(statistics.likeCount, 10)
        : undefined,
      comment_count: statistics?.commentCount
        ? Number.parseInt(statistics.commentCount, 10)
        : undefined,
    },
  };
}

export function mapSearchItemToRawJson(
  item: YtSearchItem,
): { externalId: string; rawJson: Record<string, unknown> } | null {
  const videoId = videoIdFromSearchItem(item);
  if (!videoId) return null;
  return mapVideoToRawJson(videoId, item.snippet);
}

export interface YoutubeSearchResultMeta {
  sourceId: string;
  sourceName: string;
  license: string;
  commercialUse: boolean;
}

export function itemToSearchResult(
  item: YtSearchItem,
  meta: YoutubeSearchResultMeta,
  video?: YtVideoItem,
): { title: string; url: string; snippet: string; sourceId: string; sourceName: string; publishedAt?: string; score: number; license: string; commercialUse: boolean } | null {
  const videoId = videoIdFromSearchItem(item);
  if (!videoId) return null;
  const { rawJson } = mapVideoToRawJson(
    videoId,
    video?.snippet ?? item.snippet,
    video?.statistics,
  );
  return {
    title: String(rawJson.title),
    url: String(rawJson.url),
    snippet: String(rawJson.abstract ?? "").slice(0, 300),
    sourceId: meta.sourceId,
    sourceName: meta.sourceName,
    publishedAt: rawJson.publication_date as string | undefined,
    score: (rawJson.view_count as number | undefined) ?? 0,
    license: meta.license,
    commercialUse: meta.commercialUse,
  };
}

export function readYoutubeIntOption(
  options: Record<string, unknown>,
  key: string,
  fallback: number,
  max: number,
): number {
  const n = options[key];
  if (typeof n === "number" && n > 0) return Math.min(n, max);
  return fallback;
}
