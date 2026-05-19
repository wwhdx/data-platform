import { describe, it, expect, vi, beforeEach } from "vitest";
import { query } from "../../storage/db";
import { listJobs } from "../../storage/models/collectionJob";

vi.mock("../../storage/db", () => ({
  query: vi.fn(),
}));

describe("collectionJob stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listJobs parses stats JSONB", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [
        {
          id: 12,
          source_id: "openalex",
          query: "",
          status: "success",
          items_collected: 0,
          error_message: null,
          started_at: "2026-05-19T08:00:00.000Z",
          finished_at: "2026-05-19T08:01:00.000Z",
          stats: {
            fetched: 200,
            inserted: 0,
            skippedDuplicate: 200,
            since: "2026-05-19",
            connectorId: "openalex",
          },
        },
      ],
    });

    const jobs = await listJobs(1);
    expect(jobs[0]?.stats).toEqual({
      fetched: 200,
      inserted: 0,
      skippedDuplicate: 200,
      since: "2026-05-19",
      query: undefined,
      batchCount: undefined,
      connectorId: "openalex",
    });
  });
});
