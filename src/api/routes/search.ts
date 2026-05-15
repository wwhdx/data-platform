import type { FastifyPluginAsync } from "fastify";
import type { SearchRequest, SearchResponse } from "../../types";
import { keywordSearch } from "../../storage/models/rawDocument";

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/search", async (req, reply) => {
    const body = req.body as SearchRequest;
    const query = body?.query?.trim();

    if (!query) {
      return reply.status(400).send({
        error: "query is required",
        results: [],
        totalCount: 0,
        tookMs: 0,
      });
    }

    const start = Date.now();
    const results = await keywordSearch(query, {
      maxResults: body.maxResults ?? 10,
      filters: body.filters,
    });

    const resp: SearchResponse = {
      results,
      totalCount: results.length,
      tookMs: Date.now() - start,
    };

    return reply.send(resp);
  });

  app.get("/api/sources", async (_req, reply) => {
    const { query } = await import("../../storage/db");
    try {
      const result = await query(
        `SELECT ds.*,
          (SELECT COUNT(*) FROM raw_documents WHERE source_id = ds.id) AS total_docs
         FROM data_sources ds ORDER BY ds.id`
      );
      return reply.send(result.rows);
    } catch {
      return reply.send([]);
    }
  });
};
