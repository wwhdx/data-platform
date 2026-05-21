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
  EUROSTAT_CORE_QUERIES,
  buildEurostatAccessibleUrl,
  buildEurostatCanonicalUrl,
  buildEurostatDataParams,
  buildEurostatDataPath,
  eurostatQueryMatchesText,
  mapJsonStatToDocuments,
  type JsonStatDataset,
  type EurostatQuery,
} from "./eurostatHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildEurostatDocumentRequest,
} from "./provenance/eurostat";

export const EUROSTAT_META: ConnectorMeta = {
  id: "eurostat",
  name: "Eurostat",
  baseUrl: "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/",
  license: "CC BY 4.0 (Eurostat)",
  commercialUse: true,
  authType: "none",
  rateLimit: "polite (~2/sec)",
  description: "欧盟官方统计序列（JSON-stat SDMX REST）",
};

export class EurostatConnector extends BaseConnector {
  readonly meta: ConnectorMeta = EUROSTAT_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      EUROSTAT_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
  }

  private dataUrl(query: EurostatQuery): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    const path = buildEurostatDataPath(query.code);
    const sp = buildEurostatDataParams(query.params);
    return `${root}/${path}?${sp}`;
  }

  private async fetchDataset(query: EurostatQuery): Promise<JsonStatDataset | null> {
    const res = await this.fetch(this.dataUrl(query));
    if (!res.ok) return null;
    const body = (await res.json()) as JsonStatDataset & {
      error?: unknown;
    };
    if (body.error || !body.label) return null;
    return body;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase() || "gdp";
    const maxResults = opts?.maxResults ?? 10;
    const matched = EUROSTAT_CORE_QUERIES.filter((item) =>
      eurostatQueryMatchesText(item, q),
    ).slice(0, maxResults);

    const results: SearchResult[] = [];
    for (const item of matched) {
      const body = await this.fetchDataset(item);
      if (!body) continue;
      const docs = mapJsonStatToDocuments(item.code, body);
      const first = docs[0];
      if (!first) continue;
      results.push({
        title: String(first.rawJson.title),
        url: buildEurostatAccessibleUrl(
          item.code,
          (first.rawJson.dimensions as Record<string, string>) ?? {},
        ),
        snippet: String(first.rawJson.abstract ?? "").slice(0, 300),
        sourceId: EUROSTAT_META.id,
        sourceName: EUROSTAT_META.name,
        publishedAt: first.rawJson.date as string | undefined,
        score: 0,
        license: EUROSTAT_META.license,
        commercialUse: EUROSTAT_META.commercialUse,
      });
      if (results.length >= maxResults) break;
    }
    return results;
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    let yielded = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    for (const item of EUROSTAT_CORE_QUERIES) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;
      if (queryFilter && !eurostatQueryMatchesText(item, queryFilter)) continue;

      const body = await this.fetchDataset(item);
      if (!body) continue;

      for (const mapped of mapJsonStatToDocuments(item.code, body)) {
        if (params.signal?.aborted) break;
        if (yielded >= maxItems) break;

        const doc: RawDocument = {
          sourceId: EUROSTAT_META.id,
          externalId: mapped.externalId,
          rawJson: mapped.rawJson,
          fetchedAt: new Date(),
        };
        yield attachProvenance(doc, EUROSTAT_META, {
          documentRequest: buildEurostatDocumentRequest(
            item,
            this.runtimeBaseUrl,
            this.userAgent,
          ),
          collect: collectCtx,
          canonicalUrl: buildEurostatCanonicalUrl(item.code),
        });
        yielded++;
      }
    }
  }
}
