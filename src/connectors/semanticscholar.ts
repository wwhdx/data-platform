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
import { attachProvenance } from "./provenance/attach";
import {
  buildSemanticScholarBatchRequest,
  buildSemanticScholarCanonicalUrl,
  buildSemanticScholarDocumentRequest,
} from "./provenance/semanticscholar";

/** 有 Key 默认 1 RPS（semanticscholar.org/product/api/tutorial）；无 Key 共享 5000/5min（github.com/allenai/s2-folks API_RELEASE_NOTES） */

export const SEMANTIC_SCHOLAR_META: ConnectorMeta = {
  id: "semanticscholar",
  name: "Semantic Scholar",
  baseUrl: "https://api.semanticscholar.org/graph/v1",
  license: "non-commercial free",
  commercialUse: false,
  authType: "header_custom",
  rateLimit: "1 RPS (authenticated default) · 5000/5min (unauthenticated pool)",
  description: "2亿+ 论文与引用图，abstract + tldr 可直接用于 RAG",
};

const PAPER_FIELDS =
  "paperId,externalIds,title,abstract,year,citationCount,authors,url,publicationVenue,tldr,publicationDate";

interface S2Author {
  authorId?: string;
  name?: string;
}

interface S2Paper {
  paperId: string;
  externalIds?: Record<string, string[]>;
  title?: string;
  abstract?: string;
  year?: number;
  citationCount?: number;
  authors?: S2Author[];
  url?: string;
  publicationVenue?: { name?: string };
  tldr?: { text?: string };
  publicationDate?: string;
}

interface S2SearchResponse {
  total?: number;
  offset?: number;
  next?: number;
  data?: S2Paper[];
}

export class SemanticScholarConnector extends BaseConnector {
  readonly meta: ConnectorMeta = SEMANTIC_SCHOLAR_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      SEMANTIC_SCHOLAR_META.baseUrl,
    );
    // 官方默认 1 RPS（有/无 Key 均保守）；提额见 semanticscholar.org/product/api#api-key-form
    this.rateLimiter = RateLimiter.fromRPS(1, 1000);
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { "x-api-key": this.apiKey } : {};
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const params = new URLSearchParams({
      query,
      offset: "0",
      limit: String(Math.min(maxResults, 100)),
      fields: PAPER_FIELDS,
    });
    if (opts?.filters?.dateFrom) {
      params.set("publicationDateOrYear", `${opts.filters.dateFrom}:`);
    }

    const url = `${this.runtimeBaseUrl}/paper/search?${params}`;
    const res = await this.fetch(url, { headers: this.authHeaders() });
    if (this.apiKey) this.assertAuthorizedResponse(res);
    if (!res.ok) return [];

    const body = (await res.json()) as S2SearchResponse;
    return (body.data ?? []).map((p) => this.toSearchResult(p));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const since =
      params.since ??
      new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const searchQuery = this.resolveCollectQuery(params.query);
    const maxItems = params.maxItems ?? Infinity;
    const pageSize = 100;
    let offset = 0;
    let yielded = 0;
    let batchIndex = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since ?? since,
      query: params.query,
    };

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const remaining = maxItems - yielded;
      const limit = Math.min(pageSize, remaining);
      const sp = new URLSearchParams({
        query: searchQuery,
        offset: String(offset),
        limit: String(limit),
        fields: PAPER_FIELDS,
        publicationDateOrYear: `${since}:`,
      });

      const url = `${this.runtimeBaseUrl}/paper/search?${sp}`;
      const res = await this.fetch(url, { headers: this.authHeaders() });
      if (this.apiKey) this.assertAuthorizedResponse(res);
      if (!res.ok) break;

      const body = (await res.json()) as S2SearchResponse;
      const papers = body.data ?? [];
      if (papers.length === 0) break;

      const batchRequest = {
        ...buildSemanticScholarBatchRequest(
          this.runtimeBaseUrl,
          this.userAgent,
          {
            query: searchQuery,
            offset,
            limit,
            since,
            apiKey: this.apiKey,
          },
        ),
        batchIndex,
        documentsInBatch: papers.length,
        ephemeral: batchIndex > 0,
      };

      for (let documentIndexInBatch = 0; documentIndexInBatch < papers.length; documentIndexInBatch++) {
        if (params.signal?.aborted) break;
        const paper = papers[documentIndexInBatch]!;
        const doc = this.toRawDocument(paper);
        yield attachProvenance(doc, SEMANTIC_SCHOLAR_META, {
          documentRequest: buildSemanticScholarDocumentRequest(
            paper.paperId,
            this.runtimeBaseUrl,
            this.userAgent,
            this.apiKey,
          ),
          batchRequest: { ...batchRequest, documentIndexInBatch },
          collect: collectCtx,
          canonicalUrl: buildSemanticScholarCanonicalUrl(doc.rawJson, paper.paperId),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      const total = body.total ?? 0;
      const nextOffset = body.next ?? offset + papers.length;
      if (nextOffset >= total || papers.length < limit) break;
      offset = nextOffset;
      batchIndex++;
    }
  }

  private resolveCollectQuery(query?: string): string {
    const q = query?.trim();
    if (q) return q;
    const fromOptions = String(
      this.sourceOptions.default_collect_query ?? "",
    ).trim();
    if (fromOptions) return fromOptions;
    return "science";
  }

  private toSearchResult(paper: S2Paper): SearchResult {
    const abstract = pickAbstract(paper);
    return {
      title: pickTitle(paper),
      url: paperUrl(paper),
      snippet: abstract.slice(0, 300),
      sourceId: SEMANTIC_SCHOLAR_META.id,
      sourceName: SEMANTIC_SCHOLAR_META.name,
      publishedAt: pickPublishedAt(paper),
      score: paper.citationCount ?? 0,
      license: SEMANTIC_SCHOLAR_META.license,
      commercialUse: SEMANTIC_SCHOLAR_META.commercialUse,
    };
  }

  private toRawDocument(paper: S2Paper): RawDocument {
    const title = pickTitle(paper);
    const abstract = pickAbstract(paper);
    return {
      sourceId: SEMANTIC_SCHOLAR_META.id,
      externalId: paper.paperId,
      rawJson: {
        ...(paper as unknown as Record<string, unknown>),
        title,
        abstract,
      },
      fetchedAt: new Date(),
    };
  }
}

function pickTitle(paper: S2Paper): string {
  const t = paper.title?.trim();
  return t && t.length > 0 ? t : "Untitled";
}

function pickAbstract(paper: S2Paper): string {
  const abs = paper.abstract?.trim();
  if (abs) return abs;
  const tldr = paper.tldr?.text?.trim();
  return tldr ?? "";
}

function pickPublishedAt(paper: S2Paper): string | undefined {
  if (paper.publicationDate) return paper.publicationDate;
  if (paper.year != null) return `${paper.year}-01-01`;
  return undefined;
}

function paperUrl(paper: S2Paper): string {
  if (paper.url) return paper.url;
  return `https://www.semanticscholar.org/paper/${paper.paperId}`;
}
