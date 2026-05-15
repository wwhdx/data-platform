import cron from "node-cron";
import type { CollectionJob } from "../types";
import { createCollectionJob, updateCollectionJob } from "../storage/models/collectionJob";
import { dedup } from "../processors/dedup";
import { query } from "../storage/db";

interface ConnectorFactory {
  id: string;
  create: () => import("../types").Connector;
}

export class Scheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private connectors: Map<string, ConnectorFactory> = new Map();

  registerConnector(factory: ConnectorFactory): void {
    this.connectors.set(factory.id, factory);
  }

  schedule(sourceId: string, cronExpr: string, searchQuery: string): void {
    if (this.jobs.has(sourceId)) return;

    const task = cron.schedule(cronExpr, async () => {
      await this.runCollection(sourceId, searchQuery);
    });

    this.jobs.set(sourceId, task);
  }

  async trigger(sourceId: string, query?: string): Promise<CollectionJob> {
    return this.runCollection(sourceId, query ?? "");
  }

  start(): void {
    for (const [, task] of this.jobs) {
      task.start();
    }
  }

  stop(): void {
    for (const [, task] of this.jobs) {
      task.stop();
    }
  }

  private async runCollection(sourceId: string, searchQuery: string): Promise<CollectionJob> {
    const factory = this.connectors.get(sourceId);
    if (!factory) {
      throw new Error(`Unknown connector: ${sourceId}`);
    }

    const job = await createCollectionJob({ sourceId, query: searchQuery });

    try {
      const connector = factory.create();
      let total = 0;

      for await (const doc of connector.collect({})) {
        const { newDocs } = await dedup([doc]);
        total += newDocs.length;

        if (total % 50 === 0) {
          await updateCollectionJob(job.id, { itemsCollected: total });
        }
      }

      await updateCollectionJob(job.id, { status: "success", itemsCollected: total });
      job.status = "success";
      job.itemsCollected = total;
      return job;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateCollectionJob(job.id, { status: "failed", errorMessage: msg });
      job.status = "failed";
      job.errorMessage = msg;
      return job;
    }
  }
}

/** 从数据库恢复已注册的调度配置 */
export async function loadSchedules(scheduler: Scheduler): Promise<void> {
  const result = await query(
    `SELECT * FROM collection_schedules WHERE enabled = true`,
  );
  for (const row of result.rows) {
    scheduler.schedule(
      String(row.source_id),
      String(row.cron_expr),
      String(row.query ?? ""),
    );
  }
}
