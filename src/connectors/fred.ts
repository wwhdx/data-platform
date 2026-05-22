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
  FRED_CORE_SERIES,
  fredSeriesMatchesText,
  mapFredSeriesToRawJson,
  type FredObservationsResponse,
  type FredSearchResponse,
  type FredSeries,
} from "./fredHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildFredCanonicalUrl,
  buildFredDocumentRequest,
} from "./provenance/fred";
import {
  crawlFredCatalog,
  type FredCategoriesResponse,
} from "./fred/catalogCrawl";
import {
  loadFredSeriesFile,
  parseFredConnectorOptions,
  type FredConnectorOptions,
  type FredSeriesYamlEntry,
} from "./fred/config";
import { searchFredCatalogByName } from "../storage/models/fredCatalog";

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
  private readonly fredOpts: FredConnectorOptions;

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
    this.fredOpts = parseFredConnectorOptions(this.sourceOptions);
  }

  private fredUrl(path: string, params: Record<string, string>): string {
    const sp = new URLSearchParams({ ...params, file_type: "json" });
    if (this.apiKey) sp.set("api_key", this.apiKey);
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    return `${root}/${path}?${sp}`;
  }

  private async fetchFredJson<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const res = await this.fetch(this.fredUrl(path, params));
    if (!res.ok) return null;
    return (await res.json()) as T;
  }

  async syncCatalog(): Promise<{
    categories: number;
    requests: number;
    hitRequestLimit: boolean;
  }> {
    const credErr = validateCredentialsForCollect(FRED_META.id, this.apiKey);
    if (credErr) throw new Error(credErr);

    const yamlSeries = loadFredSeriesFile(this.fredOpts.seriesFile);
    const result = await crawlFredCatalog(
      (categoryId) =>
        this.fetchFredJson<FredCategoriesResponse>("category/children", {
          category_id: String(categoryId),
        }),
      yamlSeries,
    );
    return {
      categories: result.categories,
      requests: result.requests,
      hitRequestLimit: result.hitRequestLimit,
    };
  }

  private async searchSeries(term: string, limit: number): Promise<FredSeries[]> {
    const body = await this.fetchFredJson<FredSearchResponse>("series/search", {
      search_text: term,
      limit: String(limit),
    });
    return body?.seriess ?? [];
  }

  private async fetchSeriesById(seriesId: string): Promise<FredSeries | null> {
    const body = await this.fetchFredJson<{ seriess?: FredSeries[] }>("series", {
      series_id: seriesId,
    });
    return body?.seriess?.[0] ?? null;
  }

  private async latestObservation(
    seriesId: string,
  ): Promise<FredObservationsResponse | null> {
    return this.fetchFredJson<FredObservationsResponse>("series/observations", {
      series_id: seriesId,
      sort_order: "desc",
      limit: "1",
    });
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase() || "gdp";
    const maxResults = opts?.maxResults ?? 10;
    const results: SearchResult[] = [];

    try {
      const catalogHits = await searchFredCatalogByName(q, maxResults);
      for (const hit of catalogHits) {
        if (results.length >= maxResults) break;
        if (hit.kind === "series" && "series_id" in hit) {
          results.push({
            title: String(hit.title ?? hit.series_id),
            url: buildFredCanonicalUrl(String(hit.series_id)),
            snippet: String(hit.series_id),
            sourceId: FRED_META.id,
            sourceName: FRED_META.name,
            score: 0.5,
            license: FRED_META.license,
            commercialUse: FRED_META.commercialUse,
          });
        } else if ("category_id" in hit) {
          results.push({
            title: String(hit.name),
            url: `https://fred.stlouisfed.org/categories/${hit.category_id}`,
            snippet: String(hit.category_path ?? hit.category_id).slice(0, 300),
            sourceId: FRED_META.id,
            sourceName: FRED_META.name,
            score: 0.4,
            license: FRED_META.license,
            commercialUse: FRED_META.commercialUse,
          });
        }
      }
    } catch {
      /* 目录表未迁移时仅走 YAML / search */
    }

    const yamlSeries = this.resolveCollectSeries(
      loadFredSeriesFile(this.fredOpts.seriesFile),
    );
    for (const item of yamlSeries.filter((s) => fredSeriesMatchesText(s, q))) {
      if (results.length >= maxResults) break;
      const obs = await this.latestObservation(item.series_id);
      const latest = obs?.observations?.[0];
      const series: FredSeries = {
        id: item.series_id,
        title: item.title ?? item.series_id,
      };
      const { rawJson } = mapFredSeriesToRawJson(series, latest, obs?.units);
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

    if (results.length < maxResults) {
      const series = await this.searchSeries(q, maxResults - results.length);
      for (const s of series) {
        if (results.length >= maxResults) break;
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
    }
    return results.slice(0, maxResults);
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(FRED_META.id, this.apiKey);
    if (credErr) throw new Error(credErr);

    const yamlSeries = loadFredSeriesFile(this.fredOpts.seriesFile);
    const entries =
      yamlSeries.length > 0
        ? this.resolveCollectSeries(yamlSeries)
        : FRED_CORE_SERIES;

    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    let yielded = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    for (const item of entries) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;
      if (queryFilter && !fredSeriesMatchesText(item, queryFilter)) continue;

      const meta =
        (await this.fetchSeriesById(item.series_id)) ??
        ({
          id: item.series_id,
          title: item.title ?? item.series_id,
        } as FredSeries);
      const obs = await this.latestObservation(item.series_id);
      const latest = obs?.observations?.[0];
      const { externalId, rawJson } = mapFredSeriesToRawJson(meta, latest, obs?.units);

      const doc = this.withIndustryTag(
        {
          sourceId: FRED_META.id,
          externalId,
          rawJson: {
            ...rawJson,
            series_id: item.series_id,
            collect_tier: item.tier,
          },
          fetchedAt: new Date(),
        },
        item.industry_tag,
      );
      yield attachProvenance(doc, FRED_META, {
        documentRequest: buildFredDocumentRequest(
          externalId,
          this.runtimeBaseUrl,
          this.userAgent,
          this.apiKey,
        ),
        collect: collectCtx,
        canonicalUrl: buildFredCanonicalUrl(externalId),
      });
      yielded++;
    }

    if (yamlSeries.length === 0 && !queryFilter && yielded < maxItems) {
      const term = params.query?.trim() || "gdp";
      const series = await this.searchSeries(term, Math.min(maxItems - yielded, 50));
      for (const s of series) {
        if (params.signal?.aborted) break;
        if (yielded >= maxItems) break;
        const obs = await this.latestObservation(s.id);
        const latest = obs?.observations?.[0];
        const { externalId, rawJson } = mapFredSeriesToRawJson(s, latest, obs?.units);
        const doc = this.withIndustryTag(
          {
            sourceId: FRED_META.id,
            externalId,
            rawJson,
            fetchedAt: new Date(),
          },
          null,
        );
        yield attachProvenance(doc, FRED_META, {
          documentRequest: buildFredDocumentRequest(
            externalId,
            this.runtimeBaseUrl,
            this.userAgent,
            this.apiKey,
          ),
          collect: collectCtx,
          canonicalUrl: buildFredCanonicalUrl(externalId),
        });
        yielded++;
      }
    }
  }

  private resolveCollectSeries(
    yamlSeries: FredSeriesYamlEntry[],
  ): FredSeriesYamlEntry[] {
    const tiers = new Set(this.fredOpts.tierFilter.map((t) => t.toUpperCase()));
    return yamlSeries.filter((s) => {
      const tier = s.tier.toUpperCase();
      if (!tiers.has(tier)) return false;
      if (s.collect_enabled === false) return false;
      return true;
    });
  }
}
