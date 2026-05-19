import type { RawDocument, SearchResult, SearchOptions } from "../../types";
import { query } from "../db";
import { buildDocumentFilterClause } from "../../rag/searchFilters";

// ── CRUD ──

export interface InsertedDoc {
  id: number;
  title: string;
  abstract: string;
}

export async function insertRawDocuments(docs: RawDocument[]): Promise<InsertedDoc[]> {
  if (docs.length === 0) return [];

  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const base = i * 4;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    params.push(d.sourceId, d.externalId, JSON.stringify(d.rawJson), d.collectionJobId ?? null);
  }

  const sql = `
    INSERT INTO raw_documents (source_id, external_id, raw_json, collection_job_id)
    VALUES ${values.join(", ")}
    ON CONFLICT (source_id, external_id) DO UPDATE
      SET raw_json = EXCLUDED.raw_json,
          fetched_at = now(),
          collection_job_id = COALESCE(EXCLUDED.collection_job_id, raw_documents.collection_job_id)
    RETURNING id, raw_json
  `;

  const result = await query(sql, params);
  return result.rows.map(row => {
    const raw = row.raw_json as Record<string, unknown>;
    return {
      id: Number(row.id),
      title: String(raw.title ?? ""),
      abstract: String(raw.abstract ?? ""),
    };
  });
}

export async function findExistingIds(
  sourceId: string,
  externalIds: string[],
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();

  const placeholders = externalIds.map((_, i) => `$${i + 2}`).join(", ");

  const sql = `
    SELECT external_id FROM raw_documents
    WHERE source_id = $1 AND external_id IN (${placeholders})
  `;

  const result = await query<{ external_id: string }>(sql, [sourceId, ...externalIds]);
  return new Set(result.rows.map(r => r.external_id));
}

// ── 关键词搜索（Phase 1 唯一检索方式）──

export interface InternalSearchHit {
  docId: number;
  title: string;
  url: string;
  snippet: string;
  sourceId: string;
  sourceName: string;
  publishedAt?: string;
  score: number;
  license: string;
  commercialUse: boolean;
}

export async function keywordSearch(
  searchQuery: string,
  opts?: SearchOptions,
): Promise<InternalSearchHit[]> {
  const maxResults = opts?.maxResults ?? 10;
  const filter = buildDocumentFilterClause(opts?.filters, 3);
  const sql = `
    SELECT
      rd.id AS doc_id,
      rd.source_id,
      ds.name AS source_name,
      ds.license,
      ds.commercial_use,
      rd.raw_json,
      ts_rank(to_tsvector('english', rd.raw_json::text), plainto_tsquery('english', $1)) AS rank
    FROM raw_documents rd
    JOIN data_sources ds ON ds.id = rd.source_id
    WHERE to_tsvector('english', rd.raw_json::text) @@ plainto_tsquery('english', $1)${filter.sql}
    ORDER BY rank DESC
    LIMIT $2
  `;

  const result = await query(sql, [searchQuery, maxResults, ...filter.params]);

  return result.rows.map((row: Record<string, unknown>) => {
    const raw = row.raw_json as Record<string, unknown>;
    return {
      docId: Number(row.doc_id),
      title: String(raw.title ?? "Untitled"),
      url: extractUrl(raw),
      snippet: String(raw.abstract ?? "").slice(0, 300),
      sourceId: String(row.source_id),
      sourceName: String(row.source_name),
      publishedAt: raw.publication_date as string | undefined,
      score: Number(row.rank) * 100,
      license: String(row.license),
      commercialUse: Boolean(row.commercial_use),
    };
  });
}

function extractUrl(raw: Record<string, unknown>): string {
  if (typeof raw.doi === "string" && raw.doi) return `https://doi.org/${raw.doi}`;
  const location = raw.primary_location as Record<string, unknown> | undefined;
  if (location?.landing_page_url) return String(location.landing_page_url);
  return String(raw.id ?? "");
}
