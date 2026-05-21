import type {
  ConnectorMeta,
  ConnectorConfig,
  RawDocument,
  SearchResult,
  CollectParams,
  SearchOptions,
} from "../types";
import { OAuth2ClientCredentials } from "../lib/oauth2ClientCredentials";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";
import { validateCredentialsForCollect } from "./credentials";
import {
  EPO_OPS_REST_BASE,
  EPO_OPS_TOKEN_URL,
  EPO_OPS_MAX_RANGE,
  EPO_OPS_MAX_RESULTS,
  buildEpoCql,
  buildEpoSearchPath,
  extractEpoExchangeDocuments,
  mapEpoDocToRawJson,
} from "./epoOpsHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildEpoOpsBatchRequest,
  buildEpoOpsCanonicalUrl,
  buildEpoOpsDocumentRequest,
} from "./provenance/epoOps";

export const EPO_OPS_META: ConnectorMeta = {
  id: "epo_ops",
  name: "EPO Open Patent Services (OPS)",
  baseUrl: EPO_OPS_REST_BASE,
  license: "EPO terms (free tier 4 GB/week)",
  commercialUse: false,
  authType: "oauth2",
  rateLimit: "4 GB/week free; X-Throttling-Control",
  description: "欧洲专利局 OPS published-data 检索（CQL + biblio/abstract）",
};

export class EpoOpsConnector extends BaseConnector {
  readonly meta: ConnectorMeta = EPO_OPS_META;
  private readonly oauth: OAuth2ClientCredentials;
  private readonly apiSecret?: string;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      EPO_OPS_META.baseUrl,
    );
    this.apiSecret = config.apiSecret;
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
    const tokenUrl =
      typeof config.sourceOptions?.token_url === "string"
        ? config.sourceOptions.token_url
        : EPO_OPS_TOKEN_URL;
    this.oauth = new OAuth2ClientCredentials({
      tokenUrl,
      clientId: config.apiKey ?? "",
      clientSecret: config.apiSecret ?? "",
    });
  }

  private async opsGet(
    path: string,
    range?: string,
    retry = true,
  ): Promise<Response> {
    const token = await this.oauth.getAccessToken();
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    const url = `${root}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (range) headers["X-OPS-Range"] = range;

    const res = await this.fetch(url, { method: "GET", headers });
    if (res.status === 403 && retry) {
      this.oauth.invalidate();
      return this.opsGet(path, range, false);
    }
    this.assertAuthorizedResponse(res);
    return res;
  }

  private async searchPage(
    cql: string,
    rangeStart: number,
    rangeEnd: number,
  ): Promise<Record<string, unknown>[]> {
    const path = buildEpoSearchPath(cql);
    const res = await this.opsGet(path, `${rangeStart}-${rangeEnd}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `EPO OPS 检索失败 (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }
    const json = (await res.json()) as Record<string, unknown>;
    return extractEpoExchangeDocuments(json);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const credErr = validateCredentialsForCollect(
      EPO_OPS_META.id,
      this.apiKey,
      this.apiSecret,
    );
    if (credErr) throw new Error(credErr);

    const maxResults = opts?.maxResults ?? 10;
    const cql = buildEpoCql({ query });
    const docs = await this.searchPage(cql, 1, Math.min(maxResults, EPO_OPS_MAX_RANGE));

    return docs.slice(0, maxResults).map((doc) => {
      const { rawJson } = mapEpoDocToRawJson(doc);
      return {
        title: String(rawJson.title),
        url: String(rawJson.url ?? ""),
        snippet: String(rawJson.abstract ?? "").slice(0, 300),
        sourceId: EPO_OPS_META.id,
        sourceName: EPO_OPS_META.name,
        publishedAt: rawJson.publication_date as string | undefined,
        score: 1,
        license: EPO_OPS_META.license,
        commercialUse: EPO_OPS_META.commercialUse,
      };
    });
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(
      EPO_OPS_META.id,
      this.apiKey,
      this.apiSecret,
    );
    if (credErr) throw new Error(credErr);

    const maxItems = params.maxItems ?? Infinity;
    const cql = buildEpoCql({ query: params.query, since: params.since });
    let rangeStart = 1;
    let yielded = 0;
    let batchIndex = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    while (yielded < maxItems && rangeStart <= EPO_OPS_MAX_RESULTS) {
      if (params.signal?.aborted) break;

      const pageSize = Math.min(
        EPO_OPS_MAX_RANGE,
        maxItems - yielded,
        EPO_OPS_MAX_RESULTS - rangeStart + 1,
      );
      const rangeEnd = rangeStart + pageSize - 1;
      const docs = await this.searchPage(cql, rangeStart, rangeEnd);
      if (docs.length === 0) break;

      const batchRequest = {
        ...buildEpoOpsBatchRequest(
          this.runtimeBaseUrl,
          this.userAgent,
          cql,
          rangeStart,
          rangeEnd,
        ),
        batchIndex,
        documentsInBatch: docs.length,
        ephemeral: batchIndex > 0,
      };

      const now = new Date();
      for (let documentIndexInBatch = 0; documentIndexInBatch < docs.length; documentIndexInBatch++) {
        const doc = docs[documentIndexInBatch]!;
        const { externalId, rawJson } = mapEpoDocToRawJson(doc);
        const rawDoc: RawDocument = {
          sourceId: EPO_OPS_META.id,
          externalId,
          rawJson,
          fetchedAt: now,
        };
        yield attachProvenance(rawDoc, EPO_OPS_META, {
          documentRequest: buildEpoOpsDocumentRequest(
            externalId,
            this.runtimeBaseUrl,
            this.userAgent,
          ),
          batchRequest: { ...batchRequest, documentIndexInBatch },
          collect: collectCtx,
          canonicalUrl: buildEpoOpsCanonicalUrl(rawJson),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      rangeStart += docs.length;
      if (docs.length < pageSize) break;
      batchIndex++;
    }
  }
}
