import { getPool } from "../storage/db";
import type { ReportSource } from "./types";
import {
  ReportNotFound, validateReportQuery,
  type ReportDb, type ReportItemResult, type ReportPage, type ReportQuery,
} from "./queryTypes";

export async function reportRun(db: ReportDb, runId?: number): Promise<{ id: number; generatedAt: string }> {
  const { rows } = await db.query<{ id: string; generated_at: Date }>(
    "SELECT id, generated_at FROM report_runs WHERE ($1::bigint IS NULL OR id=$1) ORDER BY generated_at DESC, id DESC LIMIT 1",
    [runId ?? null],
  );
  if (!rows[0]) throw new ReportNotFound("暂无报表，请先运行 report import 或生成并入库报表");
  return { id: Number(rows[0].id), generatedAt: rows[0].generated_at.toISOString() };
}

function filterClause(opts: ReportQuery, values: unknown[], items: boolean): string {
  const parts = ["run_id=$1"];
  for (const [column, value] of [
    ["source_id", opts.source], ["kind", opts.kind], ["industry", opts.industry],
    ["probe_status", opts.status], ["freshness_group", opts.group],
  ]) {
    if (value) { values.push(value); parts.push(`${column}=$${values.length}`); }
  }
  if (opts.query) {
    values.push(`%${opts.query.replace(/[\\%_]/g, "\\$&")}%`);
    const text = items ? "item->>'title'" : "concat_ws(' ', source_id, name, snapshot #>> '{sample,items}')";
    parts.push(`${text} ILIKE $${values.length}`);
  }
  if (opts.withSample && !items) parts.push("sample_count>0");
  return parts.join(" AND ");
}

/** All presentation orders live in SQL. CLI, HTTP and static exports call this query. */
export async function queryReportSources(opts: ReportQuery = {}, db: ReportDb = getPool()): Promise<ReportPage<ReportSource>> {
  validateReportQuery(opts);
  const run = await reportRun(db, opts.runId);
  const values: unknown[] = [run.id];
  const where = filterClause(opts, values, false);
  const order = opts.order === "name" ? "name COLLATE \"C\", source_id COLLATE \"C\""
    : opts.order === "issues" ? "issue_rank, freshness_rank, content_at DESC NULLS LAST, source_id COLLATE \"C\""
    : "freshness_rank, content_at DESC NULLS LAST, recent_items::float/NULLIF(sample_count,0) DESC NULLS LAST, stale, source_id COLLATE \"C\"";
  const count = await db.query<{ total: string }>(`SELECT COUNT(*) AS total FROM report_source_overview WHERE ${where}`, values);
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const { rows } = await db.query<{ snapshot: ReportSource }>(
    `SELECT jsonb_set(snapshot, '{sample,items}', COALESCE((
       SELECT jsonb_agg(i.item ORDER BY i.content_at DESC NULLS LAST, i.item->>'period' DESC NULLS LAST, i.ordinal)
       FROM report_items i WHERE i.run_id=report_source_overview.run_id AND i.source_id=report_source_overview.source_id
     ), '[]'::jsonb)) AS snapshot
     FROM report_source_overview WHERE ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );
  return { runId: run.id, generatedAt: run.generatedAt, total: Number(count.rows[0].total), limit, offset, rows: rows.map((r) => r.snapshot) };
}

export async function queryReportItems(opts: ReportQuery = {}, db: ReportDb = getPool()): Promise<ReportPage<ReportItemResult>> {
  validateReportQuery(opts);
  const run = await reportRun(db, opts.runId);
  const values: unknown[] = [run.id];
  const where = filterClause(opts, values, true);
  const count = await db.query<{ total: string }>(`SELECT COUNT(*) AS total FROM report_item_catalog WHERE ${where}`, values);
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const order = opts.order === "name" ? 'source_name COLLATE "C", content_at DESC NULLS LAST, item->>\'period\' DESC NULLS LAST, ordinal'
    : opts.order === "issues" ? 'issue_rank, freshness_rank, content_at DESC NULLS LAST, source_id COLLATE "C", item->>\'period\' DESC NULLS LAST, ordinal'
    : 'content_at DESC NULLS LAST, source_id COLLATE "C", item->>\'period\' DESC NULLS LAST, ordinal';
  const { rows } = await db.query<{
    source_id: string; source_name: string; kind: string; industry: string | null;
    stale: boolean; content_at: Date | null; item: ReportItemResult["item"];
  }>(
    `SELECT source_id, source_name, kind, industry, stale, content_at, item FROM report_item_catalog
     WHERE ${where} ORDER BY ${order}
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );
  return {
    runId: run.id, generatedAt: run.generatedAt, total: Number(count.rows[0].total), limit, offset,
    rows: rows.map((r) => ({ sourceId: r.source_id, sourceName: r.source_name, kind: r.kind,
      industry: r.industry, stale: r.stale, contentAt: r.content_at?.toISOString() ?? null, item: r.item })),
  };
}
