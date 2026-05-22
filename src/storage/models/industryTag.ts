import { query } from "../db";

export interface IndustryTagRow {
  name: string;
  isActive: boolean;
  activatedAt: Date | null;
}

export async function upsertIndustryTags(
  items: Array<{ name: string; isActive: boolean; activatedAt?: string | null }>,
): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const item of items) {
    await query(
      `INSERT INTO industry_tags (name, is_active, activated_at, updated_at)
       VALUES ($1, $2, $3::timestamptz, NOW())
       ON CONFLICT (name) DO UPDATE SET
         is_active = EXCLUDED.is_active,
         activated_at = EXCLUDED.activated_at,
         updated_at = NOW()`,
      [item.name, item.isActive, item.activatedAt ?? null],
    );
    upserted++;
  }
  return { upserted };
}

export async function listActiveIndustryTags(): Promise<string[]> {
  const { rows } = await query<{ name: string }>(
    "SELECT name FROM industry_tags WHERE is_active = true ORDER BY name",
  );
  return rows.map((r) => r.name);
}
