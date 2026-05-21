import { query } from "./db";

export {
  clearSourceData,
  previewSourceClear,
  type ClearSourceDataOptions,
  type SourceClearPreview,
} from "./clearSourceData";

/** 业务数据表（全库 TRUNCATE；按源清空走 DELETE） */
export const DATA_TABLES = [
  "collection_job_events",
  "document_chunks",
  "raw_documents",
  "collection_jobs",
  "config_audit_log",
] as const;

/** 配置表（全库 TRUNCATE 时一并清空；按源仅删对应行） */
export const CONFIG_TABLES = ["collection_schedules", "data_sources"] as const;

/** 信源专属扩展表（整表归属该源，按源清空时 TRUNCATE） */
export const SOURCE_EXTENSION_TABLES: Readonly<
  Record<string, readonly string[]>
> = {
  eia: ["eia_catalog_routes"],
  eurostat: ["eurostat_catalog_datasets"],
};

const SOURCE_ID_RE = /^[a-z][a-z0-9_]*$/;

export type ClearDataOptions = {
  includeConfig?: boolean;
};

export function tablesToClear(opts: ClearDataOptions): readonly string[] {
  return opts.includeConfig
    ? [...DATA_TABLES, ...CONFIG_TABLES]
    : DATA_TABLES;
}

export function extensionTablesForSource(sourceId: string): readonly string[] {
  return SOURCE_EXTENSION_TABLES[sourceId] ?? [];
}

export function assertValidSourceId(sourceId: string): void {
  if (!SOURCE_ID_RE.test(sourceId)) {
    throw new Error(
      `invalid source_id: ${sourceId} (expected lowercase id like openalex, eia)`,
    );
  }
}

export async function assertClearableSource(sourceId: string): Promise<void> {
  assertValidSourceId(sourceId);
  const reg = await query(`SELECT 1 FROM data_sources WHERE id = $1`, [
    sourceId,
  ]);
  if (reg.rows.length > 0) return;

  const data = await query(
    `SELECT 1 AS ok FROM raw_documents WHERE source_id = $1 LIMIT 1
     UNION ALL
     SELECT 1 FROM collection_jobs WHERE source_id = $1 LIMIT 1`,
    [sourceId],
  );
  if (data.rows.length > 0) return;

  throw new Error(
    `unknown source_id: ${sourceId} (not in data_sources and no stored rows)`,
  );
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

/** TRUNCATE 全库业务表（及可选配置表），保留表结构 */
export async function clearPlatformData(opts: ClearDataOptions): Promise<void> {
  const tables = tablesToClear(opts);
  const list = tables.map(quoteIdent).join(", ");
  await query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`invalid table name: ${name}`);
  }
  return `"${name}"`;
}
