import type {
  ConnectorMeta,
  ConnectorConfig,
  RawDocument,
  SearchResult,
  CollectParams,
  SearchOptions,
  HttpRequestCapture,
} from "../types";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";
import { attachProvenance } from "./provenance/attach";
import {
  buildCrossrefCanonicalUrl,
  buildCrossrefDocumentRequest,
} from "./provenance/crossref";

export const CROSSREF_META: ConnectorMeta = {
  id: "crossref",
  name: "CrossRef",
  baseUrl: "https://api.crossref.org/v1",
  license: "varies (per-work metadata, mostly free)",
  commercialUse: true,
  authType: "polite_id",
  rateLimit: "dynamic (x-rate-limit-limit header)",
  description: "1.8亿+ DOI 元数据记录，覆盖学术出版物、会议论文、书籍章节",
};

interface CRWork {
  title?: string[];
  subtitle?: string[];
  abstract?: string;
  DOI?: string;
  URL?: string;
  author?: Array<{ given?: string; family?: string; ORCID?: string }>;
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  created?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  type?: string;
  publisher?: string;
  "is-referenced-by-count"?: number;
  "references-count"?: number;
  subject?: string[];
  link?: Array<{ URL?: string; "content-type"?: string }>;
  license?: Array<{ URL?: string; "content-version"?: string; start?: { "date-parts"?: number[][] } }>;
}

interface CRResponse {
  status?: string;
  message?: {
    items?: CRWork[];
    "total-results"?: number;
    "items-per-page"?: number;
    "next-cursor"?: string;
  };
}

export class CrossRefConnector extends BaseConnector {
  readonly meta: ConnectorMeta = CROSSREF_META;

  private mailto: string;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      CROSSREF_META.baseUrl,
    );
    this.mailto = config.apiKey?.includes("@") ? config.apiKey : "dev@wangye.app";
    this.rateLimiter = RateLimiter.fromRPS(5);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const params = new URLSearchParams({
      query,
      rows: String(Math.min(maxResults, 100)),
    });
    const url = `${this.runtimeBaseUrl}/works?${params.toString()}${this.politeParam()}`;

    const res = await this.fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as CRResponse;
    return (data.message?.items ?? []).map((w) => this.toSearchResult(w));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const since = params.since ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const maxItems = params.maxItems ?? Infinity;
    let yielded = 0;
    let cursor = "*";
    let batchIndex = 0;

    const collectCtx = {
      mode: "incremental" as const,
      since,
      query: params.query,
    };

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const sp = new URLSearchParams({
        filter: `from-pub-date:${since}`,
        rows: "200",
        cursor,
      });
      const url = `${this.runtimeBaseUrl}/works?${sp.toString()}${this.politeParam()}`;

      const res = await this.fetch(url);
      const batchCapture = this.consumeLastHttpCapture();
      if (!res.ok || !batchCapture) break;

      const data = (await res.json()) as CRResponse;
      const items = data.message?.items ?? [];

      if (items.length === 0) break;

      const batchRequest: HttpRequestCapture & {
        batchIndex: number;
        documentsInBatch: number;
        ephemeral: boolean;
      } = {
        ...batchCapture,
        ephemeral: cursor !== "*",
        batchIndex,
        documentsInBatch: items.length,
      };

      for (let documentIndexInBatch = 0; documentIndexInBatch < items.length; documentIndexInBatch++) {
        const item = items[documentIndexInBatch]!;
        if (params.signal?.aborted) break;

        const doc = this.toRawDocument(item);
        yield attachProvenance(doc, CROSSREF_META, {
          documentRequest: buildCrossrefDocumentRequest(
            doc.externalId,
            this.runtimeBaseUrl,
            this.userAgent,
            this.mailto,
          ),
          batchRequest: { ...batchRequest, documentIndexInBatch },
          collect: collectCtx,
          canonicalUrl: buildCrossrefCanonicalUrl(doc.externalId),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      cursor = data.message?.["next-cursor"] ?? "";
      if (!cursor) break;
      batchIndex++;
    }
  }

  private toSearchResult(work: CRWork): SearchResult {
    const doi = work.DOI ?? "";
    const url = doi ? `https://doi.org/${doi}` : (work.URL ?? "");

    return {
      title: pickTitle(work),
      url,
      snippet: cleanAbstract(work.abstract).slice(0, 300),
      sourceId: CROSSREF_META.id,
      sourceName: CROSSREF_META.name,
      publishedAt: pickDate(work),
      score: work["is-referenced-by-count"] ?? 0,
      license: pickLicense(work),
      commercialUse: CROSSREF_META.commercialUse,
    };
  }

  private toRawDocument(work: CRWork): RawDocument {
    const extId = work.DOI ?? `cr-${hashWork(work)}`;
    return {
      sourceId: CROSSREF_META.id,
      externalId: extId,
      rawJson: work as unknown as Record<string, unknown>,
      fetchedAt: new Date(),
    };
  }

  private politeParam(): string {
    return `&mailto=${encodeURIComponent(this.mailto)}`;
  }
}

function pickTitle(work: CRWork): string {
  if (work.title && work.title.length > 0) return work.title[0]!;
  return "Untitled";
}

function cleanAbstract(raw?: string): string {
  if (!raw) return "";
  return raw.replace(/<[^>]+>/g, "").trim();
}

function pickDate(work: CRWork): string | undefined {
  const parts =
    work["published-print"]?.["date-parts"]?.[0] ??
    work["published-online"]?.["date-parts"]?.[0] ??
    work.created?.["date-parts"]?.[0];
  if (!parts) return undefined;
  const [y, m, d] = parts;
  return `${y!}-${pad(m ?? 1)}-${pad(d ?? 1)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function pickLicense(work: CRWork): string {
  const licenses = work.license;
  if (!licenses || licenses.length === 0) return "unknown";
  const first = licenses[0]!;
  if (first.URL) {
    const lower = first.URL.toLowerCase();
    if (lower.includes("creativecommons.org/licenses/by/4.0")) return "CC BY 4.0";
    if (lower.includes("creativecommons.org/licenses/by-nc")) return "CC BY-NC";
    if (lower.includes("creativecommons.org/licenses/by")) return "CC BY";
    if (lower.includes("creativecommons.org/publicdomain")) return "CC0";
  }
  return first.URL ?? "unknown";
}

function hashWork(work: CRWork): string {
  const title = work.title?.[0] ?? "";
  const firstAuthor = work.author?.[0];
  const authorStr = firstAuthor ? `${firstAuthor.family ?? ""}${firstAuthor.given ?? ""}` : "";
  const dateStr = pickDate(work) ?? "";
  return Buffer.from(`${title}|${authorStr}|${dateStr}`).toString("base64").slice(0, 32);
}
