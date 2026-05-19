import type { FastifyPluginAsync } from "fastify";
import type { SearchRequest, SearchResponse } from "../../types";
import { hybridSearch } from "../../rag/retriever";

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.post("/search", async (req, reply) => {
    const body = req.body as SearchRequest;
    const query = body?.query?.trim();

    if (!query) {
      return reply.status(400).send({
        error: "query is required",
        results: [],
        totalCount: 0,
        tookMs: 0,
      } satisfies SearchResponse);
    }

    const start = Date.now();

    // Phase 2: 混合检索（语义 + 关键词 + RRF）
    // 语义搜索失败时自动降级为纯关键词搜索
    const results = await hybridSearch(query, {
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

  app.get("/sources", async (_req, reply) => {
    const { query } = await import("../../storage/db");
    try {
      const result = await query(
        `SELECT ds.*,
          (SELECT COUNT(*) FROM raw_documents WHERE source_id = ds.id) AS total_docs,
          (SELECT MAX(fetched_at) FROM raw_documents WHERE source_id = ds.id) AS last_fetch
         FROM data_sources ds ORDER BY ds.id`
      );
      return reply.send(result.rows);
    } catch {
      return reply.send([]);
    }
  });
};
