import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectParams } from "../../types";
import { Scheduler } from "../../scheduler";
import * as collectionSchedule from "../../storage/models/collectionSchedule";
import * as collectionJob from "../../storage/models/collectionJob";
import { dedup } from "../../processors/dedup";

vi.mock("../../storage/models/collectionSchedule");
vi.mock("../../storage/models/collectionJob");
vi.mock("../../processors/dedup");
vi.mock("../../storage/models/collectionJobEvent", () => ({
  insertCollectionJobEvent: vi.fn().mockResolvedValue(undefined),
}));

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
    const events: Array<{ type: string; skippedDuplicate?: number }> = [];
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
      onProgress: (ev) => events.push({ type: ev.type, skippedDuplicate: ev.type === "progress" ? ev.skippedDuplicate : undefined }),
    });

    expect(events.map((e) => e.type)).toContain("source_start");
    expect(events.map((e) => e.type)).toContain("source_done");
  });

  it("progress includes skippedDuplicate from dedup", async () => {
    vi.mocked(dedup).mockResolvedValue({ newDocs: [], skippedCount: 3 });

    const progressEvents: Array<{ skippedDuplicate: number; inserted: number }> = [];
    const scheduler = new Scheduler();

    scheduler.registerConnector({
      id: "openalex",
      create: () =>
        ({
          meta: { id: "openalex" },
          search: async () => [],
          collect(_params: CollectParams) {
            return (async function* () {
              for (let i = 0; i < 3; i++) {
                yield {
                  sourceId: "openalex",
                  externalId: `W${i}`,
                  rawJson: {},
                  fetchedAt: new Date(),
                };
              }
            })();
          },
        }) as import("../../types").Connector,
    });

    await scheduler.trigger("openalex", "", {
      onProgress: (ev) => {
        if (ev.type === "progress") {
          progressEvents.push({
            skippedDuplicate: ev.skippedDuplicate,
            inserted: ev.inserted,
          });
        }
      },
    });

    expect(progressEvents.length).toBeGreaterThan(0);
    const last = progressEvents[progressEvents.length - 1]!;
    expect(last.skippedDuplicate).toBe(3);
    expect(last.inserted).toBe(0);
  });

  it("persists stats and collectionJobId on success", async () => {
    vi.mocked(dedup).mockImplementation(async (docs) => {
      const first = docs[0];
      expect(first?.collectionJobId).toBe(7);
      return { newDocs: docs, skippedCount: 0 };
    });

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
                externalId: "W9",
                rawJson: { title: "T" },
                fetchedAt: new Date(),
              };
            })();
          },
        }) as import("../../types").Connector,
    });

    await scheduler.trigger("openalex", "ml", {});

    expect(collectionJob.updateCollectionJob).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        status: "success",
        itemsCollected: 1,
        stats: expect.objectContaining({
          fetched: 1,
          inserted: 1,
          skippedDuplicate: 0,
          since: "2026-05-19",
          connectorId: "openalex",
        }),
      }),
    );
  });

  it("patentsview 缺 Key 时 failed job 且不调用 collect", async () => {
    delete process.env.USPTO_ODP_API_KEY;

    const collect = vi.fn();
    const scheduler = new Scheduler();
    scheduler.registerConnector({
      id: "patentsview",
      create: () =>
        ({
          meta: { id: "patentsview" },
          search: async () => [],
          collect,
        }) as import("../../types").Connector,
    });

    const job = await scheduler.trigger("patentsview", "");

    expect(job.status).toBe("failed");
    expect(job.errorMessage).toMatch(/USPTO_ODP_API_KEY/);
    expect(collect).not.toHaveBeenCalled();
    expect(collectionJob.updateCollectionJob).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        status: "failed",
        errorMessage: expect.stringMatching(/USPTO_ODP_API_KEY/),
      }),
    );
  });
});
