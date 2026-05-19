/** USPTO ODP Patent File Wrapper — 搜索请求与 rawJson 映射 */

export const ODP_API_BASE_URL = "https://api.uspto.gov";

export const ODP_PATENT_SEARCH_PATH = "/api/v1/patent/applications/search";

export const ODP_DEFAULT_FIELDS = [
  "applicationNumberText",
  "applicationMetaData.inventionTitle",
  "applicationMetaData.grantDate",
  "applicationMetaData.firstApplicantName",
  "applicationMetaData.applicationStatusDescriptionText",
] as const;

export interface OdpSearchRequestBody {
  q?: string;
  filters?: Array<{ name: string; value: string[] }>;
  rangeFilters?: Array<{
    field: string;
    valueFrom: string;
    valueTo?: string;
  }>;
  sort?: Array<{ field: string; order: "asc" | "desc" }>;
  fields?: string[];
  pagination?: { offset: number; limit: number };
}

export interface OdpSearchResponse {
  count?: number;
  total?: number;
  patentFileWrapperDataBag?: Record<string, unknown>[];
  [key: string]: unknown;
}

export function scalarField(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value);
}

export function buildOdpSearchBody(opts: {
  query?: string;
  since?: string;
  offset: number;
  limit: number;
}): OdpSearchRequestBody {
  const sinceDate =
    opts.since ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const body: OdpSearchRequestBody = {
    fields: [...ODP_DEFAULT_FIELDS],
    pagination: { offset: opts.offset, limit: opts.limit },
    sort: [{ field: "applicationMetaData.grantDate", order: "desc" }],
    rangeFilters: [
      {
        field: "applicationMetaData.grantDate",
        valueFrom: sinceDate,
      },
    ],
    filters: [
      {
        name: "applicationMetaData.applicationStatusDescriptionText",
        value: ["Patented Case"],
      },
    ],
  };

  const q = opts.query?.trim();
  if (q) body.q = q;

  return body;
}

export function extractOdpRecords(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  for (const key of [
    "patentFileWrapperDataBag",
    "results",
    "applications",
    "data",
  ]) {
    const bag = root[key];
    if (Array.isArray(bag)) {
      return bag.filter(
        (item): item is Record<string, unknown> =>
          item != null && typeof item === "object",
      );
    }
  }
  return [];
}

function metaBag(record: Record<string, unknown>): Record<string, unknown> {
  const meta = record.applicationMetaData;
  return meta && typeof meta === "object"
    ? (meta as Record<string, unknown>)
    : {};
}

export function mapOdpRecordToRawJson(record: Record<string, unknown>): {
  externalId: string;
  rawJson: Record<string, unknown>;
} {
  const appNum = scalarField(record.applicationNumberText);
  const meta = metaBag(record);
  const title =
    scalarField(meta.inventionTitle) || scalarField(record.inventionTitle);
  const grantDate = scalarField(meta.grantDate);
  const applicant = scalarField(meta.firstApplicantName);
  const status = scalarField(meta.applicationStatusDescriptionText);

  const displayTitle = title || "Untitled Patent Application";

  return {
    externalId: appNum || `odp-${hashRecord(record)}`,
    rawJson: {
      title: displayTitle,
      abstract: displayTitle,
      publication_date: grantDate || undefined,
      type: "patent",
      url: appNum
        ? `https://data.uspto.gov/patent-file-wrapper/applications/${encodeURIComponent(appNum)}/metadata`
        : undefined,
      application_number: appNum || undefined,
      assignee_organization: applicant || undefined,
      application_status: status || undefined,
      data_source: "uspto_odp",
    },
  };
}

function hashRecord(record: Record<string, unknown>): string {
  const meta = metaBag(record);
  const s = `${scalarField(meta.inventionTitle)}|${scalarField(meta.grantDate)}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h)}`;
}
