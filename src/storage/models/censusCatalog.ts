import { query } from "../db";

export interface CensusCatalogRow extends Record<string, unknown> {
  dataset_path: string;
  vintage: number | null;
  title: string | null;
  description: string | null;
  dataset_type: string | null;
  tier: string;
  collect_enabled: boolean;
}

export interface CensusCatalogUpsertInput {
  datasetPath: string;
  vintage?: number | null;
  title?: string | null;
  description?: string | null;
  datasetType?: string | null;
  tier?: string;
  collectEnabled?: boolean;
  metadataJson?: unknown;
}

export async function upsertCensusCatalogDataset(
  input: CensusCatalogUpsertInput,
): Promise<void> {
  await query(
    `INSERT INTO census_catalog_datasets (
      dataset_path, vintage, title, description, dataset_type,
      tier, collect_enabled, metadata_json, last_catalog_sync_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
    ON CONFLICT (dataset_path) DO UPDATE SET
      vintage = EXCLUDED.vintage,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      dataset_type = EXCLUDED.dataset_type,
      tier = EXCLUDED.tier,
      collect_enabled = EXCLUDED.collect_enabled,
      metadata_json = EXCLUDED.metadata_json,
      last_catalog_sync_at = NOW(),
      updated_at = NOW()`,
    [
      input.datasetPath,
      input.vintage ?? null,
      input.title ?? null,
      input.description ?? null,
      input.datasetType ?? null,
      input.tier ?? "C",
      input.collectEnabled ?? false,
      input.metadataJson != null ? JSON.stringify(input.metadataJson) : null,
    ],
  );
}

export async function applyYamlTiersToCensusCatalog(
  entries: Array<{ datasetPath: string; tier: string; collectEnabled: boolean }>,
): Promise<void> {
  for (const e of entries) {
    await query(
      `UPDATE census_catalog_datasets
       SET tier = $2, collect_enabled = $3, updated_at = NOW()
       WHERE dataset_path = $1`,
      [e.datasetPath, e.tier, e.collectEnabled],
    );
  }
}

export async function listCensusCatalogDatasets(opts?: {
  collectEnabledOnly?: boolean;
}): Promise<CensusCatalogRow[]> {
  const clauses: string[] = [];
  if (opts?.collectEnabledOnly) clauses.push("collect_enabled = true");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await query<CensusCatalogRow>(
    `SELECT dataset_path, vintage, title, description, dataset_type, tier, collect_enabled
     FROM census_catalog_datasets ${where}
     ORDER BY dataset_path`,
  );
  return res.rows;
}

export async function searchCensusCatalogByTitle(
  q: string,
  limit: number,
): Promise<CensusCatalogRow[]> {
  const pattern = `%${q}%`;
  const res = await query<CensusCatalogRow>(
    `SELECT dataset_path, vintage, title, description, dataset_type, tier, collect_enabled
     FROM census_catalog_datasets
     WHERE title ILIKE $1 OR dataset_path ILIKE $1 OR description ILIKE $1
     ORDER BY tier, dataset_path
     LIMIT $2`,
    [pattern, limit],
  );
  return res.rows;
}

export async function countCensusCatalogDatasets(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM census_catalog_datasets`,
  );
  return parseInt(res.rows[0]?.count ?? "0", 10);
}
