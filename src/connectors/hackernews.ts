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
import {
  itemPassesSince,
  mapHnItemToRawJson,
  type HnItem,
} from "./hackernewsHelpers";

export const HACKERNEWS_META: ConnectorMeta = {
  id: "hackernews",
  name: "Hacker News",
  baseUrl: "https://hacker-news.firebaseio.com/v0",
  license: "free",
  commercialUse: true,
  authType: "none",
  rateLimit: "unlimited",
  description: "HN top stories 元数据（标题 + 正文片段）",
};

export class HackerNewsConnector extends BaseConnector {
  readonly meta: ConnectorMeta = HACKERNEWS_META;

  constructor(config: ConnectorConfig = {}) {
    super(config, HACKERNEWS_META.baseUrl);
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
  }

  private async fetchJson<T>(path: string): Promise<T | null> {
    const url = `${this.runtimeBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}.json`;
    const res = await this.fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  }

  private async fetchItem(id: number): Promise<HnItem | null> {
    return this.fetchJson<HnItem>(`item/${id}`);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const max = opts?.maxResults ?? 10;
    const ids = (await this.fetchJson<number[]>("topstories")) ?? [];
    const q = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const id of ids.slice(0, 100)) {
      if (results.length >= max) break;
      const item = await this.fetchItem(id);
      if (!item?.title) continue;
      const hay = `${item.title} ${item.text ?? ""}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      const { rawJson } = mapHnItemToRawJson(item);
      results.push({
        title: String(rawJson.title),
        url: String(rawJson.url),
        snippet: String(rawJson.abstract ?? item.title).slice(0, 300),
        sourceId: HACKERNEWS_META.id,
        sourceName: HACKERNEWS_META.name,
        publishedAt: rawJson.publication_date as string | undefined,
        score: item.score ?? 0,
        license: HACKERNEWS_META.license,
        commercialUse: HACKERNEWS_META.commercialUse,
      });
    }
    return results;
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    const ids = (await this.fetchJson<number[]>("topstories")) ?? [];
    const q = params.query?.trim().toLowerCase();
    let yielded = 0;

    for (const id of ids) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;

      const item = await this.fetchItem(id);
      if (!item || item.type !== "story") continue;
      if (!itemPassesSince(item, params.since)) continue;
      if (q) {
        const hay = `${item.title ?? ""} ${item.text ?? ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }

      const { externalId, rawJson } = mapHnItemToRawJson(item);
      yield {
        sourceId: HACKERNEWS_META.id,
        externalId,
        rawJson,
        fetchedAt: new Date(),
      };
      yielded++;
    }
  }
}
