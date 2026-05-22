import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../../api/server";
import { computeNovelty } from "../../uode/computeNovelty";

vi.mock("../../storage/db", () => ({
  query: vi.fn(),
}));

vi.mock("../../uode/computeNovelty", () => ({
  computeNovelty: vi.fn(),
}));

vi.mock("../../rag/retriever", () => ({
  hybridSearch: vi.fn().mockResolvedValue([]),
}));

import { query } from "../../storage/db";

describe("opportunity API routes", () => {
  const adminKey = "test-admin-key";

  beforeEach(() => {
    process.env.DATA_PLATFORM_ADMIN_KEY = adminKey;
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.trim() === "SELECT 1") return { rows: [{ ok: 1 }] };
      if (sql.includes("opportunity_weights")) {
        return {
          rows: [
            {
              industry_tag: "__global__",
              w1_demand: "0.3",
              w2_feasibility: "0.25",
              w3_novelty: "0.2",
              w4_value: "0.15",
              lambda_risk: "0.1",
              pass_threshold: "60",
              version: "v0_default",
              sample_size: 0,
              calibrated_at: null,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO opportunity_outcomes")) {
        return { rows: [{ id: 1 }] };
      }
      if (sql.includes("COUNT(*)::int AS n FROM opportunity_outcomes")) {
        return { rows: [{ n: 1 }] };
      }
      return { rows: [] };
    });
    vi.mocked(computeNovelty).mockResolvedValue({
      maxDistance: 0.7,
      noveltyScore: 50,
      topK: [],
      vectorCount: 0,
      coldStart: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DATA_PLATFORM_ADMIN_KEY;
  });

  it("POST /api/opportunity-vectors/distance 无需 Admin Key", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/opportunity-vectors/distance",
      payload: { synopsis: "新型储能技术路线" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { noveltyScore: number; coldStart: boolean };
    expect(body.noveltyScore).toBe(50);
    expect(body.coldStart).toBe(true);
    await app.close();
  });

  it("GET /api/opportunity-weights 无 Bearer → 401", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "GET",
      url: "/api/opportunity-weights/__global__",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /api/opportunity-weights 有效 Bearer → 200", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "GET",
      url: "/api/opportunity-weights/__global__",
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { version: string };
    expect(body.version).toBe("v0_default");
    await app.close();
  });
});
