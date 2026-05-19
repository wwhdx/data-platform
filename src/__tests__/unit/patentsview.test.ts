import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildPatentQuery,
  mapPatentToRawJson,
  scalarField,
} from "../../connectors/patentsviewHelpers";
import { PatentsViewConnector } from "../../connectors/patentsview";

describe("patentsview helpers", () => {
  it("scalarField 处理标量与数组", () => {
    expect(scalarField(["A", "B"])).toBe("A");
    expect(scalarField(10881042)).toBe("10881042");
  });

  it("mapPatentToRawJson 写入 title/abstract", () => {
    const { externalId, rawJson } = mapPatentToRawJson({
      patent_id: "10881042",
      patent_title: "Test patent",
      patent_date: "2021-01-05",
      patent_abstract: "Abstract text.",
    });
    expect(externalId).toBe("10881042");
    expect(rawJson.title).toBe("Test patent");
    expect(rawJson.abstract).toBe("Abstract text.");
    expect(rawJson.type).toBe("patent");
  });

  it("buildPatentQuery 合并 since 与 query", () => {
    const q = buildPatentQuery("ml", "2024-01-01");
    expect(q).toHaveProperty("_and");
  });
});

describe("PatentsViewConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 无 Key 时抛出凭证错误", async () => {
    const c = new PatentsViewConnector();
    await expect(async () => {
      for await (const _ of c.collect({ maxItems: 1 })) {
        /* drain */
      }
    }).rejects.toThrow(/PATENTSVIEW_API_KEY/);
  });

  it("collect 解析 patents 分页", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        error: false,
        count: 1,
        patents: [
          {
            patent_id: "1",
            patent_title: "A",
            patent_date: "2024-06-01",
            patent_abstract: "abs",
          },
        ],
      }),
    } as Response);

    const c = new PatentsViewConnector({ apiKey: "test-key" });
    const docs = [];
    for await (const d of c.collect({ since: "2024-01-01", maxItems: 5 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toBe("1");
    expect(docs[0]?.rawJson.title).toBe("A");
  });
});
