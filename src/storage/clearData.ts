import { query } from "./db";

/** 业务数据表（清空后保留 data_sources / collection_schedules） */
export const DATA_TABLES = [
  "collection_job_events",
  "document_chunks",
  "raw_documents",
  "collection_jobs",
  "config_audit_log",
] as const;

/** 配置表（清空后需 pnpm cli config sync） */
export const CONFIG_TABLES = ["collection_schedules", "data_sources"] as const;

export type ClearDataOptions = {
  includeConfig?: boolean;
};

export function tablesToClear(opts: ClearDataOptions): readonly string[] {
  return opts.includeConfig
    ? [...DATA_TABLES, ...CONFIG_TABLES]
    : DATA_TABLES;
}

export async function countTableRows(
  tables: readonly string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const res = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${quoteIdent(table)}`,
    );
    counts[table] = Number(res.rows[0]?.count ?? 0);
  }
  return counts;
}

/** TRUNCATE … RESTART IDENTITY CASCADE，保留表结构与迁移产物（视图/扩展） */
export async function clearPlatformData(opts: ClearDataOptions): Promise<void> {
  const tables = tablesToClear(opts);
  const list = tables.map(quoteIdent).join(", ");
  await query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`invalid table name: ${name}`);
  }
  return `"${name}"`;
}
