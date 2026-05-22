import { query } from "../db";

export interface BeaCatalogRow extends Record<string, unknown> {
  dataset_name: string;
  table_name: string;
  title: string | null;
  description: string | null;
  tier: string;
  collect_enabled: boolean;
}

export interface BeaCatalogUpsertInput {
  datasetName: string;
  tableName: string;
  title?: string | null;
  description?: string | null;
  tier?: string;
  collectEnabled?: boolean;
  metadataJson?: unknown;
}

export async function upsertBeaCatalogTable(
  input: BeaCatalogUpsertInput,
): Promise<void> {
  await query(
    `INSERT INTO bea_catalog_tables (
      dataset_name, table_name, title, description,
      tier, collect_enabled, metadata_json, last_catalog_sync_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
    ON CONFLICT (dataset_name, table_name) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      tier = EXCLUDED.tier,
      collect_enabled = EXCLUDED.collect_enabled,
      metadata_json = EXCLUDED.metadata_json,
      last_catalog_sync_at = NOW(),
      updated_at = NOW()`,
    [
      input.datasetName,
      input.tableName,
      input.title ?? null,
      input.description ?? null,
      input.tier ?? "C",
      input.collectEnabled ?? false,
      input.metadataJson != null ? JSON.stringify(input.metadataJson) : null,
    ],
  );
}

export async function applyYamlTiersToBeaCatalog(
  entries: Array<{
    datasetName: string;
    tableName: string;
    tier: string;
    collectEnabled: boolean;
  }>,
): Promise<void> {
  for (const e of entries) {
    await query(
      `UPDATE bea_catalog_tables
       SET tier = $3, collect_enabled = $4, updated_at = NOW()
       WHERE dataset_name = $1 AND table_name = $2`,
      [e.datasetName, e.tableName, e.tier, e.collectEnabled],
    );
  }
}

export async function listBeaCatalogTables(opts?: {
  collectEnabledOnly?: boolean;
  datasetName?: string;
}): Promise<BeaCatalogRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts?.collectEnabledOnly) clauses.push("collect_enabled = true");
  if (opts?.datasetName) {
    params.push(opts.datasetName);
    clauses.push(`dataset_name = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await query<BeaCatalogRow>(
    `SELECT dataset_name, table_name, title, description, tier, collect_enabled
     FROM bea_catalog_tables ${where}
     ORDER BY dataset_name, table_name`,
    params,
  );
  return res.rows;
}

export async function searchBeaCatalogByTitle(
  q: string,
  limit: number,
): Promise<BeaCatalogRow[]> {
  const pattern = `%${q}%`;
  const res = await query<BeaCatalogRow>(
    `SELECT dataset_name, table_name, title, description, tier, collect_enabled
     FROM bea_catalog_tables
     WHERE title ILIKE $1 OR table_name ILIKE $1 OR dataset_name ILIKE $1
     ORDER BY tier, dataset_name, table_name
     LIMIT $2`,
    [pattern, limit],
  );
  return res.rows;
}

export async function countBeaCatalogTables(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM bea_catalog_tables`,
  );
  return parseInt(res.rows[0]?.count ?? "0", 10);
}
