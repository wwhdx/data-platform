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
  WIPO_SEARCH_BASE,
  WIPO_RESULTS_PER_PAGE,
  buildWipoSearchUrl,
  buildWipoCollectQuery,
  defaultWipoCollectSince,
  parseWipoResultHtml,
  mapWipoHitToRawJson,
  assertWipoOk,
  buildWipoCanonicalUrl,
} from "./wipoHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildWipoBatchRequest,
  buildWipoCanonicalUrlFromRaw,
  buildWipoDocumentRequest,
} from "./provenance/wipo";

export const WIPO_META: ConnectorMeta = {
  id: "wipo",
  name: "WIPO PATENTSCOPE",
  baseUrl: WIPO_SEARCH_BASE,
  license: "WIPO terms (public HTML search)",
  commercialUse: false,
  authType: "none",
  rateLimit: "polite (~1/sec; 10 results/page)",
  description: "PCT/WO 专利 HTML 搜索（与 epo_ops 互补；付费 SOAP 见 PCT Webservice）",
};

export class WipoConnector extends BaseConnector {
  readonly meta: ConnectorMeta = WIPO_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
        timeoutMs: config.timeoutMs ?? 60_000,
      },
      WIPO_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(1, 1000);
  }

  private officeFilter(): string {
    const office = this.sourceOptions.office;
    return typeof office === "string" && office.trim() ? office.trim() : "WO";
  }

  private async fetchResultPage(query: string): Promise<string> {
    const url = buildWipoSearchUrl(this.runtimeBaseUrl, query, {
      office: this.officeFilter(),
    });
    const res = await this.fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    await assertWipoOk(res);
    return res.text();
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = Math.min(opts?.maxResults ?? 10, WIPO_RESULTS_PER_PAGE);
    const html = await this.fetchResultPage(
      buildWipoCollectQuery({ query: q, since: defaultWipoCollectSince(365) }),
    );
    const hits = parseWipoResultHtml(html).slice(0, limit);
    return hits.map((hit) => {
      const { rawJson } = mapWipoHitToRawJson(hit);
      return {
        title: String(rawJson.title),
        url: String(rawJson.url ?? ""),
        snippet: String(rawJson.abstract ?? "").slice(0, 300),
        sourceId: WIPO_META.id,
        sourceName: WIPO_META.name,
        publishedAt: rawJson.publication_date as string | undefined,
        score: 1,
        license: WIPO_META.license,
        commercialUse: WIPO_META.commercialUse,
      };
    });
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    const keyword =
      params.query?.trim() ||
      String(this.sourceOptions.default_collect_query ?? "").trim();
    const sinceDays = Number(this.sourceOptions.default_collect_since_days ?? 365);
    const since =
      params.since?.trim() ||
      defaultWipoCollectSince(Number.isFinite(sinceDays) ? sinceDays : 365);

    const q = buildWipoCollectQuery({ query: keyword || undefined, since });
    const html = await this.fetchResultPage(q);
    const hits = parseWipoResultHtml(html).slice(0, maxItems);
    const batchRequest = {
      ...buildWipoBatchRequest(this.runtimeBaseUrl, q, this.officeFilter()),
      batchIndex: 0,
      documentsInBatch: hits.length,
      ephemeral: false,
    };
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };
    const now = new Date();

    for (let documentIndexInBatch = 0; documentIndexInBatch < hits.length; documentIndexInBatch++) {
      const hit = hits[documentIndexInBatch]!;
      if (params.signal?.aborted) break;
      const { externalId, rawJson } = mapWipoHitToRawJson(hit);
      const doc: RawDocument = {
        sourceId: WIPO_META.id,
        externalId,
        rawJson: {
          ...rawJson,
          canonical_url: buildWipoCanonicalUrl(externalId),
          collect_query: q,
        },
        fetchedAt: now,
      };
      yield attachProvenance(doc, WIPO_META, {
        documentRequest: buildWipoDocumentRequest(externalId),
        batchRequest: { ...batchRequest, documentIndexInBatch },
        collect: collectCtx,
        canonicalUrl: buildWipoCanonicalUrlFromRaw(doc.rawJson),
      });
    }
  }
}
