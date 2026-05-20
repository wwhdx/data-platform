export const GP_DEFAULT_TABLE = "patents-public-data.patents.publications";

export interface GpQueryOptions {
  term?: string;
  sinceGrantDate?: number;
  countryCode?: string;
  limit: number;
  offset: number;
  tableFqn: string;
}

export interface GpPublicationRow {
  publication_number?: string;
  country_code?: string;
  grant_date?: number | string;
  filing_date?: number | string;
  title_en?: string;
  abstract_en?: string;
}

/** 检索词清洗：去 SQL 通配符，限制长度 */
export function sanitizeSearchTerm(term: string): string {
  return term.trim().slice(0, 200).replace(/[%_\\]/g, "");
}

/** YYYY-MM-DD → grant_date INT（YYYYMMDD） */
export function sinceToGrantDateInt(since?: string): number | undefined {
  if (!since?.trim()) return undefined;
  const digits = since.replace(/-/g, "").slice(0, 8);
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && digits.length === 8 ? n : undefined;
}

export function grantDateToIso(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const s = String(value).padStart(8, "0").slice(0, 8);
  if (!/^\d{8}$/.test(s)) return undefined;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function resolveGpTableFqn(sourceOptions: Record<string, unknown>): string {
  const raw = sourceOptions.table;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return GP_DEFAULT_TABLE;
}

export function resolveGpCountryCode(
  sourceOptions: Record<string, unknown>,
): string | undefined {
  const raw = sourceOptions.default_country_code;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().toUpperCase();
  }
  return undefined;
}

export function resolveMaxBytesBilled(
  sourceOptions: Record<string, unknown>,
): string {
  const raw = sourceOptions.maximum_bytes_billed;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return raw.trim();
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return String(Math.floor(raw));
  }
  return "1073741824";
}

/** 参数化 SQL（禁止拼接用户输入） */
export function buildPatentsQuery(opts: GpQueryOptions): {
  sql: string;
  params: Record<string, string | number>;
} {
  const table = opts.tableFqn.includes("`")
    ? opts.tableFqn
    : `\`${opts.tableFqn}\``;
  const term = opts.term ? sanitizeSearchTerm(opts.term) : "";
  const params: Record<string, string | number> = {
    limit: opts.limit,
    offset: opts.offset,
  };

  const filters: string[] = [];
  if (opts.countryCode) {
    params.countryCode = opts.countryCode;
    filters.push("country_code = @countryCode");
  }
  if (opts.sinceGrantDate !== undefined) {
    params.sinceGrantDate = opts.sinceGrantDate;
    filters.push("grant_date >= @sinceGrantDate");
  }
  if (term) {
    params.termPattern = `%${term.toLowerCase()}%`;
    filters.push(`(
      EXISTS (SELECT 1 FROM UNNEST(title_localized) t WHERE LOWER(t.text) LIKE @termPattern)
      OR EXISTS (SELECT 1 FROM UNNEST(abstract_localized) a WHERE LOWER(a.text) LIKE @termPattern)
    )`);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  const sql = `
SELECT
  publication_number,
  country_code,
  grant_date,
  filing_date,
  (SELECT t.text FROM UNNEST(title_localized) t WHERE t.language = 'en' LIMIT 1) AS title_en,
  (SELECT a.text FROM UNNEST(abstract_localized) a WHERE a.language = 'en' LIMIT 1) AS abstract_en
FROM ${table}
${where}
ORDER BY grant_date DESC
LIMIT @limit
OFFSET @offset`.trim();

  return { sql, params };
}

export function mapGpRowToRawJson(row: GpPublicationRow): {
  externalId: string;
  rawJson: Record<string, unknown>;
} {
  const pubNo = String(row.publication_number ?? "").trim();
  const title =
    row.title_en?.trim() ||
    pubNo ||
    "Untitled patent";
  const abstract = row.abstract_en?.trim() ?? "";
  const grantIso = grantDateToIso(row.grant_date);
  const filingIso = grantDateToIso(row.filing_date);
  // Google Patents URL 要求无连字符：US-12539044-B2 → US12539044B2
  const urlPubNo = pubNo.replace(/-/g, "");
  const url = urlPubNo
    ? `https://patents.google.com/patent/${urlPubNo}`
    : undefined;

  return {
    externalId: pubNo || `gp-${row.country_code ?? "xx"}-${row.grant_date ?? "0"}`,
    rawJson: {
      title,
      abstract,
      publication_date: grantIso ?? filingIso,
      filing_date: filingIso,
      grant_date: grantIso,
      type: "patent",
      country_code: row.country_code,
      publication_number: pubNo,
      url,
      data_source: "google_patents_bq",
    },
  };
}

export function validateGooglePatentsEnv(): string | null {
  const projectId = process.env.GCP_PROJECT_ID?.trim();
  if (!projectId) {
    return (
      "GCP_PROJECT_ID 未配置：google_patents 须指定 GCP 项目；" +
      "并配置 GOOGLE_APPLICATION_CREDENTIALS 或使用 gcloud ADC。"
    );
  }
  return null;
}
