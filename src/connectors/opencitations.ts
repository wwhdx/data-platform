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
import { attachProvenance } from "./provenance/attach";
import {
  buildOpenCitationsCanonicalUrl,
  buildOpenCitationsDocumentRequest,
} from "./provenance/opencitations";
import { captureFromRequest } from "../lib/httpCapture";
import {
  buildOcApiPath,
  extractDoiFromPid,
  looksLikeDoi,
  mapOcCitationToRawDocument,
  mapOcCitationToSearchResult,
  normalizeDoi,
  parseOcCitationResponse,
  type OcCitationMode,
  type OcCitationRow,
} from "./opencitationsHelpers";

export const OPENCITATIONS_META: ConnectorMeta = {
  id: "opencitations",
  name: "OpenCitations",
  baseUrl: "https://api.opencitations.net/index/v2",
  license: "CC0 (OpenCitations Index)",
  commercialUse: true,
  authType: "none",
  rateLimit: "180 req/min per IP",
  description: "COCI 引文边 REST 子集；每条边独立 raw_documents",
};

const DEFAULT_SEED_DOI = "10.1038/nature12373";

export class OpenCitationsConnector extends BaseConnector {
  readonly meta: ConnectorMeta = OPENCITATIONS_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        timeoutMs: config.timeoutMs ?? 60_000,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
        apiKey: config.apiKey ?? process.env.OPENCITATIONS_ACCESS_TOKEN,
      },
      OPENCITATIONS_META.baseUrl,
    );
    // API 限速 180/min ≈ 3 rps；保守 2 rps
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey?.trim()) {
      headers.authorization = this.apiKey.trim();
    }
    return headers;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const doi = this.resolveSeedDoi(query);
    if (!doi) return [];

    const mode = this.resolveCitationMode();
    const rows = await this.fetchCitationRows(doi, mode);
    const maxResults = opts?.maxResults ?? 10;
    return rows
      .slice(0, maxResults)
      .map((row) => mapOcCitationToSearchResult(row, doi, mode, OPENCITATIONS_META));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const seedDoi = this.resolveSeedDoi(params.query);
    if (!seedDoi) {
      throw new Error(
        "OpenCitations collect requires a seed DOI in --query (e.g. 10.1038/nature12373)",
      );
    }

    const mode = this.resolveCitationMode();
    const maxItems = params.maxItems ?? Infinity;
    const apiPath = buildOcApiPath(mode, seedDoi);
    const batchCapture = this.consumeLastHttpCapture();
    const rows = await this.fetchCitationRows(seedDoi, mode);

    const collectCtx = {
      mode: "by_id" as const,
      query: params.query ?? seedDoi,
    };

    const fallbackCapture = captureFromRequest(
      `${this.runtimeBaseUrl.replace(/\/$/, "")}${apiPath}`,
      { headers: this.authHeaders() },
    );

    const batchRequest: HttpRequestCapture & {
      batchIndex: number;
      documentsInBatch: number;
      ephemeral: boolean;
    } = {
      ...(batchCapture ?? fallbackCapture),
      ephemeral: false,
      batchIndex: 0,
      documentsInBatch: Math.min(rows.length, maxItems),
    };

    let yielded = 0;
    for (let i = 0; i < rows.length && yielded < maxItems; i++) {
      if (params.signal?.aborted) break;

      const row = rows[i]!;
      const mapped = mapOcCitationToRawDocument(
        row,
        seedDoi,
        mode,
        OPENCITATIONS_META.id,
      );
      const doc: RawDocument = { ...mapped, fetchedAt: new Date() };
      yield attachProvenance(doc, OPENCITATIONS_META, {
        documentRequest: buildOpenCitationsDocumentRequest(
          seedDoi,
          mode,
          this.runtimeBaseUrl,
          this.userAgent,
          this.apiKey,
        ),
        batchRequest: { ...batchRequest, documentIndexInBatch: i },
        collect: collectCtx,
        canonicalUrl: buildOpenCitationsCanonicalUrl(
          extractDoiFromPid(row.citing),
          extractDoiFromPid(row.cited),
        ),
      });
      yielded++;
    }
  }

  private resolveSeedDoi(query?: string): string | undefined {
    const q = query?.trim();
    if (q && looksLikeDoi(q)) return normalizeDoi(q);
    if (q) {
      const fromUrl = q.replace(/^https?:\/\/doi\.org\//i, "");
      if (looksLikeDoi(fromUrl)) return normalizeDoi(fromUrl);
    }
    const fromOptions = String(
      this.sourceOptions.default_collect_query ?? "",
    ).trim();
    if (fromOptions && looksLikeDoi(fromOptions)) {
      return normalizeDoi(fromOptions);
    }
    if (!q) return DEFAULT_SEED_DOI;
    return undefined;
  }

  private resolveCitationMode(): OcCitationMode {
    const raw = String(this.sourceOptions.citation_mode ?? "references").trim();
    return raw === "citations" ? "citations" : "references";
  }

  private async fetchCitationRows(
    seedDoi: string,
    mode: OcCitationMode,
  ): Promise<OcCitationRow[]> {
    const path = buildOcApiPath(mode, seedDoi);
    const url = `${this.runtimeBaseUrl.replace(/\/$/, "")}${path}`;
    const res = await this.fetch(url, { headers: this.authHeaders() });
    if (res.status === 404) return [];
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `OpenCitations ${mode} failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    const body = await res.json();
    return parseOcCitationResponse(body);
  }
}
