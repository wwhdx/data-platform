import type { CollectionJob } from "../types";

export interface CollectAllFailure {
  sourceId: string;
  error: string;
}

export interface CollectAllSkipped {
  sourceId: string;
  reason: string;
}

/** 单次采集任务汇总（L1：进度/CLI；L2 将持久化至 collection_jobs.stats） */
export interface CollectJobStats {
  fetched: number;
  inserted: number;
  skippedDuplicate: number;
  since: string;
  query?: string;
  batchCount?: number;
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
