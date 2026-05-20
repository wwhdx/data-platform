import type { FastifyPluginAsync } from "fastify";
import { listJobs } from "../../storage/models/collectionJob";
import { query } from "../../storage/db";
import { runCollectAll, runCollectOne, type CollectRunOptions } from "../collectRunner";
import { listJobEvents } from "../../storage/models/collectionJobEvent";
import type { CollectProgressEvent } from "../../scheduler/progress";

function writeNdjson(
  write: (event: CollectProgressEvent) => void,
  event: CollectProgressEvent,
): void {
  write(event);
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // 手动触发采集（body.stream=true 时返回 NDJSON 实时进度）
  app.post("/collect", async (req, reply) => {
    const body = req.body as {
      sourceId?: string;
      query?: string;
      stream?: boolean;
      verbose?: boolean;
      maxItems?: number;
      since?: string;
    } | null;
    const scheduler = app.scheduler;

    if (!scheduler) {
      return reply.status(500).send({ error: "scheduler not configured" });
    }

    const sourceId = body?.sourceId;
    const searchQuery = body?.query ?? "";
    const useStream = body?.stream === true;
    const maxItems =
      body?.maxItems != null && Number.isFinite(body.maxItems)
        ? Math.max(1, Math.floor(body.maxItems))
        : undefined;
    const sinceOverride =
      typeof body?.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.since)
        ? body.since
        : undefined;
    const runOpts: CollectRunOptions | undefined =
      body?.verbose || maxItems != null || sinceOverride != null
        ? {
            ...(body?.verbose ? { skipSampleLimit: 5 } : {}),
            ...(maxItems != null ? { maxItems } : {}),
            ...(sinceOverride != null ? { since: sinceOverride } : {}),
          }
        : undefined;

    const run = async (report?: (event: CollectProgressEvent) => void) => {
      if (sourceId) {
        return runCollectOne(scheduler, sourceId, searchQuery, report, runOpts);
      }
      return runCollectAll(scheduler, searchQuery, report, runOpts);
    };

    if (!useStream) {
      try {
        const result = await run();
        return reply.send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    const send = (event: CollectProgressEvent) => {
      reply.raw.write(`${JSON.stringify(event)}\n`);
    };

    try {
      await run((event) => writeNdjson(send, event));
      reply.raw.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeNdjson(send, { type: "error", message: msg });
      reply.raw.end();
    }
  });

  // 采集任务历史
  app.get("/jobs", async (req, reply) => {
    const limit = parseInt(String((req.query as Record<string, string>)?.limit ?? "20"), 10);
    const jobs = await listJobs(limit);
    return reply.send(jobs);
  });

  app.get("/jobs/:jobId/events", async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const id = parseInt(jobId, 10);
    if (!Number.isFinite(id)) {
      return reply.status(400).send({ error: "invalid jobId" });
    }
    const limit = parseInt(String((req.query as Record<string, string>)?.limit ?? "100"), 10);
    const events = await listJobEvents(id, limit);
    return reply.send(events);
  });

  // 运行中 cron 调度（B14 live 可观测）
  app.get("/schedules", async (_req, reply) => {
    const scheduler = app.scheduler;
    if (!scheduler) {
      return reply.status(500).send({ error: "scheduler not configured" });
    }

    const active = scheduler.getScheduleDetails();
    return reply.send({ mode: "live", active });
  });

  // 配置更新
  app.put("/sources/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown> | null;
    if (!body || Object.keys(body).length === 0) {
      return reply.status(400).send({ error: "no fields to update" });
    }

    const allowed: Record<string, string> = {
      base_url: "base_url",
      auth_type: "auth_type",
      rate_limit: "rate_limit",
      license: "license",
      commercial_use: "commercial_use",
      status: "status",
    };

    const sets: string[] = [];
    const params: unknown[] = [id];

    for (const [key, col] of Object.entries(allowed)) {
      if (body[key] !== undefined) {
        const old = await query(
          `SELECT ${col} FROM data_sources WHERE id = $1`, [id],
        ).then(r => r.rows[0]?.[col] as string | null);

        sets.push(`${col} = $${params.length + 1}`);
        params.push(body[key]);

        await query(
          `INSERT INTO config_audit_log (source_id, field_name, old_value, new_value)
           VALUES ($1, $2, $3, $4)`,
          [id, col, String(old ?? ""), String(body[key])],
        );
      }
    }

    if (sets.length === 0) {
      return reply.status(400).send({ error: "no allowed fields to update" });
    }

    sets.push(`updated_at = now()`);

    const result = await query(
      `UPDATE data_sources SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      params,
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "source not found" });
    }

    return reply.send({ ok: true, source: result.rows[0] });
  });

  // 统计
  app.get("/stats", async (_req, reply) => {
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
