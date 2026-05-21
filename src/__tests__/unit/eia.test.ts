import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "path";
import { EiaConnector } from "../../connectors/eia";

const ROUTES_FIXTURE = path.resolve(
  process.cwd(),
  "src/__tests__/fixtures/eia-routes-test.yml",
);

describe("EiaConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 缺 Key 时抛错", async () => {
    const prev = process.env.EIA_API_KEY;
    delete process.env.EIA_API_KEY;
    try {
      const c = new EiaConnector({});
      await expect(async () => {
        for await (const _ of c.collect({ maxItems: 1 })) {
          /* empty */
        }
      }).rejects.toThrow(/EIA_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.EIA_API_KEY = prev;
      else delete process.env.EIA_API_KEY;
    }
  });

  it("collect 按 YAML route 解析 petroleum 序列", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          data: [
            {
              period: "2024-01-01",
              value: "75.5",
              "product-name": "Crude Oil",
              duoarea: "NUS",
            },
          ],
        },
      }),
    } as Response);

    const c = new EiaConnector({
      apiKey: "eia-test-key",
      sourceOptions: {
        eia_routes_file: ROUTES_FIXTURE,
        eia_tier_filter: "A",
      },
    });
    const docs = [];
    for await (const d of c.collect({ maxItems: 2 })) {
      docs.push(d);
    }
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]?.rawJson.type).toBe("energy_indicator");
    expect(docs[0]?.externalId).toMatch(/^eia\//);
    const provUrl = docs[0]?.fetchProvenance?.documentRequest?.url ?? "";
    expect(provUrl).toContain("petroleum/pri/spt/data");
    expect(provUrl).toContain("frequency=daily");
    expect(provUrl).toContain("api_key=REDACTED");
  });
});
