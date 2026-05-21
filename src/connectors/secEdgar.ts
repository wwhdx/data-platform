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
  buildEftsSearchUrl,
  mapEftsHitToRawJson,
  type EftsSearchResponse,
} from "./secEdgarHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildSecEdgarCanonicalUrl,
  buildSecEdgarDocumentRequest,
} from "./provenance/secEdgar";
import {
  buildSecFilingIndexUrl,
  isSecEdgarFulltextEnabled,
  parsePrimaryDocHref,
  secEdgarFulltextMaxChars,
  stripSecFilingHtml,
} from "../processors/secFilingText";

export const SEC_EDGAR_META: ConnectorMeta = {
  id: "sec_edgar",
  name: "SEC EDGAR",
  baseUrl: "https://data.sec.gov/",
  license: "public domain (US gov)",
  commercialUse: true,
  authType: "polite_id",
  rateLimit: "10/sec",
  description: "SEC 申报 EFTS 检索 + 10-K/10-Q HTML 全文（Phase B）",
};

export class SecEdgarConnector extends BaseConnector {
  readonly meta: ConnectorMeta = SEC_EDGAR_META;

  constructor(config: ConnectorConfig = {}) {
    const ua =
      config.userAgent ??
      process.env.SEC_EDGAR_USER_AGENT ??
      "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)";
    super({ ...config, userAgent: ua }, SEC_EDGAR_META.baseUrl);
    this.rateLimiter = RateLimiter.fromRPS(8, 125);
  }

  private async searchEfts(
    query: string,
    since: string,
    end: string,
    from: number,
    size: number,
  ): Promise<EftsSearchResponse> {
    const url = buildEftsSearchUrl({ query, since, end, from, size });
    const res = await this.fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return {};
    return (await res.json()) as EftsSearchResponse;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const end = new Date().toISOString().slice(0, 10);
    const since =
      opts?.filters?.dateFrom ??
      new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const body = await this.searchEfts(query, since, end, 0, opts?.maxResults ?? 10);
    const hits = body.hits?.hits ?? [];
    return hits.map((h) => {
      const { rawJson } = mapEftsHitToRawJson(h._source ?? {});
      return {
        title: String(rawJson.title),
        url: String(rawJson.url ?? ""),
        snippet: String(rawJson.abstract ?? "").slice(0, 300),
        sourceId: SEC_EDGAR_META.id,
        sourceName: SEC_EDGAR_META.name,
        publishedAt: rawJson.publication_date as string | undefined,
        score: 1,
        license: SEC_EDGAR_META.license,
        commercialUse: SEC_EDGAR_META.commercialUse,
      };
    });
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(
      SEC_EDGAR_META.id,
      this.userAgent,
    );
    if (credErr) throw new Error(credErr);

    const maxItems = params.maxItems ?? Infinity;
    const end = new Date().toISOString().slice(0, 10);
    const since =
      params.since ??
      new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const q = params.query?.trim() || "*";
    let from = 0;
    const pageSize = 50;
    let yielded = 0;

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const body = await this.searchEfts(
        q,
        since,
        end,
        from,
        Math.min(pageSize, maxItems - yielded),
      );
      const hits = body.hits?.hits ?? [];
      if (hits.length === 0) break;

      const now = new Date();
      const collectCtx = {
        mode: "incremental" as const,
        since,
        query: params.query,
      };

      for (const hit of hits) {
        const { externalId, rawJson } = mapEftsHitToRawJson(hit._source ?? {});
        if (isSecEdgarFulltextEnabled() && rawJson.adsh && rawJson.url) {
          const fulltext = await this.fetchFilingFulltext(
            String(rawJson.url),
            String(rawJson.adsh),
          );
          if (fulltext) rawJson.fulltext = fulltext;
        }

        const doc: RawDocument = {
          sourceId: SEC_EDGAR_META.id,
          externalId,
          rawJson,
          fetchedAt: now,
        };
        yield attachProvenance(doc, SEC_EDGAR_META, {
          documentRequest: buildSecEdgarDocumentRequest(
            String(rawJson.url ?? ""),
            this.userAgent,
          ),
          collect: collectCtx,
          canonicalUrl: buildSecEdgarCanonicalUrl(rawJson),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      from += hits.length;
      if (hits.length < pageSize) break;
    }
  }

  private async fetchFilingFulltext(
    filingDirUrl: string,
    adsh: string,
  ): Promise<string> {
    const indexUrl = buildSecFilingIndexUrl(filingDirUrl, adsh);
    try {
      const indexRes = await this.fetch(indexUrl, {
        headers: { Accept: "text/html" },
      });
      if (!indexRes.ok) return "";
      const indexHtml = await indexRes.text();
      const docUrl = parsePrimaryDocHref(indexHtml, filingDirUrl);
      if (!docUrl) return "";

      const docRes = await this.fetch(docUrl, {
        headers: { Accept: "text/html" },
      });
      if (!docRes.ok) return "";
      const html = await docRes.text();
      const text = stripSecFilingHtml(html, secEdgarFulltextMaxChars());
      return text.length > 40 ? text : "";
    } catch {
      return "";
    }
  }
}
