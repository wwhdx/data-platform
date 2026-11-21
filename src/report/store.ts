import { getPool } from "../storage/db";
import { prepareReportSource } from "./prepareSource";
import { sampleActivity } from "./sampleTime";
import { redactSecrets } from "./sanitize";
import type { ReportDocument, ReportSource } from "./types";
import type { PoolClient } from "pg";

/** Atomically import a report; repeated imports of the same snapshot are idempotent. */
export async function saveReport(report: ReportDocument, client?: PoolClient): Promise<number> {
  if (report.schemaVersion !== 1 || !Number.isFinite(Date.parse(report.generatedAt)) || !Array.isArray(report.sources)) {
    throw new RangeError("无效报表：需要 schemaVersion=1、generatedAt 和 sources");
  }
  if (new Set(report.sources.map((s) => s.id)).size !== report.sources.length) throw new RangeError("报表包含重复 source id");
  const db = client ?? await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('data-platform-report-import'))");
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO report_runs(generated_at, environment, duration_ms, summary, warnings)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT(generated_at) DO NOTHING RETURNING id`,
      [report.generatedAt, report.environment, report.durationMs, JSON.stringify(report.summary),
        JSON.stringify(report.warnings.map((warning) => ({ ...warning, message: redactSecrets(warning.message) })))],
    );
    if (!inserted.rows[0]) {
      const existing = await db.query<{ id: string }>("SELECT id FROM report_runs WHERE generated_at=$1", [report.generatedAt]);
      await db.query("COMMIT");
      return Number(existing.rows[0].id);
    }
    const runId = Number(inserted.rows[0].id);
    const prior = await db.query<{ snapshot: ReportSource }>(
      `SELECT snapshot FROM report_sources WHERE run_id=(
         SELECT id FROM report_runs WHERE generated_at<$1 ORDER BY generated_at DESC, id DESC LIMIT 1)`,
      [report.generatedAt],
    );
    const previous = new Map(prior.rows.map((r) => [r.snapshot.id, r.snapshot.sample]));
    for (const source of report.sources) {
      const prepared = prepareReportSource(source, previous.get(source.id), source.id, report.generatedAt);
      const f = prepared.freshness!;
      await db.query(
        `INSERT INTO report_sources(run_id,source_id,name,enabled,kind,industry,protocol,
         probe_status,sample_ok,stale,freshness_group,content_at,recent_items,sample_count,snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [runId, source.id, source.name, source.enabled, source.sample.kind, source.industry, source.protocol,
          source.probe.status, source.sample.ok, source.sample.stale, f.group,
          f.latestContentTimestamp == null ? null : new Date(f.latestContentTimestamp), f.recentItems,
          prepared.sample.items.length, JSON.stringify(prepared)],
      );
      for (const [ordinal, item] of prepared.sample.items.entries()) {
        const time = sampleActivity(item, report.generatedAt);
        await db.query(
          "INSERT INTO report_items(run_id,source_id,item_id,ordinal,content_at,item) VALUES ($1,$2,$3,$4,$5,$6)",
          [runId, source.id, item.id, ordinal, time ? new Date(time.timestamp) : null, JSON.stringify(item)],
        );
      }
    }
    await db.query("COMMIT");
    return runId;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    if (!client) db.release();
  }
}
