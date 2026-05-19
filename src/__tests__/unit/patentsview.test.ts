import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildOdpSearchBody,
  extractOdpRecords,
  mapOdpRecordToRawJson,
  scalarField,
} from "../../connectors/patentsviewHelpers";
import { PatentsViewConnector } from "../../connectors/patentsview";

describe("patentsview ODP helpers", () => {
  it("scalarField 处理标量与数组", () => {
    expect(scalarField(["A", "B"])).toBe("A");
    expect(scalarField(16123456)).toBe("16123456");
  });

  it("mapOdpRecordToRawJson 写入 title 与 application_number", () => {
    const { externalId, rawJson } = mapOdpRecordToRawJson({
      applicationNumberText: "16123456",
      applicationMetaData: {
        inventionTitle: "Machine learning system",
        grantDate: "2021-01-05",
        firstApplicantName: "Example Corp",
      },
    });
    expect(externalId).toBe("16123456");
    expect(rawJson.title).toBe("Machine learning system");
    expect(rawJson.type).toBe("patent");
    expect(rawJson.data_source).toBe("uspto_odp");
    expect(String(rawJson.url)).toContain("16123456");
  });

  it("buildOdpSearchBody 含 grantDate range 与 query", () => {
    const body = buildOdpSearchBody({
      query: "ml",
      since: "2024-01-01",
      offset: 0,
      limit: 25,
    });
    expect(body.q).toBe("ml");
    expect(body.rangeFilters?.[0]?.valueFrom).toBe("2024-01-01");
    expect(body.pagination).toEqual({ offset: 0, limit: 25 });
  });

  it("extractOdpRecords 解析 patentFileWrapperDataBag", () => {
    const rows = extractOdpRecords({
      count: 1,
      patentFileWrapperDataBag: [{ applicationNumberText: "1" }],
    });
    expect(rows).toHaveLength(1);
  });
});

describe("PatentsViewConnector (ODP)", () => {
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
    }).rejects.toThrow(/USPTO_ODP_API_KEY/);
  });

  it("collect 解析 ODP 分页", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        count: 1,
        patentFileWrapperDataBag: [
          {
            applicationNumberText: "16123456",
            applicationMetaData: {
              inventionTitle: "Test patent",
              grantDate: "2024-06-01",
            },
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
    expect(docs[0]?.externalId).toBe("16123456");
    expect(docs[0]?.rawJson.title).toBe("Test patent");
  });
});
