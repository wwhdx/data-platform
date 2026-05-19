import type {
  ConnectorMeta,
  ConnectorConfig,
  RawDocument,
  SearchResult,
  CollectParams,
  SearchOptions,
  HttpRequestCapture,
} from "../types";
import { captureFromRequest } from "../lib/httpCapture";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";
import { attachProvenance } from "./provenance/attach";
import {
  buildOpenAlexCanonicalUrl,
  buildOpenAlexDocumentRequest,
} from "./provenance/openalex";

export const OPENALEX_META: ConnectorMeta = {
  id: "openalex",
  name: "OpenAlex",
  baseUrl: "https://api.openalex.org",
  license: "CC0",
  commercialUse: true,
  authType: "query_param_key",
  rateLimit: "100000/day",
  description: "2.4亿+ 学术作品元数据，含作者、机构、引用、主题",
};

interface OAWORK {
  id: string;
  doi?: string;
  title: string;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: Array<{ author: { id: string; display_name: string } }>;
  publication_date?: string;
  cited_by_count?: number;
  primary_location?: { landing_page_url?: string; pdf_url?: string };
  concepts?: Array<{ id: string; display_name: string; score: number }>;
  type?: string;
}

/**
 * 将 OpenAlex 倒排索引格式的摘要还原为字符串。
 * 输入：{ "word": [position, ...], ... }
 * 输出：按位置排序的单词拼接结果
 */
function uninvertAbstract(inv: Record<string, number[]> | undefined): string {
  if (!inv) return "";
  const positions: [number, string][] = [];
  for (const [word, idxs] of Object.entries(inv)) {
    for (const idx of idxs) positions.push([idx, word]);
  }
  return positions.sort((a, b) => a[0] - b[0]).map(p => p[1]).join(" ");
}

export class OpenAlexConnector extends BaseConnector {
  readonly meta: ConnectorMeta = OPENALEX_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      OPENALEX_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromDailyLimit(100_000);
  }

  private get authParam(): string {
    return this.apiKey ? `&api_key=${this.apiKey}` : "";
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const url = `${this.runtimeBaseUrl}/works?search=${encodeURIComponent(query)}&per_page=${maxResults}${this.authParam}`;

    const res = await this.fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as { results?: OAWORK[] };
    return (data.results ?? []).map((w) => this.toSearchResult(w));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const since = params.since ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const maxItems = params.maxItems ?? Infinity;
    let yielded = 0;
    let batchIndex = 0;

    const baseUrl = `${this.runtimeBaseUrl}/works?filter=from_publication_date:${since}&per_page=200${this.authParam}`;
    let cursor: string | undefined;

    const collectCtx = {
      mode: "incremental" as const,
      since,
      query: params.query,
    };

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const url = cursor ? `${baseUrl}&cursor=${encodeURIComponent(cursor)}` : baseUrl;
      const res = await this.fetch(url);
      const batchCapture =
        this.consumeLastHttpCapture() ??
        captureFromRequest(url, { headers: { "User-Agent": this.userAgent } });

      if (!res.ok) break;

      const data = (await res.json()) as {
        results?: OAWORK[];
        meta?: { next_cursor?: string };
      };

      const works = data.results ?? [];
      if (works.length === 0) break;

      const batchRequest: HttpRequestCapture & {
        batchIndex: number;
        documentsInBatch: number;
        ephemeral: boolean;
      } = {
        ...batchCapture,
        ephemeral: Boolean(cursor),
        batchIndex,
        documentsInBatch: works.length,
      };

      for (let documentIndexInBatch = 0; documentIndexInBatch < works.length; documentIndexInBatch++) {
        const work = works[documentIndexInBatch]!;
        if (params.signal?.aborted) break;

        const doc = this.toRawDocument(work);
        const extId = doc.externalId;
        yield attachProvenance(doc, OPENALEX_META, {
          documentRequest: buildOpenAlexDocumentRequest(
            extId,
            this.runtimeBaseUrl,
            this.userAgent,
            this.apiKey,
          ),
          batchRequest: { ...batchRequest, documentIndexInBatch },
          collect: collectCtx,
          canonicalUrl: buildOpenAlexCanonicalUrl(extId, doc.rawJson),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      cursor = data.meta?.next_cursor ?? undefined;
      if (!cursor) break;
      batchIndex++;
    }
  }

  private toSearchResult(work: OAWORK): SearchResult {
    const doi = work.doi ?? "";
    const url = doi ? `https://doi.org/${doi}` : (work.primary_location?.landing_page_url ?? work.id);
    const abstract = uninvertAbstract(work.abstract_inverted_index);

    return {
      title: work.title ?? "Untitled",
      url,
      snippet: abstract.slice(0, 300),
      sourceId: OPENALEX_META.id,
      sourceName: OPENALEX_META.name,
      publishedAt: work.publication_date,
      score: work.cited_by_count ?? 0,
      license: OPENALEX_META.license,
      commercialUse: OPENALEX_META.commercialUse,
    };
  }

  private toRawDocument(work: OAWORK): RawDocument {
    const extId = work.id.startsWith("https://")
      ? new URL(work.id).pathname.replace("/", "")
      : work.id;
    const abstract = uninvertAbstract(work.abstract_inverted_index);
    const rawJson = work as unknown as Record<string, unknown>;
    return {
      sourceId: OPENALEX_META.id,
      externalId: extId,
      rawJson: abstract ? { ...rawJson, abstract } : rawJson,
      fetchedAt: new Date(),
    };
  }
}
