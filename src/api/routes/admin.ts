import type { FastifyPluginAsync } from "fastify";
import { listJobs } from "../../storage/models/collectionJob";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // 手动触发采集
  app.post("/api/admin/collect", async (req, reply) => {
    const body = req.body as { sourceId?: string; query?: string } | null;
    const scheduler = app.scheduler;

    if (!scheduler) {
      return reply.status(500).send({ error: "scheduler not configured" });
    }

    const sourceId = body?.sourceId;

    if (sourceId) {
      try {
        const job = await scheduler.trigger(sourceId, body?.query);
        return reply.send(job);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    }

    // 触发所有已注册的 Connector
    const jobs = [];
    for (const id of ["openalex", "semanticscholar", "patentsview"]) {
      try {
        const job = await scheduler.trigger(id, body?.query ?? "");
        jobs.push(job);
      } catch {
        // 某些 Connector 可能未注册
      }
    }

    return reply.send({ jobs });
  });

  // 采集任务历史
  app.get("/api/admin/jobs", async (req, reply) => {
    const limit = parseInt(String((req.query as Record<string, string>)?.limit ?? "20"), 10);
    const jobs = await listJobs(limit);
    return reply.send(jobs);
  });

  // 统计
  app.get("/api/admin/stats", async (_req, reply) => {
    const { query } = await import("../../storage/db");
    try {
      const [docCount, sourceCount, jobCount] = await Promise.all([
        query("SELECT COUNT(*) AS c FROM raw_documents").then(r => Number(r.rows[0]?.c ?? 0)),
        query("SELECT COUNT(*) AS c FROM data_sources WHERE status = 'active'").then(r => Number(r.rows[0]?.c ?? 0)),
        query("SELECT COUNT(*) AS c FROM collection_jobs WHERE status = 'success'").then(r => Number(r.rows[0]?.c ?? 0)),
      ]);
      return reply.send({ totalDocuments: docCount, activeSources: sourceCount, successfulJobs: jobCount });
    } catch {
      return reply.send({ totalDocuments: 0, activeSources: 0, successfulJobs: 0 });
    }
  });
};
