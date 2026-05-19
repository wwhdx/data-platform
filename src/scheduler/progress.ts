import type { CollectionJob } from "../types";

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
      itemsCollected: number;
    }
  | { type: "source_done"; job: CollectionJob }
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
