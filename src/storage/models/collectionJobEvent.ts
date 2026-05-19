import { query } from "../db";

export type CollectionJobEventLevel = "debug" | "info" | "warn" | "error";

export interface CollectionJobEvent {
  id: number;
  jobId: number;
  ts: Date;
  level: CollectionJobEventLevel;
  eventType: string;
  payload: Record<string, unknown>;
}

export async function insertCollectionJobEvent(params: {
  jobId: number;
  level?: CollectionJobEventLevel;
  eventType: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO collection_job_events (job_id, level, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      params.jobId,
      params.level ?? "info",
      params.eventType,
      JSON.stringify(params.payload ?? {}),
    ],
  );
}

export async function listJobEvents(
  jobId: number,
  limit = 100,
): Promise<CollectionJobEvent[]> {
  const result = await query(
    `SELECT id, job_id, ts, level, event_type, payload
     FROM collection_job_events
     WHERE job_id = $1
     ORDER BY ts ASC, id ASC
     LIMIT $2`,
    [jobId, limit],
  );

  return result.rows.map(row => ({
    id: Number(row.id),
    jobId: Number(row.job_id),
    ts: new Date(String(row.ts)),
    level: String(row.level) as CollectionJobEventLevel,
    eventType: String(row.event_type),
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));
}
