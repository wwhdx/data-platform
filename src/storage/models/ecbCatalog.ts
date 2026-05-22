import { query } from "../db";

export interface EcbCatalogRow extends Record<string, unknown> {
  agency: string;
  flow_id: string;
  name: string | null;
  description: string | null;
  tier: string;
  collect_enabled: boolean;
  metadata_json: unknown;
}

export interface EcbCatalogUpsertInput {
  agency: string;
  flowId: string;
  name?: string | null;
  description?: string | null;
  tier?: string;
  collectEnabled?: boolean;
  metadataJson?: unknown;
}

export async function upsertEcbCatalogDataflow(
  input: EcbCatalogUpsertInput,
): Promise<void> {
  await query(
    `INSERT INTO ecb_catalog_dataflows (
      agency, flow_id, name, description, tier, collect_enabled,
      metadata_json, last_catalog_sync_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
    ON CONFLICT (agency, flow_id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      tier = EXCLUDED.tier,
      collect_enabled = EXCLUDED.collect_enabled,
      metadata_json = EXCLUDED.metadata_json,
      last_catalog_sync_at = NOW(),
      updated_at = NOW()`,
    [
      input.agency,
      input.flowId,
      input.name ?? null,
      input.description ?? null,
      input.tier ?? "C",
      input.collectEnabled ?? false,
      input.metadataJson != null ? JSON.stringify(input.metadataJson) : null,
    ],
  );
}

export async function applyYamlTiersToEcbCatalog(
  entries: Array<{ agency: string; flowId: string; tier: string; collectEnabled: boolean }>,
): Promise<void> {
  for (const e of entries) {
    await query(
      `UPDATE ecb_catalog_dataflows
       SET tier = $3, collect_enabled = $4, updated_at = NOW()
       WHERE agency = $1 AND flow_id = $2`,
      [e.agency, e.flowId, e.tier, e.collectEnabled],
    );
  }
}

export async function listEcbCatalogDataflows(opts?: {
  collectEnabledOnly?: boolean;
}): Promise<EcbCatalogRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts?.collectEnabledOnly) {
    clauses.push("collect_enabled = true");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await query<EcbCatalogRow>(
    `SELECT agency, flow_id, name, description, tier, collect_enabled, metadata_json
     FROM ecb_catalog_dataflows ${where}
     ORDER BY flow_id`,
    params,
  );
  return res.rows;
}

export async function searchEcbCatalogByName(
  q: string,
  limit: number,
): Promise<EcbCatalogRow[]> {
  const pattern = `%${q}%`;
  const res = await query<EcbCatalogRow>(
    `SELECT agency, flow_id, name, description, tier, collect_enabled, metadata_json
     FROM ecb_catalog_dataflows
     WHERE name ILIKE $1 OR flow_id ILIKE $1 OR description ILIKE $1
     ORDER BY tier, flow_id
     LIMIT $2`,
    [pattern, limit],
  );
  return res.rows;
}

export async function countEcbCatalogDataflows(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ecb_catalog_dataflows`,
  );
  return parseInt(res.rows[0]?.count ?? "0", 10);
}
