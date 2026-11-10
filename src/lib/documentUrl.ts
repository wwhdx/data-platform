/**
 * 从 raw_json + 行级元数据解析可点击的文献 URL。
 * PubMed 等源的 esummary raw 常无 doi/landing_page，须用 external_id。
 */

export interface DocumentUrlMeta {
  sourceId?: string;
  externalId?: string;
}

export function extractDocumentUrl(
  raw: Record<string, unknown>,
  meta?: DocumentUrlMeta,
): string {
  const doiRaw = typeof raw.doi === "string" ? raw.doi.trim() : "";
  if (doiRaw) {
    const bare = doiRaw.replace(/^https?:\/\/(doi\.org\/)?/i, "");
    return `https://doi.org/${bare}`;
  }

  const location = raw.primary_location as Record<string, unknown> | undefined;
  if (location?.landing_page_url) {
    const landing = String(location.landing_page_url).trim();
    if (landing.startsWith("http")) return landing;
  }

  const sourceId = meta?.sourceId ?? "";
  const externalId = (meta?.externalId ?? "").trim();
  if (externalId.startsWith("http://") || externalId.startsWith("https://")) {
    return externalId;
  }
  if (
    (sourceId === "pubmed" || sourceId.startsWith("pubmed"))
    && externalId
    && /^\d+$/.test(externalId)
  ) {
    return `https://pubmed.ncbi.nlm.nih.gov/${externalId}/`;
  }

  const uid = raw.uid ?? raw.pmid;
  if (uid != null) {
    const s = String(uid).trim();
    if (/^\d+$/.test(s)) return `https://pubmed.ncbi.nlm.nih.gov/${s}/`;
  }

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (id.startsWith("http://") || id.startsWith("https://")) return id;
  if (/^W\d+$/i.test(id)) return `https://openalex.org/${id}`;
  if (id.startsWith("10.")) return `https://doi.org/${id}`;

  return "";
}
