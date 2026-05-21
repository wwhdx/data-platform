import { query } from "../db";

export interface EurostatCatalogRow extends Record<string, unknown> {
  code: string;
  title: string | null;
  theme_path: string | null;
  type: string;
  tier: string;
  collect_enabled: boolean;
  last_data_update: string | null;
  last_structure_change: string | null;
  data_start: string | null;
  data_end: string | null;
  values_count: string | null;
  metadata_json: unknown;
}

export interface EurostatCatalogUpsertInput {
  code: string;
  title?: string | null;
  themePath?: string | null;
  type?: string;
  tier?: string;
  collectEnabled?: boolean;
  lastDataUpdate?: string | null;
  lastStructureChange?: string | null;
  dataStart?: string | null;
  dataEnd?: string | null;
  valuesCount?: number | null;
  metadataJson?: unknown;
}

export async function upsertEurostatCatalogDataset(
  input: EurostatCatalogUpsertInput,
): Promise<void> {
  await query(
    `INSERT INTO eurostat_catalog_datasets (
      code, title, theme_path, type, tier, collect_enabled,
      last_data_update, last_structure_change, data_start, data_end,
      values_count, metadata_json, last_catalog_sync_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
    ON CONFLICT (code) DO UPDATE SET
      title = EXCLUDED.title,
      theme_path = EXCLUDED.theme_path,
      type = EXCLUDED.type,
      tier = EXCLUDED.tier,
      collect_enabled = EXCLUDED.collect_enabled,
      last_data_update = EXCLUDED.last_data_update,
      last_structure_change = EXCLUDED.last_structure_change,
      data_start = EXCLUDED.data_start,
      data_end = EXCLUDED.data_end,
      values_count = EXCLUDED.values_count,
      metadata_json = EXCLUDED.metadata_json,
      last_catalog_sync_at = NOW(),
      updated_at = NOW()`,
    [
      input.code.toLowerCase(),
      input.title ?? null,
      input.themePath ?? null,
      input.type ?? "dataset",
      input.tier ?? "C",
      input.collectEnabled ?? false,
      input.lastDataUpdate ?? null,
      input.lastStructureChange ?? null,
      input.dataStart ?? null,
      input.dataEnd ?? null,
      input.valuesCount ?? null,
      input.metadataJson != null ? JSON.stringify(input.metadataJson) : null,
    ],
  );
}

export async function applyYamlTiersToEurostatCatalog(
  entries: Array<{ code: string; tier: string; collectEnabled: boolean }>,
): Promise<void> {
  for (const e of entries) {
    await query(
      `UPDATE eurostat_catalog_datasets
       SET tier = $2, collect_enabled = $3, updated_at = NOW()
       WHERE code = $1`,
      [e.code.toLowerCase(), e.tier, e.collectEnabled],
    );
  }
}

export async function listEurostatCatalogDatasets(opts?: {
  themePrefix?: string;
  collectEnabledOnly?: boolean;
}): Promise<EurostatCatalogRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts?.themePrefix) {
    params.push(`${opts.themePrefix}%`);
    clauses.push(`theme_path ILIKE $${params.length}`);
  }
  if (opts?.collectEnabledOnly) {
    clauses.push("collect_enabled = true");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await query<EurostatCatalogRow>(
    `SELECT code, title, theme_path, type, tier, collect_enabled,
            last_data_update, last_structure_change, data_start, data_end,
            values_count::text, metadata_json
     FROM eurostat_catalog_datasets ${where}
     ORDER BY theme_path, code`,
    params,
  );
  return res.rows;
}

export async function searchEurostatCatalogByName(
  q: string,
  limit: number,
): Promise<EurostatCatalogRow[]> {
  const pattern = `%${q}%`;
  const res = await query<EurostatCatalogRow>(
    `SELECT code, title, theme_path, type, tier, collect_enabled,
            last_data_update, last_structure_change, data_start, data_end,
            values_count::text, metadata_json
     FROM eurostat_catalog_datasets
     WHERE title ILIKE $1 OR code ILIKE $1 OR theme_path ILIKE $1
     ORDER BY tier, code
     LIMIT $2`,
    [pattern, limit],
  );
  return res.rows;
}

export async function countEurostatCatalogByTheme(): Promise<
  Array<{ theme_prefix: string; count: string }>
> {
  const res = await query<{ theme_prefix: string; count: string }>(
    `SELECT COALESCE(NULLIF(split_part(theme_path, '/', 1), ''), '(root)') AS theme_prefix,
            COUNT(*)::text AS count
     FROM eurostat_catalog_datasets
     GROUP BY 1
     ORDER BY 1`,
  );
  return res.rows;
}

export async function countEurostatCatalogDatasets(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM eurostat_catalog_datasets`,
  );
  return parseInt(res.rows[0]?.count ?? "0", 10);
}
