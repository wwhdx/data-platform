import { query } from "../db";

export interface EiaCatalogRouteRow extends Record<string, unknown> {
  path: string;
  parent_path: string | null;
  top_level: string;
  name: string | null;
  description: string | null;
  frequencies: unknown;
  facets: unknown;
  data_columns: unknown;
  tier: string;
  collect_enabled: boolean;
  needs_facet_plan: boolean;
  skip_reason: string | null;
  last_total_rows: string | null;
  metadata_json: unknown;
}

export interface EiaCatalogUpsertInput {
  path: string;
  parentPath?: string | null;
  topLevel: string;
  name?: string | null;
  description?: string | null;
  frequencies?: unknown;
  facets?: unknown;
  dataColumns?: unknown;
  tier?: string;
  collectEnabled?: boolean;
  needsFacetPlan?: boolean;
  skipReason?: string | null;
  lastTotalRows?: number | null;
  metadataJson?: unknown;
}

export async function upsertEiaCatalogRoute(
  input: EiaCatalogUpsertInput,
): Promise<void> {
  await query(
    `INSERT INTO eia_catalog_routes (
      path, parent_path, top_level, name, description,
      frequencies, facets, data_columns, tier, collect_enabled,
      needs_facet_plan, skip_reason, last_total_rows, metadata_json,
      last_catalog_sync_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
    ON CONFLICT (path) DO UPDATE SET
      parent_path = EXCLUDED.parent_path,
      top_level = EXCLUDED.top_level,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      frequencies = EXCLUDED.frequencies,
      facets = EXCLUDED.facets,
      data_columns = EXCLUDED.data_columns,
      tier = EXCLUDED.tier,
      collect_enabled = EXCLUDED.collect_enabled,
      needs_facet_plan = EXCLUDED.needs_facet_plan,
      skip_reason = EXCLUDED.skip_reason,
      last_total_rows = EXCLUDED.last_total_rows,
      metadata_json = EXCLUDED.metadata_json,
      last_catalog_sync_at = NOW(),
      updated_at = NOW()`,
    [
      input.path,
      input.parentPath ?? null,
      input.topLevel,
      input.name ?? null,
      input.description ?? null,
      input.frequencies != null ? JSON.stringify(input.frequencies) : null,
      input.facets != null ? JSON.stringify(input.facets) : null,
      input.dataColumns != null ? JSON.stringify(input.dataColumns) : null,
      input.tier ?? "C",
      input.collectEnabled ?? false,
      input.needsFacetPlan ?? false,
      input.skipReason ?? null,
      input.lastTotalRows ?? null,
      input.metadataJson != null ? JSON.stringify(input.metadataJson) : null,
    ],
  );
}

export async function applyYamlTiersToCatalog(
  entries: Array<{ path: string; tier: string; collectEnabled: boolean }>,
): Promise<void> {
  for (const e of entries) {
    await query(
      `UPDATE eia_catalog_routes
       SET tier = $2, collect_enabled = $3, updated_at = NOW()
       WHERE path = $1`,
      [e.path, e.tier, e.collectEnabled],
    );
  }
}

export async function listEiaCatalogRoutes(opts?: {
  topLevel?: string;
  collectEnabledOnly?: boolean;
}): Promise<EiaCatalogRouteRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts?.topLevel) {
    params.push(opts.topLevel);
    clauses.push(`top_level = $${params.length}`);
  }
  if (opts?.collectEnabledOnly) {
    clauses.push("collect_enabled = true");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await query<EiaCatalogRouteRow>(
    `SELECT path, parent_path, top_level, name, description,
            frequencies, facets, data_columns, tier, collect_enabled,
            needs_facet_plan, skip_reason, last_total_rows::text, metadata_json
     FROM eia_catalog_routes ${where}
     ORDER BY top_level, path`,
    params,
  );
  return res.rows;
}

export async function searchEiaCatalogByName(
  q: string,
  limit: number,
): Promise<EiaCatalogRouteRow[]> {
  const pattern = `%${q}%`;
  const res = await query<EiaCatalogRouteRow>(
    `SELECT path, parent_path, top_level, name, description,
            frequencies, facets, data_columns, tier, collect_enabled,
            needs_facet_plan, skip_reason, last_total_rows::text, metadata_json
     FROM eia_catalog_routes
     WHERE name ILIKE $1 OR description ILIKE $1 OR path ILIKE $1
     ORDER BY tier, path
     LIMIT $2`,
    [pattern, limit],
  );
  return res.rows;
}

export async function countEiaCatalogByTopLevel(): Promise<
  Array<{ top_level: string; count: string }>
> {
  const res = await query<{ top_level: string; count: string }>(
    `SELECT top_level, COUNT(*)::text AS count
     FROM eia_catalog_routes
     GROUP BY top_level
     ORDER BY top_level`,
  );
  return res.rows;
}
