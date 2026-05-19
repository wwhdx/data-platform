import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  defaultCollectSinceDate,
  toCollectSinceDate,
  syncSchedulesToDb,
} from "../../storage/models/collectionSchedule";
import { query } from "../../storage/db";
import type { DataPlatformConfig } from "../../config/types";

vi.mock("../../storage/db", () => ({
  query: vi.fn(),
}));

describe("toCollectSinceDate", () => {
  it("uses last_collected_at as YYYY-MM-DD", () => {
    const since = toCollectSinceDate(new Date("2026-05-10T15:30:00Z"));
    expect(since).toBe("2026-05-10");
  });

  it("falls back to ~24h lookback when no watermark", () => {
    const since = toCollectSinceDate(null);
    const expected = defaultCollectSinceDate();
    expect(since).toBe(expected);
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("syncSchedulesToDb", () => {
  beforeEach(() => {
    vi.mocked(query).mockResolvedValue({ rows: [] });
  });

  it("upserts rows for sources with schedule", async () => {
    const config: DataPlatformConfig = {
      version: "1.0",
      defaults: {
        user_agent: "Test/1.0",
        request_timeout_ms: 30_000,
        max_retries: 3,
      },
      sources: [
        {
          id: "openalex",
          name: "OpenAlex",
          enabled: true,
          base_url: "https://api.openalex.org",
          auth_type: "none",
          rate_limit: "1/day",
          license: "CC0",
          commercial_use: true,
          schedule: "0 7 * * *",
        },
        {
          id: "pubmed",
          name: "PubMed",
          enabled: false,
          base_url: "https://eutils.ncbi.nlm.nih.gov",
          auth_type: "none",
          rate_limit: "3/sec",
          license: "PD",
          commercial_use: true,
          schedule: "",
        },
      ],
    };

    const { upserted } = await syncSchedulesToDb(config);
    expect(upserted).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(query).mock.calls[0]![0])).toContain(
      "collection_schedules",
    );
  });
});
