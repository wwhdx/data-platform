import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../../api/server";
import { Scheduler } from "../../scheduler";
import { query } from "../../storage/db";
import { hybridSearch } from "../../rag/retriever";

vi.mock("../../storage/db", () => ({
  query: vi.fn(),
}));

vi.mock("../../rag/retriever", () => ({
  hybridSearch: vi.fn(),
}));

describe("API smoke (Fastify inject)", () => {
  beforeEach(() => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.trim() === "SELECT 1") {
        return { rows: [{ ok: 1 }] };
      }
      if (sql.includes("data_sources")) {
        return {
          rows: [
            {
              id: "openalex",
              name: "OpenAlex",
              license: "CC0",
              commercial_use: true,
              rate_limit: "100000/day",
              total_docs: 42,
              last_fetch: "2026-05-19T07:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    vi.mocked(hybridSearch).mockResolvedValue([
      {
        title: "Test Paper",
        url: "https://openalex.org/W1",
        snippet: "abstract text",
        sourceId: "openalex",
        sourceName: "OpenAlex",
        score: 0.91,
        license: "CC0",
        commercialUse: true,
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("GET /health → 200 ok + db:ok", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe("ok");
    await app.close();
  });

  it("POST /api/search 缺 query → 400", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /api/search 有效 query → 200 + results", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { query: "transformer", maxResults: 3 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      results: Array<{ title: string }>;
      totalCount: number;
    };
    expect(body.totalCount).toBe(1);
    expect(body.results[0]?.title).toBe("Test Paper");
    expect(hybridSearch).toHaveBeenCalledWith(
      "transformer",
      expect.objectContaining({ maxResults: 3 }),
    );
    await app.close();
  });

  it("GET /api/admin/schedules → live active cron", async () => {
    const scheduler = new Scheduler();
    scheduler.schedule("openalex", "0 7 * * *", "");

    const app = await buildApp({ scheduler, logger: false });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/schedules",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      mode: string;
      active: Array<{ sourceId: string; cronExpr: string }>;
    };
    expect(body.mode).toBe("live");
    expect(body.active).toEqual([
      { sourceId: "openalex", cronExpr: "0 7 * * *", query: "" },
    ]);
    await app.close();
  });

  it("GET /api/admin/schedules 无 scheduler → 500", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/schedules",
    });

    expect(res.statusCode).toBe(500);
    await app.close();
  });
});
