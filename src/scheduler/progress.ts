import type { CollectJobStats, CollectionJob } from "../types";

export type { CollectJobStats };

export interface CollectAllFailure {
  sourceId: string;
  error: string;
}

export interface CollectAllSkipped {
  sourceId: string;
  reason: string;
}

export type CollectProgressReporter = (event: CollectProgressEvent) => void;

export type CollectProgressEvent =
  | { type: "run_start"; sourceIds: string[]; activeCount: number }
  | {
      type: "source_start";
      sourceId: string;
      jobId: number;
      since: string;
      query?: string;
      index?: number;
      total?: number;
    }
  | {
      type: "progress";
      sourceId: string;
      jobId: number;
      fetched: number;
      /** 累计新入库条数（与 inserted 相同，保留兼容旧 CLI） */
      itemsCollected: number;
      inserted: number;
      skippedDuplicate: number;
      batchIndex?: number;
      /** streaming=逐条 yield；fetch_batch=等外网；dedup_* / enrich / embed=后处理 */
      phase?:
        | "streaming"
        | "fetch_batch"
        | "dedup_batch"
        | "dedup_insert"
        | "fulltext_enrich"
        | "unpaywall_enrich"
        | "embed";
      /** 子阶段人类可读标签（可选） */
      phaseLabel?: string;
      phaseCurrent?: number;
      phaseTotal?: number;
      phaseUnit?: "docs" | "chunks";
      /** 距上次 fetched++ 的秒数（心跳时有效） */
      waitSec?: number;
      /** skippedDuplicate / fetched */
      duplicateRatio?: number;
      /** 满足重复扫描判定（新入库 0 且重复率超阈） */
      duplicateScan?: boolean;
      maxItems?: number;
    }
  | {
      type: "duplicate_scan";
      sourceId: string;
      jobId: number;
      fetched: number;
      inserted: number;
      skippedDuplicate: number;
      duplicateRatio: number;
      consecutiveDupBatches: number;
      action: "warn" | "stop";
      message: string;
    }
  | { type: "source_done"; job: CollectionJob; stats: CollectJobStats }
  | {
      type: "source_failed";
      sourceId: string;
      error: string;
      job?: CollectionJob;
      index?: number;
      total?: number;
    }
  | {
      type: "source_skipped";
      sourceId: string;
      reason: string;
      index?: number;
      total?: number;
    }
  | {
      type: "run_done";
      jobs: CollectionJob[];
      failures: CollectAllFailure[];
      skipped: CollectAllSkipped[];
      activeCount: number;
    }
  | { type: "error"; message: string };

/** 限制 progress 事件频率，避免刷屏 */
export function throttledProgress(
  report: CollectProgressReporter | undefined,
  minIntervalMs = 2000,
): CollectProgressReporter | undefined {
  if (!report) return undefined;
  let lastAt = 0;
  let pending: Extract<CollectProgressEvent, { type: "progress" }> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (!pending) return;
    report(pending);
    pending = null;
    lastAt = Date.now();
    timer = null;
  };

  return (event) => {
    if (event.type !== "progress") {
      flush();
      report(event);
      return;
    }
    pending = event;
    const now = Date.now();
    if (now - lastAt >= minIntervalMs) {
      flush();
      return;
    }
    if (!timer) {
      timer = setTimeout(flush, minIntervalMs - (now - lastAt));
    }
  };
}
