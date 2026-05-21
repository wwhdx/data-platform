/** CORE API v3 输出字段映射（search/outputs 与 GET /outputs/{id}） */

export const CORE_ATTRIBUTION =
  "Metadata and links sourced from CORE (https://core.ac.uk). Respect per-document licenses.";

/** CORE v3 JSON 为 camelCase；保留 snake 别名便于兼容 */
export interface CoreOutput {
  id?: number;
  title?: string;
  abstract?: string;
  fullText?: string;
  full_text?: string;
  doi?: string;
  authors?: Array<string | { name?: string }>;
  publishedDate?: string;
  published_date?: string;
  depositedDate?: string;
  deposited_date?: string;
  yearPublished?: string | number;
  year_published?: string | number;
  license?: string;
  downloadUrl?: string;
  download_url?: string;
  urls?: string[];
  links?: Array<string | { url?: string; type?: string }>;
  documentType?: string | string[];
  document_type?: string | string[];
  dataProvider?: string | { name?: string };
  data_provider?: string | string[];
  core_attribution?: string;
  disabled?: boolean;
  deleted?: string;
}

export interface CoreSearchResponse {
  totalHits?: number;
  total_hits?: number;
  limit?: number;
  offset?: number;
  results?: CoreOutput[];
}

export function looksLikeDoi(text: string): boolean {
  return /^10\.\d{4,}\/\S+$/i.test(text.trim());
}

export function coreExternalId(output: CoreOutput): string {
  if (output.id != null) return String(output.id);
  if (output.doi?.trim()) return output.doi.trim();
  return `core-${hashFallback(output)}`;
}

export function pickCoreTitle(output: CoreOutput): string {
  const t = output.title?.trim();
  return t && t.length > 0 ? t : "Untitled";
}

export function pickCoreAbstract(output: CoreOutput): string {
  const abs = output.abstract?.trim();
  if (abs) return abs;
  const ft = (output.fullText ?? output.full_text)?.trim();
  if (ft && !/^not available/i.test(ft)) return ft.slice(0, 2000);
  return "";
}

export function pickCorePublishedAt(output: CoreOutput): string | undefined {
  const published = output.publishedDate ?? output.published_date;
  if (published) return published.slice(0, 10);
  const year = output.yearPublished ?? output.year_published;
  if (year != null) {
    const y = String(year).slice(0, 4);
    if (/^\d{4}$/.test(y)) return `${y}-01-01`;
  }
  const deposited = output.depositedDate ?? output.deposited_date;
  if (deposited) return deposited.slice(0, 10);
  return undefined;
}

export function pickCoreUrl(output: CoreOutput): string {
  if (output.doi?.trim()) return `https://doi.org/${output.doi.trim()}`;
  const dl = (output.downloadUrl ?? output.download_url)?.trim();
  if (dl) return dl;
  const link0 = output.links?.[0];
  const linkUrl = typeof link0 === "string" ? link0 : link0?.url;
  const u = output.urls?.[0] ?? linkUrl;
  if (u?.trim()) return u.trim();
  if (output.id != null) return `https://core.ac.uk/display/${output.id}`;
  return "https://core.ac.uk";
}

export function buildCoreSearchQuery(query: string): string {
  const q = query.trim();
  if (!q) return 'documentType:"research article"';
  if (looksLikeDoi(q)) return `doi:"${q}"`;
  if (/^\d+$/.test(q)) return `id:${q}`;
  if (q.includes(":")) return q;
  const escaped = q.replace(/"/g, "");
  return `fullText:"${escaped}"`;
}

/** collect 用 title 字段（比 fullText 轻，避免 30s 超时 / 429 token 耗尽） */
export function buildCoreCollectSearchQuery(query: string): string {
  const q = query.trim();
  if (!q) return 'documentType:"research article"';
  if (looksLikeDoi(q)) return `doi:"${q}"`;
  if (/^\d+$/.test(q)) return `id:${q}`;
  if (q.includes(":")) return q;
  const escaped = q.replace(/"/g, "");
  return `title:"${escaped}"`;
}

/** since=YYYY-MM-DD → yearPublished 增量（depositedDate:>= 会触发 CORE 500） */
export function buildCoreCollectQuery(userQuery: string, since: string): string {
  const base = buildCoreCollectSearchQuery(userQuery);
  const year = since.slice(0, 4);
  if (!/^\d{4}$/.test(year)) return base;
  return `${base} AND yearPublished>=${year}`;
}

export function mapCoreOutputToRawJson(output: CoreOutput): Record<string, unknown> {
  const title = pickCoreTitle(output);
  const abstract = pickCoreAbstract(output);
  const attribution =
    typeof output.core_attribution === "string" && output.core_attribution.trim()
      ? output.core_attribution.trim()
      : CORE_ATTRIBUTION;

  const raw: Record<string, unknown> = {
    ...output,
    title,
    abstract,
    core_attribution: attribution,
    publication_date: pickCorePublishedAt(output),
    url: pickCoreUrl(output),
  };

  const fullText = (output.fullText ?? output.full_text)?.trim();
  if (fullText && !/^not available/i.test(fullText)) raw.fulltext = fullText;

  return raw;
}

export function parseCoreSearchResponse(body: CoreSearchResponse): {
  results: CoreOutput[];
  totalHits: number;
} {
  const results = body.results ?? [];
  const totalHits = body.totalHits ?? body.total_hits ?? results.length;
  return { results, totalHits };
}

function hashFallback(output: CoreOutput): string {
  const seed = `${pickCoreTitle(output)}|${output.doi ?? ""}`;
  return Buffer.from(seed).toString("base64url").slice(0, 24);
}
