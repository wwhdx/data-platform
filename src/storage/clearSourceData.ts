import { getPool, query } from "./db";
import {
  assertClearableSource,
  extensionTablesForSource,
  quoteIdent,
} from "./clearData";

export type ClearSourceDataOptions = {
  includeConfig?: boolean;
};

export type SourceClearPreview = {
  sourceId: string;
  raw_documents: number;
  document_chunks: number;
  collection_jobs: number;
  collection_job_events: number;
  config_audit_log: number;
  extensions: Record<string, number>;
  data_sources?: number;
  collection_schedules?: number;
};

export async function previewSourceClear(
  sourceId: string,
  opts: ClearSourceDataOptions = {},
): Promise<SourceClearPreview> {
  await assertClearableSource(sourceId);
  const includeConfig = opts.includeConfig === true;

  const [docs, chunks, jobs, events, audit] = await Promise.all([
    countWhere("raw_documents", "source_id = $1", [sourceId]),
    countChunksForSource(sourceId),
    countWhere("collection_jobs", "source_id = $1", [sourceId]),
    countJobEventsForSource(sourceId),
    countWhere("config_audit_log", "source_id = $1", [sourceId]),
  ]);

  const extensions: Record<string, number> = {};
  for (const table of extensionTablesForSource(sourceId)) {
    const res = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${quoteIdent(table)}`,
    );
    extensions[table] = Number(res.rows[0]?.count ?? 0);
  }

  const preview: SourceClearPreview = {
    sourceId,
    raw_documents: docs,
    document_chunks: chunks,
    collection_jobs: jobs,
    collection_job_events: events,
    config_audit_log: audit,
    extensions,
  };

  if (includeConfig) {
    preview.data_sources = await countWhere("data_sources", "id = $1", [
      sourceId,
    ]);
    preview.collection_schedules = await countWhere(
      "collection_schedules",
      "source_id = $1",
      [sourceId],
    );
  }

  return preview;
}

/** 按 source_id 删除业务数据；不触碰 data/export 等本地目录 */
export async function clearSourceData(
  sourceId: string,
  opts: ClearSourceDataOptions = {},
): Promise<void> {
  await assertClearableSource(sourceId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM collection_jobs WHERE source_id = $1`,
      [sourceId],
    );
    await client.query(
      `DELETE FROM raw_documents WHERE source_id = $1`,
      [sourceId],
    );
    await client.query(
      `DELETE FROM config_audit_log WHERE source_id = $1`,
      [sourceId],
    );

    for (const table of extensionTablesForSource(sourceId)) {
      await client.query(`TRUNCATE TABLE ${quoteIdent(table)} RESTART IDENTITY`);
    }

    if (opts.includeConfig) {
      await client.query(
        `DELETE FROM collection_schedules WHERE source_id = $1`,
        [sourceId],
      );
      await client.query(`DELETE FROM data_sources WHERE id = $1`, [sourceId]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function countWhere(
  table: string,
  where: string,
  params: unknown[],
): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${quoteIdent(table)} WHERE ${where}`,
    params,
  );
  return Number(res.rows[0]?.count ?? 0);
}

async function countChunksForSource(sourceId: string): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM document_chunks dc
     WHERE EXISTS (
       SELECT 1 FROM raw_documents rd
       WHERE rd.id = dc.doc_id AND rd.source_id = $1
     )`,
    [sourceId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

async function countJobEventsForSource(sourceId: string): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM collection_job_events e
     WHERE EXISTS (
       SELECT 1 FROM collection_jobs j
       WHERE j.id = e.job_id AND j.source_id = $1
     )`,
    [sourceId],
  );
  return Number(res.rows[0]?.count ?? 0);
}
