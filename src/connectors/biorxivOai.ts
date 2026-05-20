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
  buildDetailsUrl,
  buildDoiLookupUrl,
  biorxivContentUrl,
  biorxivExternalId,
  isoDateDaysAgo,
  looksLikeDoi,
  parseAuthorsList,
  parseBiorxivDetailsJson,
  paperMatchesQuery,
  resolveBiorxivServer,
  todayIsoDate,
  type BiorxivPaper,
} from "./biorxivOaiHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildBiorxivCanonicalUrl,
  buildBiorxivDocumentRequest,
} from "./provenance/biorxivOai";

export const BIORXIV_OAI_META: ConnectorMeta = {
  id: "biorxiv_oai",
  name: "bioRxiv (OAI-PMH API)",
  baseUrl: "https://api.biorxiv.org",
  license: "varies (per preprint; often CC-BY-NC)",
  commercialUse: false,
  authType: "none",
  rateLimit: ">=2s interval",
  description:
    "bioRxiv 预印本；ListRecords 经 api.biorxiv.org/details（JSON），非 www Cloudflare OAI",
};

export class BiorxivOaiConnector extends BaseConnector {
  readonly meta: ConnectorMeta = BIORXIV_OAI_META;
  private readonly server: string;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      BIORXIV_OAI_META.baseUrl,
    );
    this.server = resolveBiorxivServer(this.sourceOptions);
    this.rateLimiter = RateLimiter.fromRPS(1, 2000);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const q = query.trim();
    if (!q) return [];

    if (looksLikeDoi(q)) {
      const paper = await this.fetchPaperByDoi(q);
      return paper ? [this.toSearchResult(paper)] : [];
    }

    const from = isoDateDaysAgo(30);
    const to = todayIsoDate();
    const page = await this.fetchDetailsPage(from, to, 0);
    return page.papers
      .filter((p) => paperMatchesQuery(p, q))
      .slice(0, maxResults)
      .map((p) => this.toSearchResult(p));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const since =
      params.since ??
      new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const to = todayIsoDate();
    const maxItems = params.maxItems ?? Infinity;
    let yielded = 0;
    let cursor = 0;
    let batchIndex = 0;

    const collectCtx = {
      mode: "incremental" as const,
      since,
      query: params.query,
    };

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const page = await this.fetchDetailsPage(since, to, cursor);
      const batchCapture = this.consumeLastHttpCapture();
      if (!batchCapture) {
        throw new Error("bioRxiv collect: missing HTTP capture for batch");
      }

      const batchRequest: HttpRequestCapture & {
        batchIndex: number;
        documentsInBatch: number;
        ephemeral: boolean;
      } = {
        ...batchCapture,
        ephemeral: batchIndex > 0,
        batchIndex,
        documentsInBatch: page.papers.length,
      };

      if (page.papers.length === 0) break;

      for (let i = 0; i < page.papers.length; i++) {
        if (params.signal?.aborted) break;
        const paper = page.papers[i]!;
        if (params.query && !paperMatchesQuery(paper, params.query)) continue;

        const doc = this.toRawDocument(paper);
        const doi = doc.externalId;
        yield attachProvenance(doc, BIORXIV_OAI_META, {
          documentRequest: buildBiorxivDocumentRequest(
            doi,
            paper.version,
            this.userAgent,
          ),
          batchRequest: { ...batchRequest, documentIndexInBatch: i },
          collect: collectCtx,
          canonicalUrl: buildBiorxivCanonicalUrl(doi, paper.version),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      cursor += page.papers.length;
      if (cursor >= page.total) break;
      batchIndex++;
    }
  }

  private async fetchDetailsPage(
    from: string,
    to: string,
    cursor: number,
  ): Promise<ReturnType<typeof parseBiorxivDetailsJson>> {
    const url = buildDetailsUrl(this.server, from, to, cursor, "json");
    const res = await this.fetch(url);
    if (!res.ok) {
      throw new Error(`bioRxiv details failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      collection?: BiorxivPaper[];
      messages?: Array<Record<string, unknown>>;
    };
    const status = String(body.messages?.[0]?.status ?? "");
    if (status && status !== "ok") {
      throw new Error(`bioRxiv API: ${status}`);
    }
    return parseBiorxivDetailsJson(body);
  }

  private async fetchPaperByDoi(doi: string): Promise<BiorxivPaper | null> {
    const url = buildDoiLookupUrl(this.server, doi);
    const res = await this.fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { collection?: BiorxivPaper[] };
    return body.collection?.[0] ?? null;
  }

  private toSearchResult(paper: BiorxivPaper): SearchResult {
    const doi = biorxivExternalId(paper.doi);
    return {
      title: paper.title,
      url: biorxivContentUrl(doi, paper.version),
      snippet: paper.abstract.slice(0, 300),
      sourceId: BIORXIV_OAI_META.id,
      sourceName: BIORXIV_OAI_META.name,
      publishedAt: paper.date?.slice(0, 10),
      score: 0,
      license: paper.license ?? BIORXIV_OAI_META.license,
      commercialUse: BIORXIV_OAI_META.commercialUse,
    };
  }

  private toRawDocument(paper: BiorxivPaper): RawDocument {
    const doi = biorxivExternalId(paper.doi);
    return {
      sourceId: BIORXIV_OAI_META.id,
      externalId: doi,
      rawJson: {
        title: paper.title,
        abstract: paper.abstract,
        doi,
        publication_date: paper.date,
        datestamp: paper.date,
        authors: parseAuthorsList(paper.authors),
        category: paper.category,
        license: paper.license,
        server: paper.server ?? this.server,
        version: paper.version,
        url: biorxivContentUrl(doi, paper.version),
        type: "preprint",
      },
      fetchedAt: new Date(),
    };
  }
}
