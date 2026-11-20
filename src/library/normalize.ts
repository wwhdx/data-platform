import { createHash } from "node:crypto";
import { contentDate } from "./dates";
import { clip, fulltext, plain, text } from "./text";
import type { CatalogRow, LibraryKind } from "./types";
export function sourceKind(source: string): LibraryKind {
 const id = source.split("_").filter(Boolean).join("_");
 if (/^(worldbank|eurostat|fred|eia|oecd|imf|ecb|census|bea|faostat)(_|$)/.test(id)) return "indicator";
 if (/^(uniprot|materials_project|pubchem|chembl)(_|$)/.test(id)) return "entity";
 if (/^(clinicaltrials)(_|$)/.test(id)) return "trial";
 if (/^(patentsview|google_patents|epo_ops|wipo)(_|$)/.test(id)) return "patent";
 if (/^youtube(_|$)/.test(id)) return "video";
 if (/^(hackernews|github|yahoo_finance)(_|$)/.test(id)) return "activity";
 if (/^(openalex|crossref|pubmed|arxiv|biorxiv|medrxiv|core|semanticscholar|opencitations)(_|$)/.test(id)) return "paper";
 return "other";
}
export interface InputDocument {
 id: string; source_id: string; external_id: string; fetched_at: Date | string;
 industry_tag: string | null; raw_json: Record<string, unknown>;
}
function series(source: string, raw: Record<string, unknown>): string | null {
 const dimensions = raw.dimensions && typeof raw.dimensions === "object" && !Array.isArray(raw.dimensions)
  ? raw.dimensions as Record<string, unknown> : {};
 const retained = Object.fromEntries(Object.entries(dimensions).filter(([k]) => !/^(time|period|date|time_period)$/i.test(k)).sort(([a], [b]) => a.localeCompare(b)));
 const code = text(raw.dataset_code || raw.indicator_code || raw.series_id || raw.indicator_name || raw.title);
 if (!code) return null;
 return createHash("sha256").update(JSON.stringify([source, code, retained, raw.country ?? null, raw.unit ?? null])).digest("hex");
}
export function normalizeDocument(row: InputDocument, asOf: Date): { document: CatalogRow; content: string } {
 const raw = row.raw_json, kind = sourceKind(row.source_id);
 const body = fulltext(raw), abstract = plain(raw.abstract || raw.brief_summary || raw.description || raw.text);
 const structured = ["indicator", "entity", "trial"].includes(kind);
 const date = kind === "indicator" ? { at: null, label: null, precision: null } : contentDate(raw, asOf);
 const facets: Record<string, unknown> = {};
 for (const key of ["country", "date", "period", "value", "unit", "dimensions", "dataset_code", "indicator_code",
  "indicator_name", "organism", "taxon_id", "sequence_length", "accession", "nct_id", "phases", "conditions",
  "score", "descendants", "publication_number"]) if (raw[key] != null) facets[key] = raw[key];
 const document: CatalogRow = {
  doc_id: String(row.id), source_id: row.source_id, external_id: row.external_id,
  identifier: text(raw.DOI || raw.doi || raw.uid || raw.nct_id || raw.accession || row.external_id).toLowerCase(),
  kind, title: clip(plain(raw.title || raw.patent_title || raw.name || raw.indicator_name || row.external_id), 4000),
  snippet: clip(abstract, 480), content_at: date.at, content_label: date.label, precision: date.precision,
  fetched_at: typeof row.fetched_at === "string" ? row.fetched_at : row.fetched_at.toISOString(), availability: body ? "fulltext" : structured ? "structured" : abstract ? "abstract" : "metadata",
  industry: row.industry_tag, series_key: kind === "indicator" ? series(row.source_id, raw) : null, facets,
 };
 return { document, content: kind === "indicator" ? body : [abstract, body].filter(Boolean).join("\n\n") };
}
