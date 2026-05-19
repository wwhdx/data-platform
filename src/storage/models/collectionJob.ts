import type { CollectionJob, CollectionJobStatus } from "../../types";
import { query } from "../db";

export async function createCollectionJob(params: {
  sourceId: string;
  query?: string;
}): Promise<CollectionJob> {
  const sql = `
    INSERT INTO collection_jobs (source_id, query, status)
    VALUES ($1, $2, 'running')
    RETURNING id, source_id, query, status, items_collected, started_at
  `;

  const result = await query(sql, [params.sourceId, params.query ?? null]);
  const row = result.rows[0]!;
  return rowToJob(row);
}

export async function updateCollectionJob(
  id: number,
  update: { status?: CollectionJobStatus; itemsCollected?: number; errorMessage?: string },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (update.status !== undefined) {
    sets.push(`status = $${i++}`);
    params.push(update.status);
    if (update.status === "success" || update.status === "failed") {
      sets.push(`finished_at = now()`);
    }
  }
  if (update.itemsCollected !== undefined) {
    sets.push(`items_collected = $${i++}`);
    params.push(update.itemsCollected);
  }
  if (update.errorMessage !== undefined) {
    sets.push(`error_message = $${i++}`);
    params.push(update.errorMessage);
  }

  if (sets.length === 0) return;

  params.push(id);
  await query(`UPDATE collection_jobs SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function listJobs(limit: number = 20): Promise<CollectionJob[]> {
  const result = await query(
    `SELECT * FROM collection_jobs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map(rowToJob);
}

/** 每个数据源最近一次采集任务（B14 schedules 报告） */
export async function getLatestJobPerSource(): Promise<Map<string, CollectionJob>> {
  const result = await query(
    `SELECT DISTINCT ON (source_id) *
     FROM collection_jobs
     ORDER BY source_id, started_at DESC`,
  );
  const map = new Map<string, CollectionJob>();
  for (const row of result.rows) {
    const job = rowToJob(row);
    map.set(job.sourceId, job);
  }
  return map;
}

function rowToJob(row: Record<string, unknown>): CollectionJob {
  return {
    id: Number(row.id),
    sourceId: String(row.source_id),
    query: row.query as string | undefined,
    status: String(row.status) as CollectionJobStatus,
    itemsCollected: Number(row.items_collected),
    errorMessage: row.error_message as string | undefined,
    startedAt: new Date(String(row.started_at)),
    finishedAt: row.finished_at ? new Date(String(row.finished_at)) : undefined,
  };
}
