import { createHash } from "node:crypto";

/** OpenCitations Index REST v2 引文边行 */
export interface OcCitationRow {
  oci?: string;
  citing?: string;
  cited?: string;
  creation?: string;
  timespan?: string;
  journal_sc?: string;
  author_sc?: string;
}

export type OcCitationMode = "references" | "citations";

export function looksLikeDoi(text: string): boolean {
  const t = text.trim().replace(/^https?:\/\/doi\.org\//i, "");
  return /^10\.\d{4,}\/\S+$/i.test(t);
}

export function normalizeDoi(text: string): string {
  return text.trim().replace(/^https?:\/\/doi\.org\//i, "");
}

export function buildOcPid(doi: string): string {
  return `doi:${normalizeDoi(doi)}`;
}

/** 从 OpenCitations PID 串（如 `omid:… doi:10.x pmid:…`）提取首个 DOI */
export function extractDoiFromPid(pidField?: string): string | undefined {
  if (!pidField?.trim()) return undefined;
  const match = /\bdoi:(10\.\S+)/i.exec(pidField);
  return match?.[1];
}

export function opencitationsExternalId(row: OcCitationRow): string {
  if (row.oci?.trim()) return row.oci.trim();
  const citing = extractDoiFromPid(row.citing) ?? row.citing ?? "";
  const cited = extractDoiFromPid(row.cited) ?? row.cited ?? "";
  const hash = createHash("sha256")
    .update(`${citing}|${cited}`)
    .digest("hex")
    .slice(0, 16);
  return `oc-${hash}`;
}

export function mapOcCitationToRawJson(
  row: OcCitationRow,
  seedDoi: string,
  mode: OcCitationMode,
): Record<string, unknown> {
  const citingDoi = extractDoiFromPid(row.citing);
  const citedDoi = extractDoiFromPid(row.cited);
  const title =
    citingDoi && citedDoi
      ? `Citation: ${citingDoi} → ${citedDoi}`
      : "Citation edge";
  return {
    graph_type: "citation_edge",
    oci: row.oci,
    citing_doi: citingDoi,
    cited_doi: citedDoi,
    citing: row.citing,
    cited: row.cited,
    creation: row.creation,
    timespan: row.timespan,
    journal_sc: row.journal_sc,
    author_sc: row.author_sc,
    seed_doi: normalizeDoi(seedDoi),
    citation_mode: mode,
    title,
    abstract:
      citingDoi && citedDoi
        ? `OpenCitations edge from ${citingDoi} to ${citedDoi}`
        : "",
  };
}

export function buildOcApiPath(mode: OcCitationMode, doi: string): string {
  const pid = buildOcPid(doi);
  const segment = mode === "references" ? "references" : "citations";
  return `/${segment}/${encodeURIComponent(pid)}`;
}

export function parseOcCitationResponse(body: unknown): OcCitationRow[] {
  if (!Array.isArray(body)) return [];
  return body.filter(
    (row): row is OcCitationRow =>
      row != null && typeof row === "object" && "oci" in row,
  );
}

export function mapOcCitationToSearchResult(
  row: OcCitationRow,
  seedDoi: string,
  mode: OcCitationMode,
  meta: { id: string; name: string; license: string; commercialUse: boolean },
): {
  title: string;
  url: string;
  snippet: string;
  sourceId: string;
  sourceName: string;
  publishedAt?: string;
  score: number;
  license: string;
  commercialUse: boolean;
} {
  const citingDoi = extractDoiFromPid(row.citing);
  const citedDoi = extractDoiFromPid(row.cited);
  const title =
    citingDoi && citedDoi
      ? `Citation: ${citingDoi} → ${citedDoi}`
      : "Citation edge";
  const url =
    citingDoi != null
      ? `https://doi.org/${citingDoi}`
      : "https://opencitations.net/";
  return {
    title,
    url,
    snippet: `OpenCitations ${mode} for seed ${seedDoi}`,
    sourceId: meta.id,
    sourceName: meta.name,
    publishedAt: row.creation?.slice(0, 10),
    score: 0,
    license: meta.license,
    commercialUse: meta.commercialUse,
  };
}

export function mapOcCitationToRawDocument(
  row: OcCitationRow,
  seedDoi: string,
  mode: OcCitationMode,
  sourceId: string,
): { sourceId: string; externalId: string; rawJson: Record<string, unknown> } {
  return {
    sourceId,
    externalId: opencitationsExternalId(row),
    rawJson: mapOcCitationToRawJson(row, seedDoi, mode),
  };
}
