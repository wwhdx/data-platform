import { embedQuery } from "../rag/embed";
import { UODE_COLD_START_NOVELTY } from "../rag/domainSignal";
import { query } from "../storage/db";

export interface NoveltyResult {
  maxDistance: number;
  noveltyScore: number;
  topK: Array<{ articleId: string; title: string; distance: number }>;
  vectorCount: number;
  coldStart: boolean;
}

export async function computeNovelty(
  synopsis: string,
  industryTag?: string | null,
  topK = 5,
): Promise<NoveltyResult> {
  const tag = industryTag ?? null;
  const { rows: cnt } = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM opportunity_vectors
     WHERE status='validated' AND ($1::text IS NULL OR industry_tag=$1)`,
    [tag],
  );
  const vectorCount = Number(cnt[0]?.n ?? 0);
  if (vectorCount === 0) {
    return {
      maxDistance: 0.7,
      noveltyScore: UODE_COLD_START_NOVELTY,
      topK: [],
      vectorCount: 0,
      coldStart: true,
    };
  }

  const { embedding } = await embedQuery(synopsis);
  const vecJson = JSON.stringify(embedding);
  const { rows } = await query<{
    article_id: string;
    title: string;
    dist: string;
  }>(
    `SELECT article_id, title, (embedding <=> $1::vector) AS dist
     FROM opportunity_vectors
     WHERE status='validated' AND ($2::text IS NULL OR industry_tag=$2)
     ORDER BY dist ASC LIMIT $3`,
    [vecJson, tag, topK],
  );

  if (rows.length === 0) {
    return {
      maxDistance: 0.7,
      noveltyScore: UODE_COLD_START_NOVELTY,
      topK: [],
      vectorCount,
      coldStart: true,
    };
  }

  const distances = rows.map((r) => Number(r.dist));
  const maxDist = Math.max(...distances);
  return {
    maxDistance: maxDist,
    noveltyScore: Math.min(100, Math.round(maxDist * 50)),
    topK: rows.map((r) => ({
      articleId: r.article_id,
      title: r.title,
      distance: Number(r.dist),
    })),
    vectorCount,
    coldStart: false,
  };
}
