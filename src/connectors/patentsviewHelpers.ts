/** PatentsView PatentSearch API 字段与查询构建 */

export const PATENT_FIELDS = [
  "patent_id",
  "patent_title",
  "patent_date",
  "patent_abstract",
  "assignee_organization",
] as const;

export interface PatentRecord {
  patent_id?: string | number;
  patent_title?: string;
  patent_date?: string;
  patent_abstract?: string;
  assignee_organization?: string | string[];
}

export interface PatentSearchResponse {
  error?: boolean;
  count?: number;
  total_hits?: number;
  patents?: PatentRecord[];
  after?: string;
}

export function scalarField(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value);
}

export function buildPatentQuery(query?: string, since?: string): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [];
  const sinceDate =
    since ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  parts.push({ _gte: { patent_date: sinceDate } });
  const q = query?.trim();
  if (q) {
    parts.push({
      _or: [
        { _text_any: { patent_title: q } },
        { _text_any: { patent_abstract: q } },
      ],
    });
  }
  if (parts.length === 1) return parts[0]!;
  return { _and: parts };
}

export function mapPatentToRawJson(patent: PatentRecord): {
  externalId: string;
  rawJson: Record<string, unknown>;
} {
  const patentId = scalarField(patent.patent_id);
  const title = scalarField(patent.patent_title) || "Untitled Patent";
  const abstract = scalarField(patent.patent_abstract);
  const date = scalarField(patent.patent_date);
  const assignee = scalarField(patent.assignee_organization);

  return {
    externalId: patentId || `pv-${hashPatent(patent)}`,
    rawJson: {
      title,
      abstract,
      publication_date: date || undefined,
      type: "patent",
      url: patentId
        ? `https://patentsview.org/patent/${patentId}`
        : undefined,
      patent_id: patentId,
      assignee_organization: assignee || undefined,
    },
  };
}

function hashPatent(patent: PatentRecord): string {
  const s = `${scalarField(patent.patent_title)}|${scalarField(patent.patent_date)}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h)}`;
}
