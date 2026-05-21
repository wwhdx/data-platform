import type { CollectProgressEvent, CollectProgressReporter } from "../scheduler/progress";

export type CollectProgressPhase =
  | "streaming"
  | "fetch_batch"
  | "dedup_batch"
  | "dedup_insert"
  | "fulltext_enrich"
  | "unpaywall_enrich"
  | "embed";

export interface CollectProgressBase {
  sourceId: string;
  jobId: number;
  fetched: number;
  inserted: number;
  skippedDuplicate: number;
  batchCount: number;
  maxItems?: number;
}

export interface PostProcessTick {
  phase: CollectProgressPhase;
  phaseLabel?: string;
  phaseCurrent?: number;
  phaseTotal?: number;
  phaseUnit?: "docs" | "chunks";
}

export function emitCollectProgress(
  report: CollectProgressReporter | undefined,
  base: CollectProgressBase,
  tick: PostProcessTick,
): void {
  if (!report) return;
  report({
    type: "progress",
    sourceId: base.sourceId,
    jobId: base.jobId,
    fetched: base.fetched,
    itemsCollected: base.inserted,
    inserted: base.inserted,
    skippedDuplicate: base.skippedDuplicate,
    batchIndex: base.batchCount,
    phase: tick.phase,
    phaseLabel: tick.phaseLabel,
    phaseCurrent: tick.phaseCurrent,
    phaseTotal: tick.phaseTotal,
    phaseUnit: tick.phaseUnit,
    maxItems: base.maxItems,
  });
}

/** 循环内节流，避免 enrich/embed 刷屏 */
export function throttledStepReporter(
  report: CollectProgressReporter | undefined,
  base: CollectProgressBase,
  tick: Omit<PostProcessTick, "phaseCurrent">,
  minIntervalMs = 2000,
): (current: number, total: number) => void {
  let lastAt = 0;
  return (current: number, total: number) => {
    const now = Date.now();
    if (current < total && now - lastAt < minIntervalMs) return;
    lastAt = now;
    emitCollectProgress(report, base, { ...tick, phaseCurrent: current, phaseTotal: total });
  };
}

export type DedupProgressReporter = CollectProgressReporter;

export interface DedupRunContext {
  sourceId: string;
  jobId: number;
  fetched: number;
  inserted: number;
  skippedDuplicate: number;
  batchCount: number;
  maxItems?: number;
  onProgress?: DedupProgressReporter;
}

export function dedupProgressBase(ctx: DedupRunContext): CollectProgressBase {
  return {
    sourceId: ctx.sourceId,
    jobId: ctx.jobId,
    fetched: ctx.fetched,
    inserted: ctx.inserted,
    skippedDuplicate: ctx.skippedDuplicate,
    batchCount: ctx.batchCount,
    maxItems: ctx.maxItems,
  };
}
