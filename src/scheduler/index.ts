import cron from "node-cron";
import type { CollectionJob, RawDocument } from "../types";
import type { CollectJobStats, CollectProgressReporter } from "./progress";
import { throttledProgress } from "./progress";
import { createCollectionJob, updateCollectionJob } from "../storage/models/collectionJob";
import {
  ensureScheduleRow,
  markScheduleCollectionSuccess,
  toCollectSinceDate,
  touchScheduleRunStart,
} from "../storage/models/collectionSchedule";
import { dedup } from "../processors/dedup";
import { query } from "../storage/db";

interface ConnectorFactory {
  id: string;
  create: () => import("../types").Connector;
}

export interface ScheduledTaskMeta {
  sourceId: string;
  cronExpr: string;
  query: string;
}

export interface TriggerOptions {
  onProgress?: CollectProgressReporter;
}

export class Scheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private scheduleMeta: Map<string, ScheduledTaskMeta> = new Map();
  private connectors: Map<string, ConnectorFactory> = new Map();

  registerConnector(factory: ConnectorFactory): void {
    this.connectors.set(factory.id, factory);
  }

  hasConnector(sourceId: string): boolean {
    return this.connectors.has(sourceId);
  }

  /** 已注册的 cron 源 id（测试与启动日志） */
  getScheduledSourceIds(): string[] {
    return [...this.jobs.keys()];
  }

  /** 内存中已注册 cron 详情（B14 live 可观测） */
  getScheduleDetails(): ScheduledTaskMeta[] {
    return [...this.scheduleMeta.values()];
  }

  schedule(sourceId: string, cronExpr: string, searchQuery: string): void {
    if (this.jobs.has(sourceId)) return;

    const task = cron.schedule(cronExpr, async () => {
      await this.runCollection(sourceId, searchQuery);
    });

    this.jobs.set(sourceId, task);
    this.scheduleMeta.set(sourceId, {
      sourceId,
      cronExpr,
      query: searchQuery,
    });
  }

  async trigger(
    sourceId: string,
    query?: string,
    options?: TriggerOptions,
  ): Promise<CollectionJob> {
    return this.runCollection(sourceId, query ?? "", options?.onProgress);
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

  private async runCollection(
    sourceId: string,
    searchQuery: string,
    onProgress?: CollectProgressReporter,
  ): Promise<CollectionJob> {
    const factory = this.connectors.get(sourceId);
    if (!factory) {
      throw new Error(`Unknown connector: ${sourceId}`);
    }

    const report = throttledProgress(onProgress);

    const schedule = await ensureScheduleRow(sourceId);
    const collectQuery = (searchQuery || schedule.query || "").trim();
    const since = toCollectSinceDate(schedule.lastCollectedAt);

    const job = await createCollectionJob({
      sourceId,
      query: collectQuery || searchQuery,
    });

    report?.({
      type: "source_start",
      sourceId,
      jobId: job.id,
      since,
      query: collectQuery || undefined,
    });

    let inserted = 0;
    let skippedDuplicate = 0;
    let fetched = 0;
    let batchCount = 0;

    try {
      await touchScheduleRunStart(sourceId);
      const connector = factory.create();
      const BUFFER_SIZE = 200;
      const buffer: RawDocument[] = [];

      const buildStats = (): CollectJobStats => ({
        fetched,
        inserted,
        skippedDuplicate,
        since,
        query: collectQuery || undefined,
        batchCount,
      });

      const emitProgress = () => {
        report?.({
          type: "progress",
          sourceId,
          jobId: job.id,
          fetched,
          itemsCollected: inserted,
          inserted,
          skippedDuplicate,
          batchIndex: batchCount,
        });
      };

      for await (const doc of connector.collect({
        since,
        query: collectQuery || undefined,
      })) {
        buffer.push(doc);
        fetched++;

        if (buffer.length >= BUFFER_SIZE) {
          const { newDocs, skippedCount } = await dedup(buffer);
          inserted += newDocs.length;
          skippedDuplicate += skippedCount;
          batchCount++;
          buffer.length = 0;
          await updateCollectionJob(job.id, { itemsCollected: inserted });
          emitProgress();
        }
      }

      if (buffer.length > 0) {
        const { newDocs, skippedCount } = await dedup(buffer);
        inserted += newDocs.length;
        skippedDuplicate += skippedCount;
        batchCount++;
      }

      await updateCollectionJob(job.id, { status: "success", itemsCollected: inserted });
      await markScheduleCollectionSuccess(sourceId);
      job.status = "success";
      job.itemsCollected = inserted;
      emitProgress();
      report?.({ type: "source_done", job, stats: buildStats() });
      return job;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateCollectionJob(job.id, { status: "failed", errorMessage: msg });
      job.status = "failed";
      job.errorMessage = msg;
      report?.({
        type: "source_done",
        job,
        stats: {
          fetched,
          inserted,
          skippedDuplicate,
          since,
          query: collectQuery || undefined,
          batchCount,
        },
      });
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
