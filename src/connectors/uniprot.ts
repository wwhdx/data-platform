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
  buildUniprotSearchUrl,
  assertUniprotOk,
  mapUniprotToRawJson,
  parseUniprotNextUrl,
  pickUniprotTitle,
  buildUniprotAbstract,
  uniprotExternalId,
  type UniprotEntry,
  type UniprotSearchResponse,
} from "./uniprotHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildUniprotCanonicalUrl,
  buildUniprotDocumentRequest,
} from "./provenance/uniprot";

export const UNIPROT_META: ConnectorMeta = {
  id: "uniprot",
  name: "UniProt",
  baseUrl: "https://rest.uniprot.org/",
  license: "CC BY 4.0",
  commercialUse: true,
  authType: "none",
  rateLimit: "polite (~3/sec)",
  description: "UniProt KB 蛋白序列与功能注释，REST 搜索",
};

export class UniprotConnector extends BaseConnector {
  readonly meta: ConnectorMeta = UNIPROT_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      UNIPROT_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(3, 334);
  }

  private async fetchSearchPage(
    query: string,
    size: number,
    cursor?: string,
  ): Promise<{ entries: UniprotEntry[]; nextUrl?: string }> {
    const url = buildUniprotSearchUrl(
      this.runtimeBaseUrl,
      query,
      size,
      cursor,
    );
    const res = await this.fetch(url);
    await assertUniprotOk(res);
    const body = (await res.json()) as UniprotSearchResponse;
    return {
      entries: body.results ?? [],
      nextUrl: parseUniprotNextUrl(res.headers.get("link")),
    };
  }

  private async fetchSearchByUrl(
    url: string,
  ): Promise<{ entries: UniprotEntry[]; nextUrl?: string }> {
    const res = await this.fetch(url);
    await assertUniprotOk(res);
    const body = (await res.json()) as UniprotSearchResponse;
    return {
      entries: body.results ?? [],
      nextUrl: parseUniprotNextUrl(res.headers.get("link")),
    };
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = Math.min(opts?.maxResults ?? 10, 100);
    const { entries } = await this.fetchSearchPage(q, limit);
    return entries.slice(0, limit).map((entry) => this.toSearchResult(entry));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    const q =
      params.query?.trim() ||
      String(this.sourceOptions.default_collect_query ?? "insulin").trim();
    let nextUrl: string | undefined;
    let yielded = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;
      const pageSize = Math.min(100, maxItems - yielded);
      const page = nextUrl
        ? await this.fetchSearchByUrl(nextUrl)
        : await this.fetchSearchPage(q, pageSize);
      const entries = page.entries;
      nextUrl = page.nextUrl;

      if (entries.length === 0) break;

      for (const entry of entries) {
        if (params.signal?.aborted) break;
        const { externalId, rawJson } = mapUniprotToRawJson(entry);
        const accession = entry.primaryAccession?.trim() || externalId;
        const doc: RawDocument = {
          sourceId: UNIPROT_META.id,
          externalId,
          rawJson,
          fetchedAt: new Date(),
        };
        yield attachProvenance(doc, UNIPROT_META, {
          documentRequest: buildUniprotDocumentRequest(
            accession,
            this.runtimeBaseUrl,
            this.userAgent,
          ),
          collect: collectCtx,
          canonicalUrl: buildUniprotCanonicalUrl(accession),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      if (!nextUrl || entries.length < pageSize) break;
    }
  }

  private toSearchResult(entry: UniprotEntry): SearchResult {
    const accession = entry.primaryAccession?.trim() || uniprotExternalId(entry);
    const abstract = buildUniprotAbstract(entry);
    return {
      title: pickUniprotTitle(entry),
      url: `https://www.uniprot.org/uniprotkb/${accession}`,
      snippet: abstract.slice(0, 300),
      sourceId: UNIPROT_META.id,
      sourceName: UNIPROT_META.name,
      score: 0,
      license: UNIPROT_META.license,
      commercialUse: UNIPROT_META.commercialUse,
    };
  }
}
