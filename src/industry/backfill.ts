import { getConnectorDefaultIndustryTag } from "../collect/industryTag";
import { query } from "../storage/db";

/** 按 connector 默认映射回填 NULL industry_tag（U-L1-9 子集） */
export async function backfillIndustryTagsFromSourceDefaults(opts?: {
  sourceId?: string;
  dryRun?: boolean;
}): Promise<{ updated: number; preview: number }> {
  const sourceFilter = opts?.sourceId?.trim();
  const dryRun = opts?.dryRun === true;

  const res = await query<{ source_id: string; cnt: string }>(
    `SELECT source_id, COUNT(*)::text AS cnt
     FROM raw_documents
     WHERE industry_tag IS NULL
       ${sourceFilter ? "AND source_id = $1" : ""}
     GROUP BY source_id
     ORDER BY source_id`,
    sourceFilter ? [sourceFilter] : [],
  );

  let updated = 0;
  let preview = 0;

  for (const row of res.rows) {
    const tag = getConnectorDefaultIndustryTag(row.source_id);
    if (!tag) continue;
    const cnt = Number(row.cnt);
    preview += cnt;
    if (dryRun) continue;

    const upd = await query(
      `UPDATE raw_documents
       SET industry_tag = $2
       WHERE source_id = $1 AND industry_tag IS NULL`,
      [row.source_id, tag],
    );
    updated += upd.rowCount ?? 0;
  }

  return { updated, preview };
}
