import type { ConnectorMeta, ConnectorConfig, RawDocument, SearchResult, CollectParams, SearchOptions } from "../types";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";

const META: ConnectorMeta = {
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
  readonly meta: ConnectorMeta = META;

  private mailto: string;

  constructor(config: ConnectorConfig = {}) {
    super({
      ...config,
      userAgent: config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
    });
    // CrossRef polite pool: mailto query param for better service
    this.mailto = config.apiKey?.includes("@") ? config.apiKey : "dev@wangye.app";
    // Conservative rate limit for polite pool (5 req/s)
    this.rateLimiter = RateLimiter.fromRPS(5);
  }

  // ── 搜索 ──

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const params = new URLSearchParams({
      query,
      rows: String(Math.min(maxResults, 100)),
    });
    const url = `${META.baseUrl}/works?${params.toString()}${this.politeParam()}`;

    const res = await this.fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as CRResponse;
    return (data.message?.items ?? []).map(w => this.toSearchResult(w));
  }

  // ── 增量采集 ──

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const since = params.since ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const maxItems = params.maxItems ?? Infinity;
    let yielded = 0;

    // CrossRef 使用 cursor 分页（rows 固定 200，比 offset 更高效）
    let cursor = "*";

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const sp = new URLSearchParams({
        filter: `from-pub-date:${since}`,
        rows: "200",
        cursor,
      });
      const url = `${META.baseUrl}/works?${sp.toString()}${this.politeParam()}`;

      const res = await this.fetch(url);
      if (!res.ok) break;

      const data = (await res.json()) as CRResponse;
      const items = data.message?.items ?? [];

      if (items.length === 0) break;

      for (const item of items) {
        if (params.signal?.aborted) break;
        yield this.toRawDocument(item);
        yielded++;
        if (yielded >= maxItems) break;
      }

      cursor = data.message?.["next-cursor"] ?? "";
      if (!cursor) break;
    }
  }

  // ── 数据映射 ──

  private toSearchResult(work: CRWork): SearchResult {
    const doi = work.DOI ?? "";
    const url = doi ? `https://doi.org/${doi}` : (work.URL ?? "");

    return {
      title: pickTitle(work),
      url,
      snippet: cleanAbstract(work.abstract).slice(0, 300),
      sourceId: META.id,
      sourceName: META.name,
      publishedAt: pickDate(work),
      score: work["is-referenced-by-count"] ?? 0,
      license: pickLicense(work),
      commercialUse: META.commercialUse,
    };
  }

  private toRawDocument(work: CRWork): RawDocument {
    const extId = work.DOI ?? `cr-${hashWork(work)}`;
    return {
      sourceId: META.id,
      externalId: extId,
      rawJson: work as unknown as Record<string, unknown>,
      fetchedAt: new Date(),
    };
  }

  // ── 辅助 ──

  private politeParam(): string {
    return `&mailto=${encodeURIComponent(this.mailto)}`;
  }
}

// ── 字段抽取 helpers ──

function pickTitle(work: CRWork): string {
  if (work.title && work.title.length > 0) return work.title[0]!;
  return "Untitled";
}

function cleanAbstract(raw?: string): string {
  if (!raw) return "";
  // CrossRef abstract 常含 JATS XML 标签：<jats:p>...</jats:p>
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
  // 为无 DOI 的作品生成稳定 ID
  const title = work.title?.[0] ?? "";
  const firstAuthor = work.author?.[0];
  const authorStr = firstAuthor ? `${firstAuthor.family ?? ""}${firstAuthor.given ?? ""}` : "";
  const dateStr = pickDate(work) ?? "";
  return Buffer.from(`${title}|${authorStr}|${dateStr}`).toString("base64").slice(0, 32);
}
