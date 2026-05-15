import type { FastifyPluginAsync } from "fastify";
import { query } from "../../storage/db";
import type { HealthResponse, SourceStatus } from "../../types";

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get("/api/health", async (_req, reply) => {
    const dbOk = await query("SELECT 1")
      .then(() => "ok")
      .catch((e: Error) => e.message);

    const sources: SourceStatus[] = [];
    try {
      const result = await query(
        `SELECT ds.*,
          (SELECT COUNT(*) FROM raw_documents WHERE source_id = ds.id) AS total_docs,
          (SELECT MAX(fetched_at) FROM raw_documents WHERE source_id = ds.id) AS last_fetch
         FROM data_sources ds WHERE ds.status = 'active'`
      );
      for (const row of result.rows) {
        sources.push({
          id: String(row.id),
          name: String(row.name),
          license: String(row.license),
          commercialUse: Boolean(row.commercial_use),
          rateLimit: String(row.rate_limit ?? "unknown"),
          status: "healthy",
          lastCollectionAt: row.last_fetch ? String(row.last_fetch) : undefined,
          totalDocuments: Number(row.total_docs),
        });
      }
    } catch {
      // 表可能还未创建
    }

    const resp: HealthResponse = {
      ok: dbOk === "ok",
      uptime: process.uptime(),
      sources,
      db: dbOk,
    };

    return reply.status(dbOk === "ok" ? 200 : 503).send(resp);
  });
};
