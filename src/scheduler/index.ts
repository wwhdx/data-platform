import cron from "node-cron";
import type { CollectionJob, RawDocument } from "../types";
import type { CollectJobStats } from "../types";
import type { CollectProgressReporter } from "./progress";
import { throttledProgress } from "./progress";
import { createCollectionJob, updateCollectionJob } from "../storage/models/collectionJob";
import {
  ensureScheduleRow,
  markScheduleCollectionSuccess,
  toCollectSinceDate,
  touchScheduleRunStart,
} from "../storage/models/collectionSchedule";
import {
  collectDuplicateScanMinFetched,
  collectDuplicateScanRatioThreshold,
  collectDuplicateScanStopBatches,
  collectLogSkipSampleLimit,
} from "../collect/env";
import {
  duplicateRatio,
  isDuplicateScan,
  nextConsecutiveDupBatches,
} from "../collect/duplicateScan";
import { validateCredentialsForCollect } from "../connectors/credentials";
import { dedup } from "../processors/dedup";
import { insertCollectionJobEvent } from "../storage/models/collectionJobEvent";
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
  /** 每批 dedup 写入 skip_sample 的抽样条数；未设则用 COLLECT_LOG_SKIP_SAMPLES */
  skipSampleLimit?: number;
  /** 本次采集最多入库条数（传给 Connector.collect maxItems） */
  maxItems?: number;
  /** 覆盖 since 水位（YYYY-MM-DD）；未设则用 DB 水位或默认 1 天 */
  since?: string;
  /** runCollectAll 批次序号（1-based，供 CLI 进度展示） */
  collectIndex?: number;
  /** runCollectAll 总信源数 */
  collectTotal?: number;
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
    return this.runCollection(
      sourceId,
      query ?? "",
      options?.onProgress,
      options?.skipSampleLimit,
      options?.maxItems,
      options?.since,
      options?.collectIndex,
      options?.collectTotal,
    );
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
    skipSampleLimit?: number,
    maxItems?: number,
    sinceOverride?: string,
    collectIndex?: number,
    collectTotal?: number,
  ): Promise<CollectionJob> {
    const factory = this.connectors.get(sourceId);
    if (!factory) {
      throw new Error(`Unknown connector: ${sourceId}`);
    }

    const report = throttledProgress(onProgress);
    const sampleLimit = skipSampleLimit ?? collectLogSkipSampleLimit();

    const schedule = await ensureScheduleRow(sourceId);
    const collectQuery = (searchQuery || schedule.query || "").trim();
    const since = sinceOverride ?? toCollectSinceDate(schedule.lastCollectedAt);

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
      ...(collectIndex != null ? { index: collectIndex } : {}),
      ...(collectTotal != null ? { total: collectTotal } : {}),
    });

    const credentialError = validateCredentialsForCollect(sourceId);
    if (credentialError) {
      const stats: CollectJobStats = {
        fetched: 0,
        inserted: 0,
        skippedDuplicate: 0,
        since,
        query: collectQuery || undefined,
        batchCount: 0,
        connectorId: sourceId,
      };
      await updateCollectionJob(job.id, {
        status: "failed",
        errorMessage: credentialError,
        stats,
      });
      job.status = "failed";
      job.errorMessage = credentialError;
      job.stats = stats;
      report?.({ type: "source_done", job, stats });
      return job;
    }

    let inserted = 0;
    let skippedDuplicate = 0;
    let fetched = 0;
    let batchCount = 0;

    try {
      await touchScheduleRunStart(sourceId);
      const connector = factory.create();
      const BUFFER_SIZE = 200;
      const buffer: RawDocument[] = [];

      const buildStats = (extra?: Partial<CollectJobStats>): CollectJobStats => ({
        fetched,
        inserted,
        skippedDuplicate,
        since,
        query: collectQuery || undefined,
        batchCount,
        connectorId: sourceId,
        duplicateRatio: duplicateRatio(fetched, skippedDuplicate),
        ...extra,
      });

      const stampJobId = (doc: RawDocument): RawDocument => {
        const stamped = { ...doc, collectionJobId: job.id };
        if (!stamped.fetchProvenance) return stamped;
        return {
          ...stamped,
          fetchProvenance: {
            ...stamped.fetchProvenance,
            collect: { ...stamped.fetchProvenance.collect, jobId: job.id },
          },
        };
      };

      const recordBatch = (
        batchIndex: number,
        batchSize: number,
        insertedInBatch: number,
        skippedInBatch: number,
        skippedSampleIds?: string[],
      ): void => {
        void insertCollectionJobEvent({
          jobId: job.id,
          eventType: "batch_dedup",
          payload: {
            batchIndex,
            batchSize,
            insertedInBatch,
            skippedInBatch,
          },
        }).catch(() => {});

        if (skippedSampleIds && skippedSampleIds.length > 0) {
          void insertCollectionJobEvent({
            jobId: job.id,
            eventType: "skip_sample",
            payload: { externalIds: skippedSampleIds },
          }).catch(() => {});
        }
      };

      let lastFetchedAt = Date.now();
      let consecutiveDupBatches = 0;
      let duplicateScanWarned = false;
      let stoppedReason: string | undefined;
      let progressPhase: "streaming" | "fetch_batch" | "dedup_batch" = "streaming";
      const abort = new AbortController();

      const checkDuplicateScan = (action: "batch" | "heartbeat"): boolean => {
        const ratio = duplicateRatio(fetched, skippedDuplicate);
        const scanning = isDuplicateScan({
          fetched,
          inserted,
          skippedDuplicate,
          minFetched: collectDuplicateScanMinFetched(),
          ratioThreshold: collectDuplicateScanRatioThreshold(),
        });
        if (!scanning) return false;

        const stopAfter = collectDuplicateScanStopBatches();
        const shouldStop =
          stopAfter > 0 && consecutiveDupBatches >= stopAfter;

        if (!duplicateScanWarned || action === "batch") {
          const msg = shouldStop
            ? `重复扫描：连续 ${consecutiveDupBatches} 批全重复，已抓取 ${fetched}、新入库 0，提前停止`
            : `重复扫描：已抓取 ${fetched}、新入库 0，重复率 ${Math.round(ratio * 100)}%（dedup 命中已有文档）`;
          report?.({
            type: "duplicate_scan",
            sourceId,
            jobId: job.id,
            fetched,
            inserted,
            skippedDuplicate,
            duplicateRatio: ratio,
            consecutiveDupBatches,
            action: shouldStop ? "stop" : "warn",
            message: msg,
          });
          duplicateScanWarned = true;
        }

        if (shouldStop) {
          stoppedReason = `duplicate_scan: ${consecutiveDupBatches} full-dup batches`;
          abort.abort();
          return true;
        }
        return false;
      };

      const emitProgress = () => {
        const waitSec = Math.max(
          0,
          Math.floor((Date.now() - lastFetchedAt) / 1000),
        );
        const ratio = duplicateRatio(fetched, skippedDuplicate);
        const scanning = isDuplicateScan({
          fetched,
          inserted,
          skippedDuplicate,
          minFetched: collectDuplicateScanMinFetched(),
          ratioThreshold: collectDuplicateScanRatioThreshold(),
        });
        let phase = progressPhase;
        if (phase === "streaming" && waitSec >= 2) {
          phase = "fetch_batch";
        }

        report?.({
          type: "progress",
          sourceId,
          jobId: job.id,
          fetched,
          itemsCollected: inserted,
          inserted,
          skippedDuplicate,
          batchIndex: batchCount,
          phase,
          waitSec,
          duplicateRatio: ratio,
          duplicateScan: scanning,
          maxItems,
        });
      };

      const PROGRESS_HEARTBEAT_MS = 5000;
      const heartbeat = setInterval(() => {
        emitProgress();
        checkDuplicateScan("heartbeat");
      }, PROGRESS_HEARTBEAT_MS);

      try {
        for await (const doc of connector.collect({
          since,
          query: collectQuery || undefined,
          maxItems,
          signal: abort.signal,
        })) {
          if (abort.signal.aborted) break;

          buffer.push(stampJobId(doc));
          fetched++;
          lastFetchedAt = Date.now();
          progressPhase = "streaming";

          if (fetched === 1 || fetched % 25 === 0) {
            emitProgress();
          }

          if (buffer.length >= BUFFER_SIZE) {
            progressPhase = "dedup_batch";
            const batchSize = buffer.length;
            const { newDocs, skippedCount, skippedSampleIds } = await dedup(buffer, {
              skipSampleLimit: sampleLimit,
            });
            inserted += newDocs.length;
            skippedDuplicate += skippedCount;
            batchCount++;
            consecutiveDupBatches = nextConsecutiveDupBatches(
              consecutiveDupBatches,
              batchSize,
              newDocs.length,
              skippedCount,
            );
            recordBatch(batchCount, batchSize, newDocs.length, skippedCount, skippedSampleIds);
            buffer.length = 0;
            await updateCollectionJob(job.id, { itemsCollected: inserted });
            progressPhase = "streaming";
            lastFetchedAt = Date.now();
            emitProgress();
            if (checkDuplicateScan("batch")) break;
          }
        }
      } finally {
        clearInterval(heartbeat);
      }

      if (abort.signal.aborted && buffer.length === 0 && stoppedReason) {
        const stats = buildStats({
          duplicateScan: true,
          stoppedReason,
        });
        await updateCollectionJob(job.id, {
          status: "success",
          itemsCollected: inserted,
          stats,
        });
        job.status = "success";
        job.itemsCollected = inserted;
        job.stats = stats;
        emitProgress();
        report?.({ type: "source_done", job, stats });
        return job;
      }

      if (buffer.length > 0) {
        progressPhase = "dedup_batch";
        const batchSize = buffer.length;
        const { newDocs, skippedCount, skippedSampleIds } = await dedup(buffer, {
          skipSampleLimit: sampleLimit,
        });
        inserted += newDocs.length;
        skippedDuplicate += skippedCount;
        batchCount++;
        recordBatch(batchCount, batchSize, newDocs.length, skippedCount, skippedSampleIds);
      }

      const stats = buildStats();
      await updateCollectionJob(job.id, {
        status: "success",
        itemsCollected: inserted,
        stats,
      });
      await markScheduleCollectionSuccess(sourceId);
      job.status = "success";
      job.itemsCollected = inserted;
      job.stats = stats;
      emitProgress();
      report?.({ type: "source_done", job, stats });
      return job;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stats: CollectJobStats = {
        fetched,
        inserted,
        skippedDuplicate,
        since,
        query: collectQuery || undefined,
        batchCount,
        connectorId: sourceId,
      };
      await updateCollectionJob(job.id, {
        status: "failed",
        errorMessage: msg,
        stats,
      });
      job.status = "failed";
      job.errorMessage = msg;
      job.stats = stats;
      report?.({ type: "source_done", job, stats });
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
