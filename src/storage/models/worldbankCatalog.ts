import { query } from "../db";

export interface WorldbankTopicRef {
  id: string;
  value?: string;
}

export interface WorldbankCatalogRow extends Record<string, unknown> {
  code: string;
  name: string | null;
  topic_ids: WorldbankTopicRef[];
  tier: string;
  collect_enabled: boolean;
  metadata_json: unknown;
}

export interface WorldbankCatalogUpsertInput {
  code: string;
  name?: string | null;
  topicIds?: WorldbankTopicRef[];
  tier?: string;
  collectEnabled?: boolean;
  metadataJson?: unknown;
}

export async function upsertWorldbankCatalogIndicator(
  input: WorldbankCatalogUpsertInput,
): Promise<void> {
  await query(
    `INSERT INTO worldbank_catalog_indicators (
      code, name, topic_ids, tier, collect_enabled,
      metadata_json, last_catalog_sync_at, updated_at
    ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,NOW(),NOW())
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      topic_ids = EXCLUDED.topic_ids,
      tier = EXCLUDED.tier,
      collect_enabled = EXCLUDED.collect_enabled,
      metadata_json = EXCLUDED.metadata_json,
      last_catalog_sync_at = NOW(),
      updated_at = NOW()`,
    [
      input.code,
      input.name ?? null,
      JSON.stringify(input.topicIds ?? []),
      input.tier ?? "C",
      input.collectEnabled ?? false,
      input.metadataJson != null ? JSON.stringify(input.metadataJson) : null,
    ],
  );
}

export async function applyYamlTiersToWorldbankCatalog(
  entries: Array<{ code: string; tier: string; collectEnabled: boolean }>,
): Promise<void> {
  for (const e of entries) {
    await query(
      `UPDATE worldbank_catalog_indicators
       SET tier = $2, collect_enabled = $3, updated_at = NOW()
       WHERE code = $1`,
      [e.code, e.tier, e.collectEnabled],
    );
  }
}

export async function listWorldbankCatalogIndicators(opts?: {
  topicId?: string;
  collectEnabledOnly?: boolean;
}): Promise<WorldbankCatalogRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts?.topicId) {
    params.push(opts.topicId);
    clauses.push(
      `EXISTS (SELECT 1 FROM jsonb_array_elements(topic_ids) t WHERE t->>'id' = $${params.length})`,
    );
  }
  if (opts?.collectEnabledOnly) {
    clauses.push("collect_enabled = true");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await query<WorldbankCatalogRow>(
    `SELECT code, name, topic_ids, tier, collect_enabled, metadata_json
     FROM worldbank_catalog_indicators ${where}
     ORDER BY code`,
    params,
  );
  return res.rows.map((r) => ({
    ...r,
    topic_ids: Array.isArray(r.topic_ids) ? r.topic_ids : [],
  }));
}

export async function searchWorldbankCatalogByName(
  q: string,
  limit: number,
): Promise<WorldbankCatalogRow[]> {
  const pattern = `%${q}%`;
  const res = await query<WorldbankCatalogRow>(
    `SELECT code, name, topic_ids, tier, collect_enabled, metadata_json
     FROM worldbank_catalog_indicators
     WHERE name ILIKE $1 OR code ILIKE $1
     ORDER BY tier, code
     LIMIT $2`,
    [pattern, limit],
  );
  return res.rows;
}

export async function countWorldbankCatalogByTopic(): Promise<
  Array<{ topic_id: string; topic_label: string; indicator_count: string }>
> {
  const res = await query<{
    topic_id: string;
    topic_label: string;
    indicator_count: string;
  }>(
    `SELECT t->>'id' AS topic_id,
            COALESCE(MAX(t->>'value'), t->>'id') AS topic_label,
            COUNT(*)::text AS indicator_count
     FROM worldbank_catalog_indicators,
          LATERAL jsonb_array_elements(topic_ids) AS t
     GROUP BY 1
     ORDER BY COUNT(*) DESC, 1`,
  );
  return res.rows;
}

export async function countWorldbankCatalogIndicators(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM worldbank_catalog_indicators`,
  );
  return parseInt(res.rows[0]?.count ?? "0", 10);
}
