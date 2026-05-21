import { query } from "../db";

export interface FredCatalogCategoryRow extends Record<string, unknown> {
  category_id: number;
  name: string;
  parent_id: number | null;
  depth: number;
  category_path: string | null;
  tier: string;
  collect_enabled: boolean;
  is_leaf: boolean;
  metadata_json: unknown;
}

export interface FredCatalogSeriesRow extends Record<string, unknown> {
  series_id: string;
  title: string | null;
  category_id: number | null;
  tier: string;
  collect_enabled: boolean;
  metadata_json: unknown;
}

export interface FredCatalogCategoryUpsertInput {
  categoryId: number;
  name: string;
  parentId?: number | null;
  depth?: number;
  categoryPath?: string | null;
  tier?: string;
  collectEnabled?: boolean;
  isLeaf?: boolean;
  metadataJson?: unknown;
}

export interface FredCatalogSeriesUpsertInput {
  seriesId: string;
  title?: string | null;
  categoryId?: number | null;
  tier?: string;
  collectEnabled?: boolean;
  metadataJson?: unknown;
}

export async function upsertFredCatalogCategory(
  input: FredCatalogCategoryUpsertInput,
): Promise<void> {
  await query(
    `INSERT INTO fred_catalog_categories (
      category_id, name, parent_id, depth, category_path, tier, collect_enabled,
      is_leaf, metadata_json, last_catalog_sync_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
    ON CONFLICT (category_id) DO UPDATE SET
      name = EXCLUDED.name,
      parent_id = EXCLUDED.parent_id,
      depth = EXCLUDED.depth,
      category_path = EXCLUDED.category_path,
      tier = EXCLUDED.tier,
      collect_enabled = EXCLUDED.collect_enabled,
      is_leaf = EXCLUDED.is_leaf,
      metadata_json = EXCLUDED.metadata_json,
      last_catalog_sync_at = NOW(),
      updated_at = NOW()`,
    [
      input.categoryId,
      input.name,
      input.parentId ?? null,
      input.depth ?? 0,
      input.categoryPath ?? null,
      input.tier ?? "C",
      input.collectEnabled ?? false,
      input.isLeaf ?? false,
      input.metadataJson != null ? JSON.stringify(input.metadataJson) : null,
    ],
  );
}

export async function upsertFredCatalogSeries(
  input: FredCatalogSeriesUpsertInput,
): Promise<void> {
  await query(
    `INSERT INTO fred_catalog_series (
      series_id, title, category_id, tier, collect_enabled,
      metadata_json, last_catalog_sync_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
    ON CONFLICT (series_id) DO UPDATE SET
      title = EXCLUDED.title,
      category_id = EXCLUDED.category_id,
      tier = EXCLUDED.tier,
      collect_enabled = EXCLUDED.collect_enabled,
      metadata_json = EXCLUDED.metadata_json,
      last_catalog_sync_at = NOW(),
      updated_at = NOW()`,
    [
      input.seriesId.toUpperCase(),
      input.title ?? null,
      input.categoryId ?? null,
      input.tier ?? "C",
      input.collectEnabled ?? false,
      input.metadataJson != null ? JSON.stringify(input.metadataJson) : null,
    ],
  );
}

export async function applyYamlTiersToFredCatalogSeries(
  entries: Array<{ seriesId: string; tier: string; collectEnabled: boolean }>,
): Promise<void> {
  for (const e of entries) {
    await query(
      `UPDATE fred_catalog_series
       SET tier = $2, collect_enabled = $3, updated_at = NOW()
       WHERE series_id = $1`,
      [e.seriesId.toUpperCase(), e.tier, e.collectEnabled],
    );
  }
}

export async function listFredCatalogCategories(opts?: {
  topLevelPrefix?: string;
  collectEnabledOnly?: boolean;
}): Promise<FredCatalogCategoryRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts?.topLevelPrefix) {
    params.push(`${opts.topLevelPrefix}%`);
    clauses.push(`category_path ILIKE $${params.length}`);
  }
  if (opts?.collectEnabledOnly) {
    clauses.push("collect_enabled = true");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await query<FredCatalogCategoryRow>(
    `SELECT category_id, name, parent_id, depth, category_path, tier,
            collect_enabled, is_leaf, metadata_json
     FROM fred_catalog_categories ${where}
     ORDER BY category_path, category_id`,
    params,
  );
  return res.rows;
}

export async function listFredCatalogSeries(opts?: {
  collectEnabledOnly?: boolean;
}): Promise<FredCatalogSeriesRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts?.collectEnabledOnly) {
    clauses.push("collect_enabled = true");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await query<FredCatalogSeriesRow>(
    `SELECT series_id, title, category_id, tier, collect_enabled, metadata_json
     FROM fred_catalog_series ${where}
     ORDER BY tier, series_id`,
    params,
  );
  return res.rows;
}

export async function searchFredCatalogByName(
  q: string,
  limit: number,
): Promise<Array<FredCatalogCategoryRow | FredCatalogSeriesRow & { kind: string }>> {
  const pattern = `%${q}%`;
  const cats = await query<FredCatalogCategoryRow>(
    `SELECT category_id, name, parent_id, depth, category_path, tier,
            collect_enabled, is_leaf, metadata_json
     FROM fred_catalog_categories
     WHERE name ILIKE $1 OR category_path ILIKE $1
     ORDER BY depth, category_id
     LIMIT $2`,
    [pattern, limit],
  );
  const remaining = Math.max(0, limit - cats.rows.length);
  const series =
    remaining > 0
      ? await query<FredCatalogSeriesRow>(
          `SELECT series_id, title, category_id, tier, collect_enabled, metadata_json
           FROM fred_catalog_series
           WHERE title ILIKE $1 OR series_id ILIKE $1
           ORDER BY tier, series_id
           LIMIT $2`,
          [pattern, remaining],
        )
      : { rows: [] };
  return [
    ...cats.rows.map((r) => ({ ...r, kind: "category" })),
    ...series.rows.map((r) => ({ ...r, kind: "series" })),
  ];
}

export async function countFredCatalogByTopLevel(): Promise<
  Array<{ top_level: string; count: string }>
> {
  const res = await query<{ top_level: string; count: string }>(
    `SELECT COALESCE(NULLIF(split_part(category_path, '/', 1), ''), '(root)') AS top_level,
            COUNT(*)::text AS count
     FROM fred_catalog_categories
     GROUP BY 1
     ORDER BY 1`,
  );
  return res.rows;
}

export async function countFredCatalogCategories(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM fred_catalog_categories`,
  );
  return parseInt(res.rows[0]?.count ?? "0", 10);
}

export async function countFredCatalogSeries(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM fred_catalog_series`,
  );
  return parseInt(res.rows[0]?.count ?? "0", 10);
}
