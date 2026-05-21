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
import { validateCredentialsForCollect } from "./credentials";
import {
  buildCoreCollectQuery,
  buildCoreSearchQuery,
  coreExternalId,
  mapCoreOutputToRawJson,
  parseCoreSearchResponse,
  pickCoreAbstract,
  pickCorePublishedAt,
  pickCoreTitle,
  pickCoreUrl,
  type CoreOutput,
  type CoreSearchResponse,
} from "./coreHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildCoreCanonicalUrl,
  buildCoreDocumentRequest,
} from "./provenance/core";

export const CORE_META: ConnectorMeta = {
  id: "core",
  name: "CORE",
  baseUrl: "https://api.core.ac.uk/v3",
  license: "varies (OA aggregation; attribution required)",
  commercialUse: true,
  authType: "header_bearer",
  rateLimit: "token bucket (registered users)",
  description: "4亿+ 开放论文元数据与全文索引，补 CrossRef 全文缺口",
};

export class CoreConnector extends BaseConnector {
  readonly meta: ConnectorMeta = CORE_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        timeoutMs: config.timeoutMs ?? 120_000,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      CORE_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(1, 2000);
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey?.trim()) {
      // CORE v3 PHP 栈对 scheme「Bearer」大小写敏感，须小写 bearer（curl 实测 Bearer→500）
      headers.Authorization = `bearer ${this.apiKey.trim()}`;
    }
    return headers;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];

    if (/^\d+$/.test(q)) {
      const output = await this.fetchOutputById(q);
      return output ? [this.toSearchResult(output)] : [];
    }

    const maxResults = opts?.maxResults ?? 10;
    const searchQ = buildCoreSearchQuery(q);
    const page = await this.searchOutputsPage(searchQ, 0, maxResults);
    return page.results.slice(0, maxResults).map((o) => this.toSearchResult(o));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(CORE_META.id, this.apiKey);
    if (credErr) throw new Error(credErr);

    const since =
      params.since ??
      new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const maxItems = params.maxItems ?? Infinity;
    const userQuery = this.resolveCollectQuery(params.query);
    const q = buildCoreCollectQuery(userQuery, since);
    let offset = 0;
    const pageSize = 100;
    let yielded = 0;
    let batchIndex = 0;

    const collectCtx = {
      mode: "incremental" as const,
      since,
      query: params.query,
    };

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const remaining = maxItems - yielded;
      const limit = Math.min(pageSize, remaining);
      const page = await this.searchOutputsPage(q, offset, limit);
      const batchCapture = this.consumeLastHttpCapture();
      if (!batchCapture || page.results.length === 0) break;

      const batchRequest: HttpRequestCapture & {
        batchIndex: number;
        documentsInBatch: number;
        ephemeral: boolean;
      } = {
        ...batchCapture,
        ephemeral: offset > 0,
        batchIndex,
        documentsInBatch: page.results.length,
      };

      for (
        let documentIndexInBatch = 0;
        documentIndexInBatch < page.results.length;
        documentIndexInBatch++
      ) {
        const output = page.results[documentIndexInBatch]!;
        if (params.signal?.aborted) break;

        const doc = this.toRawDocument(output);
        yield attachProvenance(doc, CORE_META, {
          documentRequest: buildCoreDocumentRequest(
            doc.externalId,
            this.runtimeBaseUrl,
            this.userAgent,
            this.apiKey,
          ),
          batchRequest: { ...batchRequest, documentIndexInBatch },
          collect: collectCtx,
          canonicalUrl: buildCoreCanonicalUrl(
            doc.externalId,
            typeof doc.rawJson.doi === "string" ? doc.rawJson.doi : undefined,
          ),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      offset += page.results.length;
      if (offset >= page.totalHits || page.results.length < limit) break;
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
    return "machine learning";
  }

  private async fetchOutputById(id: string): Promise<CoreOutput | null> {
    const url = `${this.runtimeBaseUrl.replace(/\/$/, "")}/outputs/${encodeURIComponent(id)}`;
    const res = await this.fetch(url, { headers: this.authHeaders() });
    if (this.apiKey) this.assertAuthorizedResponse(res);
    if (!res.ok) return null;
    return (await res.json()) as CoreOutput;
  }

  private async searchOutputsPage(
    q: string,
    offset: number,
    limit: number,
  ): Promise<{ results: CoreOutput[]; totalHits: number }> {
    const sp = new URLSearchParams({
      q,
      offset: String(offset),
      limit: String(Math.min(limit, 100)),
    });
    const url = `${this.runtimeBaseUrl.replace(/\/$/, "")}/search/outputs?${sp}`;
    const res = await this.fetch(url, { headers: this.authHeaders() });
    if (this.apiKey) this.assertAuthorizedResponse(res);
    if (res.status === 429) {
      throw new Error(
        "CORE rate limited (HTTP 429): token bucket exhausted; wait a few minutes and retry",
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `CORE search/outputs failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    const body = (await res.json()) as CoreSearchResponse;
    return parseCoreSearchResponse(body);
  }

  private toSearchResult(output: CoreOutput): SearchResult {
    const abstract = pickCoreAbstract(output);
    return {
      title: pickCoreTitle(output),
      url: pickCoreUrl(output),
      snippet: abstract.slice(0, 300),
      sourceId: CORE_META.id,
      sourceName: CORE_META.name,
      publishedAt: pickCorePublishedAt(output),
      score: 0,
      license: output.license?.trim() || CORE_META.license,
      commercialUse: CORE_META.commercialUse,
    };
  }

  private toRawDocument(output: CoreOutput): RawDocument {
    return {
      sourceId: CORE_META.id,
      externalId: coreExternalId(output),
      rawJson: mapCoreOutputToRawJson(output),
      fetchedAt: new Date(),
    };
  }
}
