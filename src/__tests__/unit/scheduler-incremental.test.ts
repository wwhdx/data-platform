import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectParams } from "../../types";
import { Scheduler } from "../../scheduler";
import * as collectionSchedule from "../../storage/models/collectionSchedule";
import * as collectionJob from "../../storage/models/collectionJob";
import { dedup } from "../../processors/dedup";

vi.mock("../../storage/models/collectionSchedule");
vi.mock("../../storage/models/collectionJob");
vi.mock("../../processors/dedup");

describe("Scheduler incremental collect (A5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collectionSchedule.ensureScheduleRow).mockResolvedValue({
      id: 1,
      sourceId: "openalex",
      cronExpr: "0 7 * * *",
      query: "machine learning",
      enabled: true,
      lastCollectedAt: new Date("2026-05-10T08:00:00Z"),
    });
    vi.mocked(collectionSchedule.toCollectSinceDate).mockImplementation(
      (d) => (d ? d.toISOString().slice(0, 10) : "2026-05-09"),
    );
    vi.mocked(collectionSchedule.touchScheduleRunStart).mockResolvedValue();
    vi.mocked(collectionSchedule.markScheduleCollectionSuccess).mockResolvedValue();

    vi.mocked(collectionJob.createCollectionJob).mockResolvedValue({
      id: 99,
      sourceId: "openalex",
      status: "running",
      itemsCollected: 0,
      startedAt: new Date(),
    });
    vi.mocked(collectionJob.updateCollectionJob).mockResolvedValue();
    vi.mocked(dedup).mockResolvedValue({ newDocs: [], duplicates: 0 });
  });

  it("passes since and schedule query to connector.collect", async () => {
    const collected: CollectParams[] = [];
    const scheduler = new Scheduler();

    scheduler.registerConnector({
      id: "openalex",
      create: () =>
        ({
          meta: { id: "openalex" },
          search: async () => [],
          collect(params: CollectParams) {
            collected.push(params);
            return (async function* () {})();
          },
        }) as import("../../types").Connector,
    });

    await scheduler.trigger("openalex");

    expect(collected).toHaveLength(1);
    expect(collected[0]!.since).toBe("2026-05-10");
    expect(collected[0]!.query).toBe("machine learning");
    expect(collectionSchedule.markScheduleCollectionSuccess).toHaveBeenCalledWith(
      "openalex",
    );
  });

  it("does not advance watermark when collection fails", async () => {
    const scheduler = new Scheduler();

    scheduler.registerConnector({
      id: "openalex",
      create: () =>
        ({
          meta: { id: "openalex" },
          search: async () => [],
          async *collect() {
            throw new Error("api down");
          },
        }) as import("../../types").Connector,
    });

    const job = await scheduler.trigger("openalex");
    expect(job.status).toBe("failed");
    expect(collectionSchedule.markScheduleCollectionSuccess).not.toHaveBeenCalled();
  });
});
