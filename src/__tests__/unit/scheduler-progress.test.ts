import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectParams } from "../../types";
import { Scheduler } from "../../scheduler";
import * as collectionSchedule from "../../storage/models/collectionSchedule";
import * as collectionJob from "../../storage/models/collectionJob";
import { dedup } from "../../processors/dedup";

vi.mock("../../storage/models/collectionSchedule");
vi.mock("../../storage/models/collectionJob");
vi.mock("../../processors/dedup");

describe("Scheduler collect progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collectionSchedule.ensureScheduleRow).mockResolvedValue({
      id: 1,
      sourceId: "openalex",
      cronExpr: "0 7 * * *",
      query: "",
      enabled: true,
    });
    vi.mocked(collectionSchedule.toCollectSinceDate).mockReturnValue("2026-05-19");
    vi.mocked(collectionSchedule.touchScheduleRunStart).mockResolvedValue();
    vi.mocked(collectionSchedule.markScheduleCollectionSuccess).mockResolvedValue();
    vi.mocked(collectionJob.createCollectionJob).mockResolvedValue({
      id: 7,
      sourceId: "openalex",
      status: "running",
      itemsCollected: 0,
      startedAt: new Date(),
    });
    vi.mocked(collectionJob.updateCollectionJob).mockResolvedValue();
    vi.mocked(dedup).mockResolvedValue({ newDocs: [], skippedCount: 0 });
  });

  it("emits source_start and source_done", async () => {
    const events: string[] = [];
    const scheduler = new Scheduler();

    scheduler.registerConnector({
      id: "openalex",
      create: () =>
        ({
          meta: { id: "openalex" },
          search: async () => [],
          collect(_params: CollectParams) {
            return (async function* () {
              yield {
                sourceId: "openalex",
                externalId: "W1",
                rawJson: {},
                fetchedAt: new Date(),
              };
            })();
          },
        }) as import("../../types").Connector,
    });

    await scheduler.trigger("openalex", "", {
      onProgress: (ev) => events.push(ev.type),
    });

    expect(events).toContain("source_start");
    expect(events).toContain("source_done");
  });
});
