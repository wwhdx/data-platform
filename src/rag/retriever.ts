/**
 * 混合检索器：语义搜索（pgvector）+ 关键词搜索（tsvector）+ RRF 融合。
 */

import { embedQuery } from "./embed";
import { semanticSearch } from "./vectorStore";
import { keywordSearch } from "../storage/models/rawDocument";
import { query } from "../storage/db";
import type { SearchResult, SearchOptions } from "../types";
import type { InternalSearchHit } from "../storage/models/rawDocument";

/**
 * RRF 融合：rank = 1/(k + position)，k 默认 60。
 */
export function fuse(
  semantic: Array<{ docId: number; similarity: number }>,
  keywordHits: Array<{ docId: number; score?: number }>,
  k: number = 60,
): Map<number, number> {
  const scores = new Map<number, number>();

  semantic.forEach((item, i) => {
    scores.set(item.docId, 1 / (k + i + 1));
  });

  keywordHits.forEach((hit, i) => {
    const prev = scores.get(hit.docId) ?? 0;
    scores.set(hit.docId, prev + 1 / (k + i + 1));
  });

  return scores;
}

/**
 * 混合检索：并行语义 + 关键词 → RRF 融合 → 返回 topK。
 * 语义搜索失败时降级为纯关键词搜索。
 */
export async function hybridSearch(
  searchQuery: string,
  opts?: SearchOptions,
): Promise<SearchResult[]> {
  const topK = opts?.maxResults ?? 10;

  const [queryVec, keywordHits] = await Promise.all([
    embedQuery(searchQuery).catch(() => null),
    keywordSearch(searchQuery, { maxResults: 50 }).catch(() => [] as InternalSearchHit[]),
  ]);

  let semanticResults: Array<{ docId: number; similarity: number }> = [];
  if (queryVec) {
    semanticResults = await semanticSearch(queryVec.embedding, 50).catch(() => []);
  }

  if (semanticResults.length === 0) {
    return keywordHits.slice(0, topK);
  }

  if (keywordHits.length === 0) {
    return fetchDocumentsById(semanticResults.map(s => s.docId).slice(0, topK));
  }

  // RRF 融合
  const rrfScores = fuse(semanticResults, keywordHits);

  const sorted = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([docId, score]) => ({ docId, score }));

  return fetchDocumentsById(
    sorted.map(s => s.docId),
    sorted.map(s => s.score),
  );
}

async function fetchDocumentsById(
  docIds: number[],
  scores?: number[],
): Promise<SearchResult[]> {
  if (docIds.length === 0) return [];

  const placeholders = docIds.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `
    SELECT
      rd.id AS doc_id,
      rd.source_id,
      rd.raw_json,
      ds.name AS source_name,
      ds.license,
      ds.commercial_use
    FROM raw_documents rd
    JOIN data_sources ds ON ds.id = rd.source_id
    WHERE rd.id IN (${placeholders})
  `;

  const result = await query(sql, docIds);
  const rowMap = new Map<number, Record<string, unknown>>();
  for (const row of result.rows) {
    rowMap.set(Number(row.doc_id), row as unknown as Record<string, unknown>);
  }

  const out: SearchResult[] = [];
  for (let i = 0; i < docIds.length; i++) {
    const docId = docIds[i]!;
    const row = rowMap.get(docId);
    if (!row) continue;
    const raw = row.raw_json as Record<string, unknown>;
    out.push({
      title: String(raw.title ?? "Untitled"),
      url: extractUrl(raw),
      snippet: String(raw.abstract ?? "").slice(0, 300),
      sourceId: String(row.source_id),
      sourceName: String(row.source_name),
      publishedAt: raw.publication_date as string | undefined,
      score: scores?.[i] ?? 0,
      license: String(row.license),
      commercialUse: Boolean(row.commercial_use),
    });
  }
  return out;
}

function extractUrl(raw: Record<string, unknown>): string {
  if (typeof raw.doi === "string" && raw.doi) return `https://doi.org/${raw.doi}`;
  const location = raw.primary_location as Record<string, unknown> | undefined;
  if (location?.landing_page_url) return String(location.landing_page_url);
  return String(raw.id ?? "");
}
