import { resetCollectLogSession, withCollectLogSink } from "../collect/logWriter";
import type { Scheduler } from "../scheduler";
import type { CollectionJob } from "../types";
import type {
  CollectAllFailure,
  CollectAllSkipped,
  CollectProgressEvent,
  CollectProgressReporter,
} from "../scheduler/progress";
import { query } from "../storage/db";

export type { CollectAllFailure, CollectAllSkipped };

export interface CollectAllResult {
  jobs: CollectionJob[];
  failures: CollectAllFailure[];
  skipped: CollectAllSkipped[];
  activeCount: number;
}

function emit(
  report: CollectProgressReporter | undefined,
  event: CollectProgressEvent,
): void {
  withCollectLogSink(report)?.(event);
}

export interface CollectRunOptions {
  skipSampleLimit?: number;
}

export async function runCollectOne(
  scheduler: Scheduler,
  sourceId: string,
  searchQuery: string,
  report?: CollectProgressReporter,
  runOpts?: CollectRunOptions,
): Promise<CollectionJob> {
  if (!scheduler.hasConnector(sourceId)) {
    throw new Error(`Unknown connector: ${sourceId}`);
  }

  resetCollectLogSession();
  emit(report, { type: "run_start", sourceIds: [sourceId], activeCount: 1 });

  const job = await scheduler.trigger(sourceId, searchQuery, {
    onProgress: report,
    skipSampleLimit: runOpts?.skipSampleLimit,
  });

  const summary: CollectAllResult = {
    jobs: [job],
    failures: [],
    skipped: [],
    activeCount: 1,
  };
  emit(report, { type: "run_done", ...summary });
  return job;
}

export async function runCollectAll(
  scheduler: Scheduler,
  searchQuery: string,
  report?: CollectProgressReporter,
  runOpts?: CollectRunOptions,
): Promise<CollectAllResult> {
  const jobs: CollectionJob[] = [];
  const failures: CollectAllFailure[] = [];
  const skipped: CollectAllSkipped[] = [];
  const result = await query(
    `SELECT id FROM data_sources WHERE status = 'active' ORDER BY id`,
  );
  const sourceIds = result.rows.map((row) => String(row.id));
  const total = sourceIds.length;

  resetCollectLogSession();
  emit(report, { type: "run_start", sourceIds, activeCount: total });

  let index = 0;
  for (const row of result.rows) {
    index++;
    const sourceId = String(row.id);

    if (!scheduler.hasConnector(sourceId)) {
      const reason = "connector not registered";
      skipped.push({ sourceId, reason });
      emit(report, {
        type: "source_skipped",
        sourceId,
        reason,
        index,
        total,
      });
      continue;
    }

    try {
      const job = await scheduler.trigger(sourceId, searchQuery, {
        onProgress: report,
        skipSampleLimit: runOpts?.skipSampleLimit,
      });
      jobs.push(job);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ sourceId, error: msg });
      emit(report, {
        type: "source_failed",
        sourceId,
        error: msg,
        index,
        total,
      });
    }
  }

  const summary: CollectAllResult = {
    jobs,
    failures,
    skipped,
    activeCount: total,
  };
  emit(report, { type: "run_done", ...summary });
  return summary;
}
