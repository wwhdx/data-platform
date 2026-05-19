import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendCollectLogEvent } from "../../collect/logWriter";

describe("collect logWriter", () => {
  let tmpDir: string;
  const prev = process.env.DATA_PLATFORM_COLLECT_LOG_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-collect-log-"));
    process.env.DATA_PLATFORM_COLLECT_LOG_DIR = tmpDir;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.DATA_PLATFORM_COLLECT_LOG_DIR;
    else process.env.DATA_PLATFORM_COLLECT_LOG_DIR = prev;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes NDJSON on source_start through source_done", async () => {
    await appendCollectLogEvent({
      type: "source_start",
      sourceId: "openalex",
      jobId: 3,
      since: "2026-05-19",
    });
    await appendCollectLogEvent({
      type: "progress",
      sourceId: "openalex",
      jobId: 3,
      fetched: 1,
      itemsCollected: 0,
      inserted: 0,
      skippedDuplicate: 1,
    });
    await appendCollectLogEvent({
      type: "source_done",
      job: {
        id: 3,
        sourceId: "openalex",
        status: "success",
        itemsCollected: 0,
        startedAt: new Date(),
      },
      stats: {
        fetched: 1,
        inserted: 0,
        skippedDuplicate: 1,
        since: "2026-05-19",
      },
    });

    const logPath = path.join(tmpDir, "openalex", "3", "run.ndjson");
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!).type).toBe("source_start");
  });
});
