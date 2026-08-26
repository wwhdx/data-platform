import { describe, it, expect, vi } from "vitest";
import {
  buildPatentsQuery,
  grantDateToIso,
  mapGpRowToRawJson,
  sanitizeSearchTerm,
  sinceToGrantDateInt,
  validateGooglePatentsEnv,
} from "../../connectors/googlePatentsHelpers";
import { GooglePatentsConnector } from "../../connectors/googlePatents";

describe("googlePatents helpers", () => {
  it("sanitizeSearchTerm 去除通配符", () => {
    expect(sanitizeSearchTerm("  ml_%\\  ")).toBe("ml");
  });

  it("sinceToGrantDateInt", () => {
    expect(sinceToGrantDateInt("2024-01-15")).toBe(20240115);
    expect(sinceToGrantDateInt("bad")).toBeUndefined();
  });

  it("grantDateToIso", () => {
    expect(grantDateToIso(20240105)).toBe("2024-01-05");
  });

  it("buildPatentsQuery 参数化 term 与 since", () => {
    const { sql, params } = buildPatentsQuery({
      term: "neural network",
      sinceGrantDate: 20200101,
      countryCode: "US",
      limit: 10,
      offset: 0,
      tableFqn: "patents-public-data.patents.publications",
    });
    expect(sql).toContain("@termPattern");
    expect(sql).toContain("@sinceGrantDate");
    expect(sql).toContain("@countryCode");
    expect(params.termPattern).toBe("%neural network%");
    expect(params.sinceGrantDate).toBe(20200101);
  });

  it("mapGpRowToRawJson", () => {
    const { externalId, rawJson } = mapGpRowToRawJson({
      publication_number: "US-9876543-B2",
      country_code: "US",
      grant_date: 20240105,
      title_en: "ML system",
      abstract_en: "An ML system.",
    });
    expect(externalId).toBe("US-9876543-B2");
    expect(rawJson.title).toBe("ML system");
    expect(rawJson.type).toBe("patent");
    expect(rawJson.data_source).toBe("google_patents_bq");
    expect(String(rawJson.url)).toContain("US9876543B2");
  });

  it("validateGooglePatentsEnv 缺 GCP_PROJECT_ID", () => {
    const prev = process.env.GCP_PROJECT_ID;
    delete process.env.GCP_PROJECT_ID;
    expect(validateGooglePatentsEnv()).toMatch(/GCP_PROJECT_ID/);
    process.env.GCP_PROJECT_ID = prev;
  });
});

describe("GooglePatentsConnector", () => {
  it("collect 无 GCP_PROJECT_ID 时失败", async () => {
    const prev = process.env.GCP_PROJECT_ID;
    delete process.env.GCP_PROJECT_ID;
    const c = new GooglePatentsConnector();
    await expect(async () => {
      for await (const _ of c.collect({ maxItems: 1 })) {
        /* drain */
      }
    }).rejects.toThrow(/GCP_PROJECT_ID/);
    process.env.GCP_PROJECT_ID = prev;
  });

  it("collect 解析 mock 行", async () => {
    process.env.GCP_PROJECT_ID = "test-project";
    const queryFn = vi.fn().mockResolvedValueOnce([
      {
        publication_number: "EP-1000000-A1",
        country_code: "EP",
        grant_date: 20230501,
        title_en: "Blockchain",
        abstract_en: "A chain.",
      },
    ]);
    const c = new GooglePatentsConnector({}, queryFn);
    const docs = [];
    for await (const doc of c.collect({ maxItems: 5, query: "blockchain" })) {
      docs.push(doc);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.sourceId).toBe("google_patents");
    expect(docs[0]?.fetchProvenance?.documentRequest?.curl).toContain("curl");
    expect(docs[0]?.fetchProvenance?.batchRequest?.curl).toContain("bigquery");
    expect(docs[0]?.externalId).toBe("EP-1000000-A1");
    expect(queryFn).toHaveBeenCalledOnce();
  });
});
