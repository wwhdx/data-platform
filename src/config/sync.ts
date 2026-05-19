import { query } from "../storage/db";
import type { DataPlatformConfig } from "./types";

/**
 * 将 YAML 配置同步到数据库。
 *
 * 策略：
 *   - 新源 → INSERT
 *   - 已存在且 updated_at IS NULL → UPDATE（从未被 API 修改过）
 *   - 已存在且 updated_at IS NOT NULL → SKIP（API 做过运行时修改，保留 DB 值）
 */
export async function syncToDb(config: DataPlatformConfig): Promise<{
  inserted: number;
  updated: number;
  skipped: number;
}> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const s of config.sources) {
    // 检查是否已存在
    const existing = await query(
      `SELECT id, updated_at FROM data_sources WHERE id = $1`,
      [s.id],
    );

    if (existing.rows.length === 0) {
      await query(
        `INSERT INTO data_sources (id, name, base_url, auth_type, rate_limit, license, commercial_use, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
        [
          s.id,
          s.name,
          s.base_url,
          s.auth_type,
          s.rate_limit,
          s.license,
          s.commercial_use,
          s.enabled ? "active" : "disabled",
        ],
      );
      inserted++;
      continue;
    }

    const updatedAt = existing.rows[0]!.updated_at as string | null;

    if (updatedAt === null) {
      // 从未被 API 修改过，可以安全地用 YAML 覆盖
      await query(
        `UPDATE data_sources
         SET name = $2, base_url = $3, auth_type = $4, rate_limit = $5,
             license = $6, commercial_use = $7, status = $8, updated_at = NULL
         WHERE id = $1`,
        [
          s.id,
          s.name,
          s.base_url,
          s.auth_type,
          s.rate_limit,
          s.license,
          s.commercial_use,
          s.enabled ? "active" : "disabled",
        ],
      );
      updated++;
      continue;
    }

    // API 做过运行时修改，保留 DB 值
    skipped++;
  }

  if (inserted + updated > 0) {
    console.log(
      `[config] 同步完成: ${inserted} 新源, ${updated} 覆盖, ${skipped} 跳过 (API 已修改)`,
    );
  }

  return { inserted, updated, skipped };
}
