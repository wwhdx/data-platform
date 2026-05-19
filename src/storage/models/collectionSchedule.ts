import type { DataPlatformConfig } from "../../config/types";
import type { CollectionSchedule } from "../../types";
import { query } from "../db";

const DEFAULT_LOOKBACK_MS = 86_400_000;

/** 首次采集或尚无水位时的默认 since（与 Connector 默认 24h 对齐，UTC 日期） */
export function defaultCollectSinceDate(): string {
  return new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString().slice(0, 10);
}

/** 将 DB 水位转为传给 Connector 的 since（YYYY-MM-DD） */
export function toCollectSinceDate(lastCollectedAt?: Date | null): string {
  if (lastCollectedAt) {
    return lastCollectedAt.toISOString().slice(0, 10);
  }
  return defaultCollectSinceDate();
}

function rowToSchedule(row: Record<string, unknown>): CollectionSchedule {
  return {
    id: Number(row.id),
    sourceId: String(row.source_id),
    cronExpr: String(row.cron_expr),
    query: String(row.query ?? ""),
    enabled: Boolean(row.enabled),
    lastRunAt: row.last_run_at ? new Date(String(row.last_run_at)) : undefined,
    nextRunAt: row.next_run_at ? new Date(String(row.next_run_at)) : undefined,
    lastCollectedAt: row.last_collected_at
      ? new Date(String(row.last_collected_at))
      : undefined,
    lastCursor: row.last_cursor as string | undefined,
  };
}

export async function getScheduleBySourceId(
  sourceId: string,
): Promise<CollectionSchedule | null> {
  const result = await query(
    `SELECT * FROM collection_schedules WHERE source_id = $1 LIMIT 1`,
    [sourceId],
  );
  if (result.rows.length === 0) return null;
  return rowToSchedule(result.rows[0]!);
}

/** 采集前确保有调度行（手动 trigger 且未 sync YAML 时 lazy 创建） */
export async function ensureScheduleRow(sourceId: string): Promise<CollectionSchedule> {
  const existing = await getScheduleBySourceId(sourceId);
  if (existing) return existing;

  const result = await query(
    `INSERT INTO collection_schedules (source_id, cron_expr, query, enabled)
     VALUES ($1, '0 0 * * *', '', true)
     ON CONFLICT (source_id) DO UPDATE SET source_id = EXCLUDED.source_id
     RETURNING *`,
    [sourceId],
  );
  return rowToSchedule(result.rows[0]!);
}

export async function touchScheduleRunStart(sourceId: string): Promise<void> {
  await ensureScheduleRow(sourceId);
  await query(
    `UPDATE collection_schedules SET last_run_at = now() WHERE source_id = $1`,
    [sourceId],
  );
}

/** 仅成功 job 后推进增量水位 */
export async function markScheduleCollectionSuccess(sourceId: string): Promise<void> {
  await query(
    `UPDATE collection_schedules
     SET last_collected_at = now(), last_run_at = now()
     WHERE source_id = $1`,
    [sourceId],
  );
}

/** 将 YAML schedule 同步到 collection_schedules（保留 last_collected_at） */
export async function syncSchedulesToDb(
  config: DataPlatformConfig,
): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const s of config.sources) {
    const cron = s.schedule?.trim() ?? "";
    if (!cron) continue;

    await query(
      `INSERT INTO collection_schedules (source_id, cron_expr, query, enabled)
       VALUES ($1, $2, '', $3)
       ON CONFLICT (source_id) DO UPDATE SET
         cron_expr = EXCLUDED.cron_expr,
         enabled = EXCLUDED.enabled`,
      [s.id, cron, s.enabled],
    );
    upserted++;
  }
  return { upserted };
}
