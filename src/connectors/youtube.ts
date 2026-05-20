import type {
  ConnectorMeta,
  ConnectorConfig,
  RawDocument,
  SearchResult,
  CollectParams,
  SearchOptions,
} from "../types";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";
import { validateCredentialsForCollect } from "./credentials";
import {
  buildSearchListParams,
  buildVideosListParams,
  mapSearchItemToRawJson,
  mapVideoToRawJson,
  itemToSearchResult,
  readYoutubeIntOption,
  type YtSearchListResponse,
  type YtVideoListResponse,
} from "./youtubeHelpers";

export const YOUTUBE_META: ConnectorMeta = {
  id: "youtube",
  name: "YouTube Data API v3",
  baseUrl: "https://www.googleapis.com/youtube/v3",
  license: "YouTube API Terms of Service",
  commercialUse: false,
  authType: "query_param_key",
  rateLimit: "10000 units/day (search=100 units)",
  description: "视频搜索元数据（search.list + 可选 videos.list 统计）",
};

const RESULT_META = {
  sourceId: YOUTUBE_META.id,
  sourceName: YOUTUBE_META.name,
  license: YOUTUBE_META.license,
  commercialUse: YOUTUBE_META.commercialUse,
};

export class YouTubeConnector extends BaseConnector {
  readonly meta: ConnectorMeta = YOUTUBE_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      YOUTUBE_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(0.5, 2000);
  }

  private requireApiKey(): string {
    const key = this.apiKey?.trim();
    if (!key) {
      throw new Error(
        validateCredentialsForCollect("youtube", this.apiKey) ??
          "YOUTUBE_API_KEY 未配置",
      );
    }
    return key;
  }

  private apiUrl(path: string, params: URLSearchParams): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    return `${root}/${path.replace(/^\//, "")}?${params}`;
  }

  private async searchList(
    query: string,
    maxResults: number,
    since?: string,
    pageToken?: string,
  ): Promise<YtSearchListResponse> {
    const apiKey = this.requireApiKey();
    const lang = this.sourceOptions.relevance_language;
    const sp = buildSearchListParams({
      query,
      maxResults,
      pageToken,
      since,
      apiKey,
      relevanceLanguage:
        typeof lang === "string" && lang.length >= 2 ? lang : undefined,
    });
    const res = await this.fetch(this.apiUrl("search", sp));
    this.assertAuthorizedResponse(res);
    if (!res.ok) return { items: [] };
    return (await res.json()) as YtSearchListResponse;
  }

  private async videosList(
    videoIds: string[],
  ): Promise<YtVideoListResponse> {
    if (videoIds.length === 0) return { items: [] };
    const sp = buildVideosListParams(videoIds, this.requireApiKey());
    const res = await this.fetch(this.apiUrl("videos", sp));
    this.assertAuthorizedResponse(res);
    if (!res.ok) return { items: [] };
    return (await res.json()) as YtVideoListResponse;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const max = opts?.maxResults ?? 10;
    const body = await this.searchList(query, Math.min(max, 50));
    const items = body.items ?? [];
    if (this.sourceOptions.enrich_statistics !== true) {
      return items
        .map((item) => itemToSearchResult(item, RESULT_META))
        .filter((r): r is SearchResult => r !== null)
        .slice(0, max);
    }
    const ids = items
      .map((i) => i.id?.videoId)
      .filter((id): id is string => Boolean(id))
      .slice(0, max);
    const byId = new Map(
      (await this.videosList(ids)).items?.map((v) => [v.id ?? "", v]) ?? [],
    );
    const results: SearchResult[] = [];
    for (const item of items) {
      if (results.length >= max) break;
      const vid = item.id?.videoId;
      const sr = vid
        ? itemToSearchResult(item, RESULT_META, byId.get(vid))
        : null;
      if (sr) results.push(sr);
    }
    return results;
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const err = validateCredentialsForCollect("youtube", this.apiKey);
    if (err) throw new Error(err);

    const maxItems = params.maxItems ?? Infinity;
    const term =
      params.query?.trim() ||
      String(this.sourceOptions.default_collect_query ?? "machine learning");
    const perPage = readYoutubeIntOption(
      this.sourceOptions,
      "max_results_per_page",
      25,
      50,
    );
    const maxPages = readYoutubeIntOption(
      this.sourceOptions,
      "max_search_pages",
      1,
      5,
    );
    const enrich = this.sourceOptions.enrich_statistics === true;
    let pageToken: string | undefined;
    let pages = 0;
    let yielded = 0;

    while (yielded < maxItems && pages < maxPages) {
      if (params.signal?.aborted) break;

      const body = await this.searchList(
        term,
        Math.min(perPage, maxItems - yielded),
        params.since,
        pageToken,
      );
      const items = body.items ?? [];
      if (items.length === 0) break;

      const now = new Date();
      const byId = enrich
        ? new Map(
            (
              await this.videosList(
                items
                  .map((i) => i.id?.videoId)
                  .filter((id): id is string => Boolean(id)),
              )
            ).items?.map((v) => [v.id ?? "", v]) ?? [],
          )
        : null;

      for (const item of items) {
        if (yielded >= maxItems) break;
        const vid = item.id?.videoId;
        if (!vid) continue;
        const mapped = enrich
          ? mapVideoToRawJson(vid, byId?.get(vid)?.snippet ?? item.snippet, byId?.get(vid)?.statistics)
          : mapSearchItemToRawJson(item);
        if (!mapped) continue;
        yield {
          sourceId: YOUTUBE_META.id,
          externalId: mapped.externalId,
          rawJson: mapped.rawJson,
          fetchedAt: now,
        };
        yielded++;
      }

      pageToken = body.nextPageToken;
      pages++;
      if (!pageToken) break;
    }
  }
}
