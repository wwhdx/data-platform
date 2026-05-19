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
import {
  buildEntrezCollectTerm,
  normalizeEntrezBaseUrl,
  parseEsummaryRecord,
  parseEfetchAbstractXml,
  type ESummaryRecord,
} from "./pubmedHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildPubMedCanonicalUrl,
  buildPubMedDocumentRequest,
  pubmedProvenanceConfig,
} from "./provenance/pubmed";

export const PUBMED_META: ConnectorMeta = {
  id: "pubmed",
  name: "PubMed / NCBI E-utilities",
  baseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
  license: "public domain (US gov)",
  commercialUse: true,
  authType: "query_param_key",
  rateLimit: "10/sec (with key)",
  description: "生物医学文献，E-utilities esearch → esummary + efetch(abstract)",
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
  readonly entrezDb: string;

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

  private provCfg() {
    return pubmedProvenanceConfig({
      root: this.root,
      entrezDb: this.entrezDb,
      userAgent: this.userAgent,
      apiKey: this.apiKey ?? process.env.NCBI_API_KEY,
    });
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
    let batchIndex = 0;

    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
      term,
    };

    while (retstart < total && yielded < maxItems) {
      if (params.signal?.aborted) break;

      const { records, batchCapture } = await this.esummaryHistory(
        first.webenv,
        first.querykey,
        retstart,
        Math.min(pageSize, maxItems - yielded),
      );

      // 补充摘要：efetch 批量获取 AbstractText（esummary 不含摘要）
      const batchUids = records.map(r => r.uid);
      const abstracts = await this.efetchAbstracts(batchUids);

      const batchRequest: HttpRequestCapture & {
        batchIndex: number;
        documentsInBatch: number;
        ephemeral: boolean;
      } = {
        ...batchCapture,
        ephemeral: true,
        batchIndex,
        documentsInBatch: records.length,
      };

      for (let documentIndexInBatch = 0; documentIndexInBatch < records.length; documentIndexInBatch++) {
        const rec = records[documentIndexInBatch]!;
        if (params.signal?.aborted) break;

        const abstract = abstracts.get(rec.uid);
        const doc = this.toRawDocument(rec, abstract);
        yield attachProvenance(doc, PUBMED_META, {
          documentRequest: buildPubMedDocumentRequest(rec.uid, this.provCfg()),
          batchRequest: {
            ...batchRequest,
            documentIndexInBatch,
          },
          collect: collectCtx,
          canonicalUrl: buildPubMedCanonicalUrl(rec.uid),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      retstart += pageSize;
      batchIndex++;
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
  ): Promise<{ records: ESummaryRecord[]; batchCapture: HttpRequestCapture }> {
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
    const batchCapture = this.consumeLastHttpCapture() ?? captureFromRequest(url, {
      headers: { "User-Agent": this.userAgent },
    });
    if (!res.ok) return { records: [], batchCapture };
    return {
      records: this.parseEsummaryJson(await res.json()),
      batchCapture,
    };
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

  /**
   * 批量获取 PubMed 摘要（efetch MedlineXML）。
   * esummary 不含 AbstractText；需单独调用此端点补充。
   * 失败时静默返回空 Map，不影响主采集路径。
   */
  private async efetchAbstracts(uids: string[]): Promise<Map<string, string>> {
    if (uids.length === 0) return new Map();
    const sp = new URLSearchParams({
      db: this.entrezDb,
      id: uids.join(","),
      rettype: "abstract",
      retmode: "xml",
    });
    const url = `${this.endpoint("efetch")}?${sp.toString()}${this.toolParam()}${this.apiKeyParam()}`;
    try {
      const res = await this.fetch(url);
      if (!res.ok) return new Map();
      const xml = await res.text();
      return parseEfetchAbstractXml(xml);
    } catch {
      return new Map();
    }
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

  private toRawDocument(rec: ESummaryRecord, abstract?: string): RawDocument {
    const rawJson = abstract ? { ...rec.raw, abstract } : rec.raw;
    return {
      sourceId: PUBMED_META.id,
      externalId: rec.uid,
      rawJson,
      fetchedAt: new Date(),
    };
  }
}
