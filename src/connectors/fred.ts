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
  mapFredSeriesToRawJson,
  type FredObservationsResponse,
  type FredSearchResponse,
  type FredSeries,
} from "./fredHelpers";

export const FRED_META: ConnectorMeta = {
  id: "fred",
  name: "FRED (Federal Reserve)",
  baseUrl: "https://api.stlouisfed.org/fred",
  license: "free (verify commercial)",
  commercialUse: false,
  authType: "query_param_key",
  rateLimit: "not specified",
  description: "美联储经济序列元数据 + 最新观测值",
};

export class FredConnector extends BaseConnector {
  readonly meta: ConnectorMeta = FRED_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      FRED_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
  }

  private async searchSeries(term: string, limit: number): Promise<FredSeries[]> {
    const sp = new URLSearchParams({
      search_text: term,
      file_type: "json",
      limit: String(limit),
    });
    if (this.apiKey) sp.set("api_key", this.apiKey);
    const url = `${this.runtimeBaseUrl}/series/search?${sp}`;
    const res = await this.fetch(url);
    if (!res.ok) return [];
    const body = (await res.json()) as FredSearchResponse;
    return body.seriess ?? [];
  }

  private async latestObservation(
    seriesId: string,
  ): Promise<FredObservationsResponse | null> {
    const sp = new URLSearchParams({
      series_id: seriesId,
      file_type: "json",
      sort_order: "desc",
      limit: "1",
    });
    if (this.apiKey) sp.set("api_key", this.apiKey);
    const url = `${this.runtimeBaseUrl}/series/observations?${sp}`;
    const res = await this.fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as FredObservationsResponse;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const series = await this.searchSeries(query, opts?.maxResults ?? 10);
    const results: SearchResult[] = [];
    for (const s of series) {
      const obs = await this.latestObservation(s.id);
      const latest = obs?.observations?.[0];
      const { rawJson } = mapFredSeriesToRawJson(s, latest, obs?.units);
      results.push({
        title: String(rawJson.title),
        url: String(rawJson.url),
        snippet: String(rawJson.abstract ?? "").slice(0, 300),
        sourceId: FRED_META.id,
        sourceName: FRED_META.name,
        publishedAt: rawJson.publication_date as string | undefined,
        score: 0,
        license: FRED_META.license,
        commercialUse: FRED_META.commercialUse,
      });
    }
    return results;
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(FRED_META.id, this.apiKey);
    if (credErr) throw new Error(credErr);

    const maxItems = params.maxItems ?? Infinity;
    const term = params.query?.trim() || "gdp";
    const series = await this.searchSeries(term, Math.min(maxItems, 50));
    let yielded = 0;

    for (const s of series) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;

      const obs = await this.latestObservation(s.id);
      const latest = obs?.observations?.[0];
      const { externalId, rawJson } = mapFredSeriesToRawJson(s, latest, obs?.units);
      yield {
        sourceId: FRED_META.id,
        externalId,
        rawJson,
        fetchedAt: new Date(),
      };
      yielded++;
    }
  }
}
