import type { SearchOptions } from "../types";

export interface FilterClause {
  sql: string;
  params: unknown[];
}

/** 构建 raw_documents + data_sources 上的检索过滤 SQL 片段（以 AND 开头）。 */
export function buildDocumentFilterClause(
  filters: SearchOptions["filters"] | undefined,
  startParamIndex: number,
): FilterClause {
  if (!filters) return { sql: "", params: [] };

  const parts: string[] = [];
  const params: unknown[] = [];
  let i = startParamIndex;

  if (filters.sourceIds?.length) {
    parts.push(`rd.source_id = ANY($${i})`);
    params.push(filters.sourceIds);
    i++;
  }

  if (filters.commercialUse === true) {
    parts.push("ds.commercial_use = true");
  } else if (filters.commercialUse === false) {
    parts.push("ds.commercial_use = false");
  }

  if (filters.dateFrom) {
    parts.push(`(rd.raw_json->>'publication_date')::date >= $${i}::date`);
    params.push(filters.dateFrom);
    i++;
  }

  if (filters.dateTo) {
    parts.push(`(rd.raw_json->>'publication_date')::date <= $${i}::date`);
    params.push(filters.dateTo);
    i++;
  }

  // contentType 依赖 Layer 2 富化表，MVP 尚未落地，暂不生成 SQL

  const sql = parts.length ? ` AND ${parts.join(" AND ")}` : "";
  return { sql, params };
}
