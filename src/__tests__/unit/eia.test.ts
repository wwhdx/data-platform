import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EiaConnector } from "../../connectors/eia";

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
    const c = new EiaConnector({});
    await expect(async () => {
      for await (const _ of c.collect({ maxItems: 1 })) {
        /* empty */
      }
    }).rejects.toThrow(/EIA_API_KEY/);
  });

  it("collect 解析 petroleum 序列", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
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

    const c = new EiaConnector({ apiKey: "eia-test-key" });
    const docs = [];
    for await (const d of c.collect({ maxItems: 1 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.rawJson.type).toBe("energy_indicator");
  });
});
