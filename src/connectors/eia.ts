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
  EIA_DEFAULT_ROUTE,
  eiaRowMatchesQuery,
  mapEiaRowToRawJson,
  pickEiaTitle,
  buildEiaAbstract,
  type EiaDataResponse,
  type EiaDataRow,
} from "./eiaHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildEiaCanonicalUrl,
  buildEiaDocumentRequest,
} from "./provenance/eia";

export const EIA_META: ConnectorMeta = {
  id: "eia",
  name: "EIA Open Data",
  baseUrl: "https://api.eia.gov/v2",
  license: "public domain (US gov)",
  commercialUse: true,
  authType: "query_param_key",
  rateLimit: "not specified",
  description: "美国能源信息署官方能源时间序列",
};

export class EiaConnector extends BaseConnector {
  readonly meta: ConnectorMeta = EIA_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      EIA_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
  }

  private dataUrl(route: string, params: URLSearchParams): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    const path = route.startsWith("/") ? route : `/${route}`;
    return `${root}${path}?${params}`;
  }

  private baseDataParams(length: number, offset: number): URLSearchParams {
    const sp = new URLSearchParams({
      frequency: "daily",
      "data[0]": "value",
      "sort[0][column]": "period",
      "sort[0][direction]": "desc",
      length: String(length),
      offset: String(offset),
    });
    if (this.apiKey?.trim()) sp.set("api_key", this.apiKey.trim());
    return sp;
  }

  private async fetchData(
    route: string,
    params: URLSearchParams,
  ): Promise<EiaDataRow[]> {
    const res = await this.fetch(this.dataUrl(route, params));
    if (this.apiKey) this.assertAuthorizedResponse(res);
    if (!res.ok) return [];
    const body = (await res.json()) as EiaDataResponse;
    return body.response?.data ?? [];
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim() || "crude";
    const maxResults = opts?.maxResults ?? 10;
    const rows = await this.fetchData(
      EIA_DEFAULT_ROUTE,
      this.baseDataParams(100, 0),
    );
    return rows
      .filter((r) => eiaRowMatchesQuery(r, q))
      .slice(0, maxResults)
      .map((r) => this.toSearchResult(r));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(EIA_META.id, this.apiKey);
    if (credErr) throw new Error(credErr);

    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    let offset = 0;
    const pageSize = 100;
    let yielded = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;
      const rows = await this.fetchData(
        EIA_DEFAULT_ROUTE,
        this.baseDataParams(pageSize, offset),
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        if (params.signal?.aborted) break;
        if (queryFilter && !eiaRowMatchesQuery(row, queryFilter)) continue;

        const { externalId, rawJson } = mapEiaRowToRawJson(
          row,
          EIA_DEFAULT_ROUTE,
        );
        const doc: RawDocument = {
          sourceId: EIA_META.id,
          externalId,
          rawJson,
          fetchedAt: new Date(),
        };
        yield attachProvenance(doc, EIA_META, {
          documentRequest: buildEiaDocumentRequest(
            EIA_DEFAULT_ROUTE,
            this.runtimeBaseUrl,
            this.userAgent,
            this.apiKey,
            externalId,
          ),
          collect: collectCtx,
          canonicalUrl: buildEiaCanonicalUrl(),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      offset += rows.length;
      if (rows.length < pageSize) break;
    }
  }

  private toSearchResult(row: EiaDataRow): SearchResult {
    const abstract = buildEiaAbstract(row);
    return {
      title: pickEiaTitle(row),
      url: "https://www.eia.gov/opendata/",
      snippet: abstract.slice(0, 300),
      sourceId: EIA_META.id,
      sourceName: EIA_META.name,
      publishedAt: row.period,
      score: 0,
      license: EIA_META.license,
      commercialUse: EIA_META.commercialUse,
    };
  }
}
