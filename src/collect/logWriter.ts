import * as fs from "node:fs";
import * as path from "node:path";
import type { CollectProgressEvent } from "../scheduler/progress";
import { logger } from "../lib/logger";
import { getCollectLogRoot } from "./env";

function jobIdFromEvent(event: CollectProgressEvent): number | undefined {
  if (event.type === "source_start") return event.jobId;
  if ("jobId" in event && typeof event.jobId === "number") return event.jobId;
  if (event.type === "source_done" || event.type === "source_failed") {
    return event.job?.id;
  }
  return undefined;
}

function sourceIdFromEvent(event: CollectProgressEvent): string | undefined {
  if ("sourceId" in event && typeof event.sourceId === "string") return event.sourceId;
  if (event.type === "source_done" || event.type === "source_failed") {
    return event.job?.sourceId;
  }
  return undefined;
}

/** 追加 NDJSON 行（失败不抛出，不阻断采集） */
export async function appendCollectLogEvent(event: CollectProgressEvent): Promise<void> {
  const root = getCollectLogRoot();
  if (!root) return;

  const jobId = jobIdFromEvent(event);
  const sourceId = sourceIdFromEvent(event);
  if (jobId === undefined || !sourceId) return;

  try {
    const dir = path.join(root, sourceId, String(jobId));
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "run.ndjson");
    await fs.promises.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), eventType: event.type },
      "appendCollectLogEvent failed",
    );
  }
}

/** 包装进度回调：透传并落盘 */
export function withCollectLogSink(
  report: import("../scheduler/progress").CollectProgressReporter | undefined,
): import("../scheduler/progress").CollectProgressReporter | undefined {
  if (!report && !getCollectLogRoot()) return report;
  return (event) => {
    report?.(event);
    void appendCollectLogEvent(event);
  };
}
