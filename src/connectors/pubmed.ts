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
  buildEntrezCollectTerm,
  normalizeEntrezBaseUrl,
  parseEsummaryRecord,
  type ESummaryRecord,
} from "./pubmedHelpers";

export const PUBMED_META: ConnectorMeta = {
  id: "pubmed",
  name: "PubMed / NCBI E-utilities",
  baseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
  license: "public domain (US gov)",
  commercialUse: true,
  authType: "query_param_key",
  rateLimit: "10/sec (with key)",
  description: "生物医学文献，E-utilities esearch → esummary",
};

interface ESearchResult {
  count?: string;
  retmax?: string;
  retstart?: string;
  idlist?: string[];
  webenv?: string;
  querykey?: string;
}

export class PubMedConnector extends BaseConnector {
  readonly meta: ConnectorMeta = PUBMED_META;
  private readonly root: string;
  private readonly entrezDb: string;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ??
          "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      PUBMED_META.baseUrl,
    );
    this.root = normalizeEntrezBaseUrl(this.runtimeBaseUrl);
    this.entrezDb = String(
      config.sourceOptions?.entrez_db ??
        this.sourceOptions.entrez_db ??
        "pubmed",
    );
    const hasKey = Boolean(config.apiKey ?? process.env.NCBI_API_KEY);
    this.rateLimiter = RateLimiter.fromRPS(hasKey ? 10 : 3);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const search = await this.esearch(query, { retmax: maxResults });
    const ids = search.idlist ?? [];
    if (ids.length === 0) return [];

    const summaries = await this.esummaryByIds(ids);
    return summaries.map((r) => this.toSearchResult(r));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const term = buildEntrezCollectTerm(params);
    const maxItems = params.maxItems ?? Infinity;
    let yielded = 0;

    const first = await this.esearch(term, {
      retmax: Math.min(500, maxItems),
      usehistory: true,
    });
    const total = parseInt(first.count ?? "0", 10);
    if (total === 0 || !first.webenv || !first.querykey) return;

    let retstart = 0;
    const pageSize = 200;

    while (retstart < total && yielded < maxItems) {
      if (params.signal?.aborted) break;

      const batch = await this.esummaryHistory(
        first.webenv,
        first.querykey,
        retstart,
        Math.min(pageSize, maxItems - yielded),
      );

      for (const rec of batch) {
        if (params.signal?.aborted) break;
        yield this.toRawDocument(rec);
        yielded++;
        if (yielded >= maxItems) break;
      }

      retstart += pageSize;
    }
  }

  private apiKeyParam(): string {
    const key = this.apiKey ?? process.env.NCBI_API_KEY;
    return key ? `&api_key=${encodeURIComponent(key)}` : "";
  }

  private toolParam(): string {
    return "&tool=WangyeDataPlatform";
  }

  private endpoint(tool: string): string {
    return `${this.root}${tool}.fcgi`;
  }

  private async esearch(
    term: string,
    opts: { retmax?: number; usehistory?: boolean },
  ): Promise<ESearchResult> {
    const sp = new URLSearchParams({
      db: this.entrezDb,
      term,
      retmode: "json",
      retmax: String(opts.retmax ?? 20),
    });
    if (opts.usehistory) sp.set("usehistory", "y");

    const url = `${this.endpoint("esearch")}?${sp.toString()}${this.toolParam()}${this.apiKeyParam()}`;
    const res = await this.fetch(url);
    if (!res.ok) return {};

    const data = (await res.json()) as {
      esearchresult?: ESearchResult;
    };
    return data.esearchresult ?? {};
  }

  private async esummaryByIds(ids: string[]): Promise<ESummaryRecord[]> {
    if (ids.length === 0) return [];
    const sp = new URLSearchParams({
      db: this.entrezDb,
      id: ids.join(","),
      retmode: "json",
    });
    const url = `${this.endpoint("esummary")}?${sp.toString()}${this.toolParam()}${this.apiKeyParam()}`;
    const res = await this.fetch(url);
    if (!res.ok) return [];
    return this.parseEsummaryJson(await res.json());
  }

  private async esummaryHistory(
    webenv: string,
    queryKey: string,
    retstart: number,
    retmax: number,
  ): Promise<ESummaryRecord[]> {
    const sp = new URLSearchParams({
      db: this.entrezDb,
      query_key: queryKey,
      WebEnv: webenv,
      retmode: "json",
      retstart: String(retstart),
      retmax: String(retmax),
    });
    const url = `${this.endpoint("esummary")}?${sp.toString()}${this.toolParam()}${this.apiKeyParam()}`;
    const res = await this.fetch(url);
    if (!res.ok) return [];
    return this.parseEsummaryJson(await res.json());
  }

  private parseEsummaryJson(data: unknown): ESummaryRecord[] {
    const root = data as { result?: Record<string, unknown> };
    const result = root.result;
    if (!result) return [];
    const uids = result.uids as string[] | undefined;
    if (!uids) return [];
    return uids
      .map((uid) => parseEsummaryRecord(uid, result[uid]))
      .filter((r): r is ESummaryRecord => r != null);
  }

  private toSearchResult(rec: ESummaryRecord): SearchResult {
    return {
      title: rec.title,
      url: `https://pubmed.ncbi.nlm.nih.gov/${rec.uid}/`,
      snippet: rec.snippet.slice(0, 300),
      sourceId: PUBMED_META.id,
      sourceName: PUBMED_META.name,
      publishedAt: rec.pubdate,
      score: 0,
      license: PUBMED_META.license,
      commercialUse: PUBMED_META.commercialUse,
    };
  }

  private toRawDocument(rec: ESummaryRecord): RawDocument {
    return {
      sourceId: PUBMED_META.id,
      externalId: rec.uid,
      rawJson: rec.raw,
      fetchedAt: new Date(),
    };
  }
}
