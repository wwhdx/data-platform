import { getPool } from "../storage/db";
import { queryReportSources, reportRun } from "./queries";
import type { ReportDb, ReportOrder } from "./queryTypes";
import type { ReportDocument, ReportSource } from "./types";

async function allSources(runId: number, order: ReportOrder, db: ReportDb): Promise<ReportSource[]> {
  const sources: ReportSource[] = [];
  let total = Infinity;
  while (sources.length < total) {
    const page = await queryReportSources({ runId, order, limit: 1000, offset: sources.length }, db);
    total = page.total;
    sources.push(...page.rows);
    if (!page.rows.length) break;
  }
  return sources;
}

/** Snapshot IDs pin all queries so an import cannot mix two report generations. */
export async function loadStoredReport(runId?: number, db: ReportDb = getPool()): Promise<ReportDocument> {
  const run = await reportRun(db, runId);
  const { rows } = await db.query<{
    environment: string; duration_ms: number;
    summary: ReportDocument["summary"]; warnings: ReportDocument["warnings"];
  }>("SELECT environment,duration_ms,summary,warnings FROM report_runs WHERE id=$1", [run.id]);
  const recent = await allSources(run.id, "recent", db);
  const name = await allSources(run.id, "name", db);
  const issues = await allSources(run.id, "issues", db);
  return {
    schemaVersion: 1, generatedAt: run.generatedAt, environment: rows[0].environment,
    durationMs: rows[0].duration_ms, summary: rows[0].summary, warnings: rows[0].warnings,
    sources: recent,
    sourceOrders: { recent: recent.map((s) => s.id), name: name.map((s) => s.id), issues: issues.map((s) => s.id) },
  };
}
