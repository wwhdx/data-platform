import type { FastifyPluginAsync } from "fastify";
import { requireAdminKey } from "../middleware/adminAuth";
import { embedQuery, getEmbeddingModel } from "../../rag/embed";
import { computeNovelty } from "../../uode/computeNovelty";
import { query } from "../../storage/db";

export const opportunityVectorsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/distance", async (req, reply) => {
    const body = req.body as { synopsis?: string; industryTag?: string; topK?: number };
    const synopsis = body?.synopsis?.trim();
    if (!synopsis) {
      return reply.status(400).send({ error: "synopsis is required" });
    }
    const result = await computeNovelty(
      synopsis,
      body.industryTag ?? null,
      body.topK ?? 5,
    );
    return reply.send(result);
  });

  app.post("/upsert", async (req, reply) => {
    if (!requireAdminKey(req, reply)) return;
    const body = req.body as {
      articleId?: string;
      industryTag?: string;
      title?: string;
      synopsis?: string;
      status?: "pending" | "validated" | "rejected";
      scoreSh?: number;
    };
    const articleId = body?.articleId?.trim();
    const title = body?.title?.trim();
    const synopsis = body?.synopsis?.trim();
    if (!articleId || !title || !synopsis) {
      return reply.status(400).send({ error: "articleId, title, synopsis required" });
    }
    const status = body.status ?? "validated";
    const { embedding, model } = await embedQuery(synopsis);
    const { rows } = await query<{ id: number }>(
      `INSERT INTO opportunity_vectors
         (article_id, industry_tag, title, synopsis, embedding, embedding_model,
          status, score_sh, validated_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::vector,$6,$7,$8,
         CASE WHEN $7='validated' THEN NOW() ELSE NULL END, NOW())
       ON CONFLICT (article_id) DO UPDATE SET
         industry_tag=EXCLUDED.industry_tag, title=EXCLUDED.title, synopsis=EXCLUDED.synopsis,
         embedding=EXCLUDED.embedding, embedding_model=EXCLUDED.embedding_model,
         status=EXCLUDED.status, score_sh=EXCLUDED.score_sh,
         validated_at=CASE WHEN EXCLUDED.status='validated' THEN NOW() ELSE opportunity_vectors.validated_at END,
         updated_at=NOW()
       RETURNING id`,
      [
        articleId,
        body.industryTag ?? null,
        title,
        synopsis,
        JSON.stringify(embedding),
        model,
        status,
        body.scoreSh ?? null,
      ],
    );
    return reply.send({ id: rows[0]?.id, articleId, status });
  });

  app.get("/stats", async (req, reply) => {
    if (!requireAdminKey(req, reply)) return;
    const { rows } = await query<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text AS n FROM opportunity_vectors GROUP BY status`,
    );
    return reply.send({ byStatus: rows.map((r) => ({ status: r.status, count: Number(r.n) })) });
  });
};
