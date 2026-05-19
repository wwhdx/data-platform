import type {
  ConnectorMeta,
  ConnectorConfig,
  HttpRequestCapture,
  RawDocument,
  SearchResult,
  CollectParams,
  SearchOptions,
} from "../types";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";
import {
  arxivAbsUrl,
  arxivExternalId,
  parseArxivAtomSearch,
  parseOaiListRecords,
  resolveArxivSearchBaseUrl,
  type OaiArxivRecord,
} from "./arxivOaiHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildArxivOaiCanonicalUrl,
  buildArxivOaiDocumentRequest,
} from "./provenance/arxivOai";

export const ARXIV_OAI_META: ConnectorMeta = {
  id: "arxiv_oai",
  name: "arXiv (OAI-PMH)",
  baseUrl: "https://oaipmh.arxiv.org/oai",
  license: "metadata free",
  commercialUse: true,
  authType: "none",
  rateLimit: ">=3s interval",
  description: "arXiv 预印本 OAI-PMH 批量采集；搜索走 Legacy Atom API",
};

export class ArxivOaiConnector extends BaseConnector {
  readonly meta: ConnectorMeta = ARXIV_OAI_META;
  private readonly searchBaseUrl: string;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      ARXIV_OAI_META.baseUrl,
    );
    this.searchBaseUrl = resolveArxivSearchBaseUrl(this.sourceOptions);
    this.rateLimiter = RateLimiter.fromRPS(1, 3000);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const params = new URLSearchParams({
      search_query: `all:${query}`,
      start: "0",
      max_results: String(Math.min(maxResults, 50)),
    });

    const url = `${this.searchBaseUrl}?${params}`;
    const res = await this.fetch(url);
    if (!res.ok) return [];

    const xml = await res.text();
    return parseArxivAtomSearch(xml).map((entry) => this.toSearchResult(entry));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const since =
      params.since ??
      new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const maxItems = params.maxItems ?? Infinity;
    let yielded = 0;
    let batchIndex = 0;

    const collectCtx = {
      mode: "incremental" as const,
      since,
      query: params.query,
    };

    for await (const page of this.paginateOaiPages(since)) {
      if (params.signal?.aborted) break;

      const batchRequest: HttpRequestCapture & {
        batchIndex: number;
        documentsInBatch: number;
        ephemeral: boolean;
      } = {
        ...page.batchCapture,
        ephemeral: batchIndex > 0,
        batchIndex,
        documentsInBatch: page.records.length,
      };

      for (let i = 0; i < page.records.length; i++) {
        const record = page.records[i]!;
        if (params.signal?.aborted) break;

        const doc = this.toRawDocument(record);
        const arxivId = doc.externalId;
        yield attachProvenance(doc, ARXIV_OAI_META, {
          documentRequest: buildArxivOaiDocumentRequest(
            arxivId,
            this.userAgent,
          ),
          batchRequest: { ...batchRequest, documentIndexInBatch: i },
          collect: collectCtx,
          canonicalUrl: buildArxivOaiCanonicalUrl(arxivId),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      if (yielded >= maxItems) break;
      if (!page.resumptionToken) break;
      batchIndex++;
    }
  }

  private async *paginateOaiPages(
    since: string,
  ): AsyncGenerator<{
    records: OaiArxivRecord[];
    resumptionToken?: string;
    batchCapture: HttpRequestCapture;
  }> {
    let token: string | undefined;

    do {
      const page = await this.fetchListRecordsPage(since, token);
      const batchCapture = this.consumeLastHttpCapture();
      if (!batchCapture) {
        throw new Error("arXiv OAI collect: missing HTTP capture for batch");
      }
      yield {
        records: page.items,
        resumptionToken: page.token ?? undefined,
        batchCapture,
      };
      token = page.token ?? undefined;
    } while (token);
  }

  private async fetchListRecordsPage(
    since: string,
    token?: string,
  ): Promise<{ items: OaiArxivRecord[]; token?: string | null }> {
    const base = this.runtimeBaseUrl.replace(/\/$/, "");
    const url = token
      ? `${base}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`
      : `${base}?verb=ListRecords&metadataPrefix=arXiv&from=${encodeURIComponent(since)}`;

    const res = await this.fetch(url);
    if (!res.ok) {
      throw new Error(`arXiv OAI ListRecords failed: HTTP ${res.status}`);
    }

    const xml = await res.text();
    const page = parseOaiListRecords(xml);
    return { items: page.records, token: page.resumptionToken ?? null };
  }

  private toSearchResult(entry: {
    id: string;
    title: string;
    summary: string;
    published?: string;
  }): SearchResult {
    const arxivId = arxivExternalId(entry.id);
    return {
      title: entry.title,
      url: arxivAbsUrl(arxivId),
      snippet: entry.summary.slice(0, 300),
      sourceId: ARXIV_OAI_META.id,
      sourceName: ARXIV_OAI_META.name,
      publishedAt: entry.published?.slice(0, 10),
      score: 0,
      license: ARXIV_OAI_META.license,
      commercialUse: ARXIV_OAI_META.commercialUse,
    };
  }

  private toRawDocument(record: OaiArxivRecord): RawDocument {
    const arxivId = arxivExternalId(record.arxivId);
    return {
      sourceId: ARXIV_OAI_META.id,
      externalId: arxivId,
      rawJson: {
        title: record.title,
        abstract: record.abstract,
        arxiv_id: arxivId,
        identifier: record.identifier,
        datestamp: record.datestamp,
        publication_date: record.publishedAt,
        authors: record.authors.map((name) => ({ name })),
        categories: record.categories,
        url: arxivAbsUrl(arxivId),
        type: "preprint",
      },
      fetchedAt: new Date(),
    };
  }
}
