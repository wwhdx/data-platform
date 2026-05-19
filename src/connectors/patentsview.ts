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
  PATENT_FIELDS,
  buildPatentQuery,
  mapPatentToRawJson,
  type PatentSearchResponse,
} from "./patentsviewHelpers";

export const PATENTSVIEW_META: ConnectorMeta = {
  id: "patentsview",
  name: "PatentsView (USPTO)",
  baseUrl: "https://search.patentsview.org/api/v1",
  license: "public domain (US gov)",
  commercialUse: true,
  authType: "header_custom",
  rateLimit: "45/min",
  description: "USPTO 清洗专利数据，含标题与摘要",
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
    this.rateLimiter = RateLimiter.fromRPS(0.7, 1500);
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { "X-Api-Key": this.apiKey } : {};
  }

  private patentUrl(): string {
    return `${this.runtimeBaseUrl.replace(/\/$/, "")}/patent`;
  }

  private async searchPatents(
    q: Record<string, unknown>,
    opts: { size: number; after?: string },
  ): Promise<PatentSearchResponse> {
    const res = await this.fetchPost(
      this.patentUrl(),
      {
        q,
        f: [...PATENT_FIELDS],
        o: { size: opts.size, ...(opts.after ? { after: opts.after } : {}) },
      },
      this.authHeaders(),
    );
    this.assertAuthorizedResponse(res);
    if (!res.ok) {
      throw new Error(
        `PatentsView API 请求失败 (HTTP ${res.status})`,
      );
    }
    return (await res.json()) as PatentSearchResponse;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const body = await this.searchPatents(
      buildPatentQuery(query, undefined),
      { size: Math.min(maxResults, 100) },
    );
    return (body.patents ?? []).slice(0, maxResults).map((p) => {
      const { rawJson } = mapPatentToRawJson(p);
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
    const q = buildPatentQuery(params.query, params.since);
    let after: string | undefined;
    let yielded = 0;
    const pageSize = 100;

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const body = await this.searchPatents(q, {
        size: Math.min(pageSize, maxItems - yielded),
        after,
      });
      const patents = body.patents ?? [];
      if (patents.length === 0) break;

      const now = new Date();
      for (const patent of patents) {
        const { externalId, rawJson } = mapPatentToRawJson(patent);
        yield {
          sourceId: PATENTSVIEW_META.id,
          externalId,
          rawJson,
          fetchedAt: now,
        };
        yielded++;
        if (yielded >= maxItems) break;
      }

      after = body.after;
      if (!after || patents.length < pageSize) break;
    }
  }
}
