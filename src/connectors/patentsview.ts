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
  ODP_API_BASE_URL,
  ODP_PATENT_SEARCH_PATH,
  buildOdpSearchBody,
  extractOdpRecords,
  mapOdpRecordToRawJson,
  type OdpSearchResponse,
} from "./patentsviewHelpers";

export const PATENTSVIEW_META: ConnectorMeta = {
  id: "patentsview",
  name: "USPTO ODP Patents (Patent File Wrapper)",
  baseUrl: ODP_API_BASE_URL,
  license: "public domain (US gov)",
  commercialUse: true,
  authType: "header_custom",
  rateLimit: "not specified",
  description: "USPTO Open Data Portal 专利检索（PFW applications/search）",
};

export class PatentsViewConnector extends BaseConnector {
  readonly meta: ConnectorMeta = PATENTSVIEW_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      PATENTSVIEW_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { "X-API-KEY": this.apiKey } : {};
  }

  private searchUrl(): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    return `${root}${ODP_PATENT_SEARCH_PATH}`;
  }

  private async postSearch(
    body: ReturnType<typeof buildOdpSearchBody>,
  ): Promise<OdpSearchResponse> {
    const res = await this.fetchPost(this.searchUrl(), body, this.authHeaders());
    this.assertAuthorizedResponse(res);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `USPTO ODP 专利检索失败 (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }
    return (await res.json()) as OdpSearchResponse;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const since = new Date(Date.now() - 365 * 86400000)
      .toISOString()
      .slice(0, 10);
    const body = await this.postSearch(
      buildOdpSearchBody({
        query,
        since,
        offset: 0,
        limit: Math.min(maxResults, 100),
      }),
    );
    return extractOdpRecords(body)
      .slice(0, maxResults)
      .map((record) => {
        const { rawJson } = mapOdpRecordToRawJson(record);
        return {
          title: String(rawJson.title),
          url: String(rawJson.url ?? ""),
          snippet: String(rawJson.abstract ?? "").slice(0, 300),
          sourceId: PATENTSVIEW_META.id,
          sourceName: PATENTSVIEW_META.name,
          publishedAt: rawJson.publication_date as string | undefined,
          score: 1,
          license: PATENTSVIEW_META.license,
          commercialUse: PATENTSVIEW_META.commercialUse,
        };
      });
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(
      PATENTSVIEW_META.id,
      this.apiKey,
    );
    if (credErr) throw new Error(credErr);

    const maxItems = params.maxItems ?? Infinity;
    let offset = 0;
    let yielded = 0;
    const pageSize = 100;

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const limit = Math.min(pageSize, maxItems - yielded);
      const payload = await this.postSearch(
        buildOdpSearchBody({
          query: params.query,
          since: params.since,
          offset,
          limit,
        }),
      );
      const records = extractOdpRecords(payload);
      if (records.length === 0) break;

      const now = new Date();
      for (const record of records) {
        const { externalId, rawJson } = mapOdpRecordToRawJson(record);
        yield {
          sourceId: PATENTSVIEW_META.id,
          externalId,
          rawJson,
          fetchedAt: now,
        };
        yielded++;
        if (yielded >= maxItems) break;
      }

      offset += records.length;
      if (records.length < limit) break;
    }
  }
}
