import type { DocumentProvenance, RawDocument, SearchResult, SearchOptions } from "../../types";
import { query } from "../db";
import { buildDocumentFilterClause } from "../../rag/searchFilters";
import type { ExportFilters, RawDocumentRow } from "../../export/types";

// ── CRUD ──

export interface InsertedRawRow extends RawDocumentRow {
  title: string;
  abstract: string;
}

/** @deprecated 使用 InsertedRawRow */
export type InsertedDoc = Pick<InsertedRawRow, "id" | "title" | "abstract">;

export async function insertRawDocuments(docs: RawDocument[]): Promise<InsertedRawRow[]> {
  if (docs.length === 0) return [];

  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const base = i * 5;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`,
    );
    params.push(
      d.sourceId,
      d.externalId,
      JSON.stringify(d.rawJson),
      d.collectionJobId ?? null,
      d.fetchProvenance ? JSON.stringify(d.fetchProvenance) : null,
    );
  }

  const sql = `
    INSERT INTO raw_documents (source_id, external_id, raw_json, collection_job_id, fetch_provenance)
    VALUES ${values.join(", ")}
    ON CONFLICT (source_id, external_id) DO UPDATE
      SET raw_json = EXCLUDED.raw_json,
          fetched_at = now(),
          collection_job_id = COALESCE(EXCLUDED.collection_job_id, raw_documents.collection_job_id)
    RETURNING id, source_id, external_id, raw_json, fetched_at, collection_job_id, fetch_provenance
  `;

  const result = await query(sql, params);
  return result.rows.map(row => mapInsertedRow(row as Record<string, unknown>));
}

function parseFetchProvenance(raw: unknown): DocumentProvenance | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as DocumentProvenance;
}

function mapInsertedRow(row: Record<string, unknown>): InsertedRawRow {
  const raw = row.raw_json as Record<string, unknown>;
  return {
    id: Number(row.id),
    sourceId: String(row.source_id),
    externalId: String(row.external_id),
    rawJson: raw,
    fetchedAt: new Date(String(row.fetched_at)),
    collectionJobId: row.collection_job_id != null ? Number(row.collection_job_id) : null,
    fetchProvenance: parseFetchProvenance(row.fetch_provenance),
    title: String(raw.title ?? ""),
    abstract: String(raw.abstract ?? ""),
  };
}

function buildExportWhere(
  filters: ExportFilters,
  paramStart: number,
): { sql: string; params: unknown[]; nextIdx: number } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let idx = paramStart;

  if (filters.sourceIds && filters.sourceIds.length > 0) {
    const ph = filters.sourceIds.map((_, i) => `$${idx + i}`).join(", ");
    parts.push(`rd.source_id IN (${ph})`);
    params.push(...filters.sourceIds);
    idx += filters.sourceIds.length;
  }
  if (filters.since) {
    parts.push(`rd.fetched_at >= $${idx}::date`);
    params.push(filters.since);
    idx++;
  }
  if (filters.until) {
    parts.push(`rd.fetched_at < ($${idx}::date + interval '1 day')`);
    params.push(filters.until);
    idx++;
  }
  if (filters.jobId != null) {
    parts.push(`rd.collection_job_id = $${idx}`);
    params.push(filters.jobId);
    idx++;
  }

  const sql = parts.length > 0 ? ` AND ${parts.join(" AND ")}` : "";
  return { sql, params, nextIdx: idx };
}

function mapExportRow(row: Record<string, unknown>): RawDocumentRow {
  return {
    id: Number(row.id),
    sourceId: String(row.source_id),
    externalId: String(row.external_id),
    rawJson: row.raw_json as Record<string, unknown>,
    fetchedAt: new Date(String(row.fetched_at)),
    collectionJobId: row.collection_job_id != null ? Number(row.collection_job_id) : null,
    fetchProvenance: parseFetchProvenance(row.fetch_provenance),
  };
}

export async function countRawDocumentsForExport(filters: ExportFilters): Promise<number> {
  const { sql, params, nextIdx } = buildExportWhere(filters, 1);
  const result = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM raw_documents rd WHERE 1=1${sql}`,
    params,
  );
  return Number(result.rows[0]?.c ?? 0);
}

export async function listRawDocumentsForExport(
  filters: ExportFilters,
  cursor: number,
  pageSize: number,
): Promise<RawDocumentRow[]> {
  const { sql, params, nextIdx } = buildExportWhere(filters, 2);
  const limitIdx = nextIdx;
  const result = await query(
    `SELECT rd.id, rd.source_id, rd.external_id, rd.raw_json, rd.fetched_at,
            rd.collection_job_id, rd.fetch_provenance
     FROM raw_documents rd
     WHERE rd.id > $1${sql}
     ORDER BY rd.id ASC
     LIMIT $${limitIdx}`,
    [cursor, ...params, pageSize],
  );
  return result.rows.map(r => mapExportRow(r as Record<string, unknown>));
}

/** 合并 patch 进 raw_json（用于 arXiv fulltext 等后处理） */
export async function patchRawDocumentJson(
  id: number,
  patch: Record<string, unknown>,
): Promise<InsertedRawRow> {
  const result = await query(
    `UPDATE raw_documents
     SET raw_json = raw_json || $2::jsonb,
         fetched_at = fetched_at
     WHERE id = $1
     RETURNING id, source_id, external_id, raw_json, fetched_at, collection_job_id, fetch_provenance`,
    [id, JSON.stringify(patch)],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`raw_documents id=${id} not found`);
  return mapInsertedRow(row as Record<string, unknown>);
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
