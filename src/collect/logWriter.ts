import * as fs from "node:fs";
import * as path from "node:path";
import type { CollectProgressEvent } from "../scheduler/progress";
import { logger } from "../lib/logger";
import { getCollectLogRoot } from "./env";

let sessionLogPath: string | null = null;

/** 新一轮 collect 流开始前调用，避免会话文件串线 */
export function resetCollectLogSession(): void {
  sessionLogPath = null;
}

export function getJobLogFilePath(sourceId: string, jobId: number): string | null {
  const root = getCollectLogRoot();
  if (!root) return null;
  return path.join(root, sourceId, String(jobId), "run.ndjson");
}

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

function sessionLogFile(root: string): string {
  if (!sessionLogPath) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(root, "_runs", ts.slice(0, 10));
    fs.mkdirSync(dir, { recursive: true });
    sessionLogPath = path.join(dir, `session-${ts}.ndjson`);
  }
  return sessionLogPath;
}

async function appendLine(filePath: string, event: CollectProgressEvent): Promise<void> {
  await fs.promises.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

/** 追加 NDJSON 行（失败不抛出，不阻断采集） */
export async function appendCollectLogEvent(event: CollectProgressEvent): Promise<void> {
  const root = getCollectLogRoot();
  if (!root) return;

  try {
    if (event.type === "run_start" || event.type === "run_done" || event.type === "error") {
      await appendLine(sessionLogFile(root), event);
      return;
    }

    const jobId = jobIdFromEvent(event);
    const sourceId = sourceIdFromEvent(event);
    if (jobId === undefined || !sourceId) return;

    const filePath = path.join(root, sourceId, String(jobId), "run.ndjson");
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await appendLine(filePath, event);
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
