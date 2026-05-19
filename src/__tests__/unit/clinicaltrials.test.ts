import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mapStudyToRawJson,
  buildStudiesSearchParams,
} from "../../connectors/clinicaltrialsHelpers";
import { ClinicalTrialsConnector } from "../../connectors/clinicaltrials";

const SAMPLE_STUDY = {
  protocolSection: {
    identificationModule: {
      nctId: "NCT00000001",
      briefTitle: "Diabetes Phase 3 Trial",
    },
    descriptionModule: {
      briefSummary: "Brief summary text.",
      detailedDescription: "Detailed description.",
    },
    statusModule: {
      lastUpdatePostDateStruct: { date: "2024-05-01" },
    },
  },
};

describe("clinicaltrials helpers", () => {
  it("mapStudyToRawJson 合并摘要", () => {
    const { externalId, rawJson } = mapStudyToRawJson(SAMPLE_STUDY);
    expect(externalId).toBe("NCT00000001");
    expect(rawJson.title).toContain("Diabetes");
    expect(String(rawJson.abstract)).toContain("Brief summary");
    expect(rawJson.url).toBe("https://clinicaltrials.gov/study/NCT00000001");
  });

  it("buildStudiesSearchParams 含 query.term", () => {
    const sp = buildStudiesSearchParams("diabetes", undefined, 20);
    expect(sp.get("query.term")).toBe("diabetes");
    expect(sp.get("pageSize")).toBe("20");
  });
});

describe("ClinicalTrialsConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 解析 studies", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        studies: [SAMPLE_STUDY],
      }),
    } as Response);

    const c = new ClinicalTrialsConnector();
    const docs = [];
    for await (const d of c.collect({ query: "diabetes", maxItems: 3 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.sourceId).toBe("clinicaltrials");
  });
});
