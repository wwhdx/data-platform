import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildEftsSearchUrl,
  mapEftsHitToRawJson,
} from "../../connectors/secEdgarHelpers";
import { SecEdgarConnector } from "../../connectors/secEdgar";

describe("secEdgar helpers", () => {
  it("mapEftsHitToRawJson 生成 title 与 adsh", () => {
    const { externalId, rawJson } = mapEftsHitToRawJson({
      adsh: "0000320193-24-000006",
      ciks: ["0000320193"],
      entity_name: "Apple Inc.",
      file_date: "2024-11-01",
      form_type: "10-K",
    });
    expect(externalId).toBe("0000320193-24-000006");
    expect(String(rawJson.title)).toContain("Apple");
    expect(rawJson.type).toBe("company_filing");
  });

  it("buildEftsSearchUrl 含日期范围", () => {
    const url = buildEftsSearchUrl({
      query: "AI",
      since: "2024-01-01",
      end: "2024-12-31",
      from: 0,
      size: 10,
    });
    expect(url).toContain("efts.sec.gov");
    expect(url).toContain("startdt=2024-01-01");
  });
});

describe("SecEdgarConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SEC_EDGAR_USER_AGENT = "TestCo test@example.com";
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 解析 EFTS hits", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        hits: {
          hits: [
            {
              _source: {
                adsh: "0000320193-24-000006",
                ciks: ["0000320193"],
                entity_name: "Apple Inc.",
                file_date: "2024-11-01",
                form_type: "10-K",
              },
            },
          ],
        },
      }),
    } as Response);

    const c = new SecEdgarConnector({
      userAgent: process.env.SEC_EDGAR_USER_AGENT,
    });
    const docs = [];
    for await (const d of c.collect({ query: "AI", maxItems: 3 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.sourceId).toBe("sec_edgar");
  });
});
