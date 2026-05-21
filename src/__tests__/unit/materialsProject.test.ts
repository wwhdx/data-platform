import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MaterialsProjectConnector } from "../../connectors/materialsProject";

describe("MaterialsProjectConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 缺 Key 时抛错", async () => {
    const c = new MaterialsProjectConnector({});
    await expect(async () => {
      for await (const _ of c.collect({ maxItems: 1 })) {
        /* empty */
      }
    }).rejects.toThrow(/MATERIALS_PROJECT_API_KEY/);
  });

  it("collect 解析 summary", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ material_id: "mp-149", formula_pretty: "Si", band_gap: 1.1 }],
        meta: { total_doc: 1 },
      }),
    } as Response);

    const c = new MaterialsProjectConnector({ apiKey: "mp-test-key" });
    const docs = [];
    for await (const d of c.collect({ query: "Si", maxItems: 1 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toBe("mp-149");
  });
});
