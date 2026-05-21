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
  OECD_CORE_QUERIES,
  buildOecdAccessibleUrl,
  buildOecdCanonicalUrl,
  buildOecdDataParams,
  buildOecdDataPath,
  mapSdmxJsonToDocuments,
  oecdQueryMatchesText,
  type OecdQuery,
  type SdmxJsonResponse,
} from "./oecdHelpers";
import { attachProvenance } from "./provenance/attach";
import { buildOecdDocumentRequest } from "./provenance/oecd";

export const OECD_META: ConnectorMeta = {
  id: "oecd",
  name: "OECD",
  baseUrl: "https://sdmx.oecd.org/public/rest/",
  license: "OECD Terms and Conditions",
  commercialUse: true,
  authType: "none",
  rateLimit: "polite (~2/sec)",
  description: "OECD 官方宏观序列（SDMX-JSON KEI：GDP/失业/CPI）",
};

export class OecdConnector extends BaseConnector {
  readonly meta: ConnectorMeta = OECD_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      OECD_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
  }

  private periodFromSince(since?: string): string | undefined {
    if (!since) return undefined;
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) return undefined;
    return String(d.getUTCFullYear());
  }

  private dataUrl(
    query: OecdQuery,
    opts?: { startPeriod?: string; endPeriod?: string },
  ): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    const path = buildOecdDataPath(query);
    const sp = buildOecdDataParams({
      startPeriod: opts?.startPeriod,
      endPeriod: opts?.endPeriod,
      lastNObservations: opts?.startPeriod ? undefined : 1,
    });
    return `${root}/${path}?${sp}`;
  }

  private async fetchDataset(
    query: OecdQuery,
    opts?: { startPeriod?: string; endPeriod?: string },
  ): Promise<SdmxJsonResponse | null> {
    const res = await this.fetch(this.dataUrl(query, opts));
    if (!res.ok) return null;
    const body = (await res.json()) as SdmxJsonResponse;
    if (body.errors || !body.data?.dataSets?.length) return null;
    return body;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase() || "gdp";
    const maxResults = opts?.maxResults ?? 10;
    const matched = OECD_CORE_QUERIES.filter((item) =>
      oecdQueryMatchesText(item, q),
    ).slice(0, maxResults);

    const results: SearchResult[] = [];
    for (const item of matched) {
      const body = await this.fetchDataset(item);
      if (!body) continue;
      const docs = mapSdmxJsonToDocuments(item, body, this.runtimeBaseUrl);
      const first = docs[0];
      if (!first) continue;
      results.push({
        title: String(first.rawJson.title),
        url: buildOecdAccessibleUrl(this.runtimeBaseUrl, item),
        snippet: String(first.rawJson.abstract ?? "").slice(0, 300),
        sourceId: OECD_META.id,
        sourceName: OECD_META.name,
        publishedAt: first.rawJson.date as string | undefined,
        score: 0,
        license: OECD_META.license,
        commercialUse: OECD_META.commercialUse,
      });
      if (results.length >= maxResults) break;
    }
    return results;
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    const startPeriod = this.periodFromSince(params.since);
    let yielded = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    for (const item of OECD_CORE_QUERIES) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;
      if (queryFilter && !oecdQueryMatchesText(item, queryFilter)) continue;

      const body = await this.fetchDataset(item, { startPeriod });
      if (!body) continue;

      for (const mapped of mapSdmxJsonToDocuments(
        item,
        body,
        this.runtimeBaseUrl,
      )) {
        if (params.signal?.aborted) break;
        if (yielded >= maxItems) break;

        const doc: RawDocument = {
          sourceId: OECD_META.id,
          externalId: mapped.externalId,
          rawJson: mapped.rawJson,
          fetchedAt: new Date(),
        };
        yield attachProvenance(doc, OECD_META, {
          documentRequest: buildOecdDocumentRequest(
            item,
            this.runtimeBaseUrl,
            this.userAgent,
            { startPeriod },
          ),
          collect: collectCtx,
          canonicalUrl: buildOecdCanonicalUrl(item),
        });
        yielded++;
      }
    }
  }
}
