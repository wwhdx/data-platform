import { query } from "../storage/db";
import type { DomainSignal, SearchResult } from "../types";

export const UODE_COLD_START_NOVELTY = 50;

const TRL_HIGH = ["已商业化", "规模化", "量产", "production", "成熟"];
const TRL_MID = ["pilot", "试点", "小规模", "示范", "验证"];
const TRL_LOW = ["concept", "概念", "理论验证", "实验室", "原型"];

export function extractTrlHint(text: string): string | undefined {
  const t = text.toLowerCase();
  for (const kw of TRL_HIGH) if (t.includes(kw)) return kw;
  for (const kw of TRL_MID) if (t.includes(kw)) return kw;
  for (const kw of TRL_LOW) if (t.includes(kw)) return kw;
  return undefined;
}

export function citationFromRaw(raw: Record<string, unknown>): number | undefined {
  const n = Number(raw.cited_by_count ?? raw.citationCount ?? 0);
  return n > 0 ? n : undefined;
}

export async function computeTrendScore(
  searchQuery: string,
  industryTag: string | null,
): Promise<{ trendScore: number; recentDocCount: number }> {
  const { rows } = await query<{
    recent: number;
    baseline: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE fetched_at >= NOW() - INTERVAL '90 days')::int AS recent,
       COUNT(*) FILTER (
         WHERE fetched_at >= NOW() - INTERVAL '180 days'
           AND fetched_at < NOW() - INTERVAL '90 days'
       )::int AS baseline
     FROM raw_documents rd
     WHERE to_tsvector('english', rd.raw_json::text) @@ plainto_tsquery('english', $1)
       AND ($2::text IS NULL OR rd.industry_tag = $2)`,
    [searchQuery, industryTag],
  );
  const recent = Number(rows[0]?.recent ?? 0);
  const baseline = Math.max(Number(rows[0]?.baseline ?? 0), 1);
  return {
    trendScore: Math.min(100, Math.max(0, Math.round((recent / baseline - 0.5) * 100))),
    recentDocCount: recent,
  };
}

/** top-3 结果附加 query 级 trend + 逐条 citation / TRL */
export async function enrichSearchResults(
  results: SearchResult[],
  searchQuery: string,
  industryTag: string | null,
): Promise<SearchResult[]> {
  if (results.length === 0) return results;

  const trend = await computeTrendScore(searchQuery, industryTag).catch(() => ({
    trendScore: 50,
    recentDocCount: 0,
  }));

  return results.map((r, i) => {
    const base: DomainSignal = {
      citationCount: r.citationCount,
      trlHint: extractTrlHint(r.snippet),
      industryTag: industryTag ?? undefined,
    };
    if (i < 3) {
      base.trendScore = trend.trendScore;
      base.recentDocCount = trend.recentDocCount;
    }
    return { ...r, domainSignal: base };
  });
}
