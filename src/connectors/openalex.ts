import type { ConnectorMeta, ConnectorConfig, RawDocument, SearchResult, CollectParams, SearchOptions } from "../types";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";

const META: ConnectorMeta = {
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
  abstract?: string;
  authorships?: Array<{ author: { id: string; display_name: string } }>;
  publication_date?: string;
  cited_by_count?: number;
  primary_location?: { landing_page_url?: string; pdf_url?: string };
  concepts?: Array<{ id: string; display_name: string; score: number }>;
  type?: string;
}

export class OpenAlexConnector extends BaseConnector {
  readonly meta: ConnectorMeta = META;

  constructor(config: ConnectorConfig = {}) {
    super({
      ...config,
      userAgent: config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
    });
    this.rateLimiter = RateLimiter.fromDailyLimit(100_000);
  }

  private get authParam(): string {
    return this.apiKey ? `&api_key=${this.apiKey}` : "";
  }

  // ── 搜索 ──

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const url = `${META.baseUrl}/works?search=${encodeURIComponent(query)}&per_page=${maxResults}${this.authParam}`;

    const res = await this.fetch(url);
    if (!res.ok) return [];

    const data = await res.json() as { results?: OAWORK[] };
    return (data.results ?? []).map(w => this.toSearchResult(w));
  }

  // ── 增量采集 ──

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const since = params.since ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const maxItems = params.maxItems ?? Infinity;
    let yielded = 0;

    const baseUrl = `${META.baseUrl}/works?filter=from_publication_date:${since}&per_page=200${this.authParam}`;

    for await (const doc of this.paginate<RawDocument>(
      async (cursor) => {
        const url = cursor ? `${baseUrl}&cursor=${encodeURIComponent(cursor)}` : baseUrl;
        const res = await this.fetch(url);
        if (!res.ok) return { items: [], nextCursor: null };

        const data = await res.json() as {
          results?: OAWORK[];
          meta?: { next_cursor?: string };
        };

        const items = (data.results ?? []).map(w => this.toRawDocument(w));

        return {
          items,
          nextCursor: data.meta?.next_cursor ?? null,
        };
      },
    )) {
      if (params.signal?.aborted) break;
      yield doc;
      yielded++;
      if (yielded >= maxItems) break;
    }
  }

  // ── 数据映射 ──

  private toSearchResult(work: OAWORK): SearchResult {
    const doi = work.doi ?? "";
    const url = doi ? `https://doi.org/${doi}` : (work.primary_location?.landing_page_url ?? work.id);

    return {
      title: work.title ?? "Untitled",
      url,
      snippet: (work.abstract ?? "").slice(0, 300),
      sourceId: META.id,
      sourceName: META.name,
      publishedAt: work.publication_date,
      score: work.cited_by_count ?? 0,
      license: META.license,
      commercialUse: META.commercialUse,
    };
  }

  private toRawDocument(work: OAWORK): RawDocument {
    const extId = work.id.startsWith("https://") ? new URL(work.id).pathname.replace("/", "") : work.id;
    return {
      sourceId: META.id,
      externalId: extId,
      rawJson: work as unknown as Record<string, unknown>,
      fetchedAt: new Date(),
    };
  }
}
