import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildEpoCql,
  buildEpoExternalId,
  buildEpoSearchPath,
  extractEpoExchangeDocuments,
  mapEpoDocToRawJson,
  opsText,
} from "../../connectors/epoOpsHelpers";
import { EpoOpsConnector } from "../../connectors/epoOps";

const SAMPLE_SEARCH_JSON = {
  "ops:world-patent-data": {
    "ops:biblio-search": {
      "@total-result-count": "1",
      "exchange-documents": {
        "exchange-document": {
          "@country": "EP",
          "@doc-number": "1000000",
          "@kind": "A1",
          "bibliographic-data": {
            "invention-title": [{ $: "Optical interconnect lens" }],
            "publication-reference": {
              "document-id": {
                "@document-id-type": "epodoc",
                "doc-number": { $: "EP1000000" },
                date: { $: "20000517" },
              },
            },
          },
          abstract: [{ p: { $: "An injection molded microlens." } }],
        },
      },
    },
  },
};

describe("epoOps helpers", () => {
  it("opsText 解析 $ 节点", () => {
    expect(opsText({ $: "hello" })).toBe("hello");
  });

  it("buildEpoCql 组合 ta 与 pd", () => {
    expect(buildEpoCql({ query: "blockchain", since: "2024-01-01" })).toBe(
      "ta=blockchain and pd>=20240101",
    );
  });

  it("buildEpoCql 保留 CQL 表达式", () => {
    expect(buildEpoCql({ query: "applicant=IBM" })).toBe("applicant=IBM");
  });

  it("buildEpoSearchPath 含 constituents", () => {
    expect(buildEpoSearchPath("pn=EP")).toContain(
      "/published-data/search/biblio,abstract?q=",
    );
  });

  it("extractEpoExchangeDocuments 解析单条", () => {
    const docs = extractEpoExchangeDocuments(SAMPLE_SEARCH_JSON);
    expect(docs).toHaveLength(1);
    expect(buildEpoExternalId(docs[0]!)).toBe("EP1000000A1");
  });

  it("mapEpoDocToRawJson 写入 title/abstract", () => {
    const docs = extractEpoExchangeDocuments(SAMPLE_SEARCH_JSON);
    const { externalId, rawJson } = mapEpoDocToRawJson(docs[0]!);
    expect(externalId).toBe("EP1000000A1");
    expect(rawJson.title).toBe("Optical interconnect lens");
    expect(rawJson.abstract).toContain("microlens");
    expect(rawJson.data_source).toBe("epo_ops");
  });
});

describe("EpoOpsConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 缺凭证时失败", async () => {
    const c = new EpoOpsConnector();
    await expect(async () => {
      for await (const _ of c.collect({ maxItems: 1 })) {
        /* drain */
      }
    }).rejects.toThrow(/EPO_OPS_CONSUMER/);
  });

  it("collect OAuth + 检索分页", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "tok",
          expires_in: 1200,
          token_type: "Bearer",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => SAMPLE_SEARCH_JSON,
      } as Response);

    const c = new EpoOpsConnector({
      apiKey: "key",
      apiSecret: "secret",
    });
    const docs = [];
    for await (const d of c.collect({ query: "applicant=IBM", maxItems: 5 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.sourceId).toBe("epo_ops");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
