import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildEftsSearchUrl,
  mapEftsHitToRawJson,
} from "../../connectors/secEdgarHelpers";
import {
  buildSecFilingIndexUrl,
  parsePrimaryDocHref,
  stripSecFilingHtml,
} from "../../processors/secFilingText";
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

  it("parsePrimaryDocHref 解析 primary htm", () => {
    const html = `<a href="aapl-20240928.htm">10-K</a><a href="aapl-20240928-index.htm">Index</a>`;
    const href = parsePrimaryDocHref(
      html,
      "https://www.sec.gov/Archives/edgar/data/320193/000032019324000006/",
    );
    expect(href).toContain("aapl-20240928.htm");
  });

  it("stripSecFilingHtml 去标签", () => {
    const text = stripSecFilingHtml(
      "<html><body><p>Item 1 Business overview text.</p></body></html>",
      5000,
    );
    expect(text).toContain("Item 1");
  });

  it("buildSecFilingIndexUrl", () => {
    expect(
      buildSecFilingIndexUrl(
        "https://www.sec.gov/Archives/edgar/data/1/2/",
        "0000320193-24-000006",
      ),
    ).toContain("0000320193-24-000006-index.htm");
  });
});

describe("SecEdgarConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SEC_EDGAR_USER_AGENT = "TestCo test@example.com";
    process.env.SEC_EDGAR_FULLTEXT_ENABLED = "0";
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
    expect(docs[0]?.fetchProvenance?.documentRequest?.curl).toContain("curl");
  });

  it("collect 拉取 filing 全文", async () => {
    process.env.SEC_EDGAR_FULLTEXT_ENABLED = "1";
    const filingDir =
      "https://www.sec.gov/Archives/edgar/data/320193/000032019324000006/";
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
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
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => `<a href="aapl-20240928.htm">10-K</a>`,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          "<html><body><p>Item 1 Business description with sufficient length for chunking.</p></body></html>",
      } as Response);

    const c = new SecEdgarConnector({
      userAgent: process.env.SEC_EDGAR_USER_AGENT,
    });
    const docs = [];
    for await (const d of c.collect({ query: "AI", maxItems: 1 })) {
      docs.push(d);
    }
    expect(String(docs[0]?.rawJson.fulltext)).toContain("Item 1");
    expect(docs[0]?.fetchProvenance?.canonicalUrl).toContain(filingDir.slice(0, 30));
  });
});
